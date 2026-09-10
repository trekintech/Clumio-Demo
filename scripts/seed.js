import {
  CreateTableCommand,
  DescribeTableCommand,
  UpdateContinuousBackupsCommand,
  waitUntilTableExists
} from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import { ddb, rawDdb, s3 } from "../aws.js";
import { REGION, TABLE, BUCKET, TENANTS, defaultMenu } from "../config.js";

const ORDERS_PER_TENANT = Number(process.env.ORDERS_PER_TENANT || 150);

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function menuSvg(name, cuisine) {
  const hues = { Japanese: 18, Turkish: 32, Cafe: 200, Seafood: 195, Thai: 96, Italian: 8, Deli: 140, Spanish: 26 };
  const h = hues[cuisine] ?? 220;
  const safe = name.replace(/&/g, "and").replace(/</g, "").replace(/>/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
<rect width="320" height="240" fill="hsl(${h},42%,88%)"/>
<circle cx="160" cy="104" r="58" fill="hsl(${h},48%,72%)"/>
<circle cx="160" cy="104" r="38" fill="hsl(${h},52%,62%)"/>
<text x="160" y="204" font-family="Arial,Helvetica,sans-serif" font-size="17" fill="hsl(${h},46%,26%)" text-anchor="middle">${safe}</text>
</svg>`;
}

async function ensureTable() {
  try {
    await rawDdb.send(new DescribeTableCommand({ TableName: TABLE }));
    console.log(`Table ${TABLE} already exists`);
  } catch (err) {
    if (err.name !== "ResourceNotFoundException") throw err;
    console.log(`Creating table ${TABLE}...`);
    await rawDdb.send(
      new CreateTableCommand({
        TableName: TABLE,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" }
        ],
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" }
        ]
      })
    );
    await waitUntilTableExists({ client: rawDdb, maxWaitTime: 180 }, { TableName: TABLE });
    console.log("Table ready");
  }

  try {
    await rawDdb.send(
      new UpdateContinuousBackupsCommand({
        TableName: TABLE,
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }
      })
    );
    console.log("Point-in-time recovery enabled (gives you the native comparison on stage)");
  } catch (err) {
    console.warn(`Could not enable PITR: ${err.name}. Continuing.`);
  }
}

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log(`Bucket ${BUCKET} already exists`);
    return;
  } catch (err) {
    if (err.$metadata?.httpStatusCode !== 404 && err.name !== "NotFound") {
      console.warn(`HeadBucket returned ${err.name}. Attempting create anyway.`);
    }
  }
  console.log(`Creating bucket ${BUCKET}...`);
  const input = { Bucket: BUCKET };
  if (REGION !== "us-east-1") {
    input.CreateBucketConfiguration = { LocationConstraint: REGION };
  }
  await s3.send(new CreateBucketCommand(input));
  console.log("Bucket ready");
}

async function writeBatch(items) {
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: { [TABLE]: chunk.map((Item) => ({ PutRequest: { Item } })) }
      })
    );
  }
}

async function seedTenant(tenant, index) {
  const pk = `TENANT#${tenant.slug}`;
  const menu = defaultMenu(tenant.slug);
  const items = [];

  items.push({
    pk,
    sk: "PROFILE",
    entity: "tenant",
    name: tenant.name,
    cuisine: tenant.cuisine,
    status: "active"
  });

  for (const m of menu) {
    items.push({
      pk,
      sk: `MENU#${m.id}`,
      entity: "menuItem",
      itemId: m.id,
      name: m.name,
      price: m.price,
      imageKey: `menu/${tenant.slug}/${m.id}.svg`
    });
  }

  const modifierPool = ["Extra sauce", "No chilli", "Large", "Side salad", "Gluten free"];
  const base = 40000 + index * 1000;

  for (let i = 0; i < ORDERS_PER_TENANT; i++) {
    const m = pick(menu);
    const mods = [];
    const modCount = Math.floor(Math.random() * 3);
    for (let k = 0; k < modCount; k++) mods.push(pick(modifierPool));
    const modTotal = mods.length * 0.75;
    const qty = 1 + Math.floor(Math.random() * 2);
    const total = Number((m.price * qty + modTotal).toFixed(2));
    const placedAt = new Date(Date.now() - Math.floor(Math.random() * 6 * 3600 * 1000)).toISOString();

    items.push({
      pk,
      sk: `ORDER#${base + i}`,
      entity: "order",
      orderId: String(base + i),
      itemId: m.id,
      itemName: m.name,
      quantity: qty,
      modifiers: mods,
      unitPrice: m.price,
      total,
      placedAt,
      status: pick(["preparing", "ready", "collected"])
    });
  }

  await writeBatch(items);

  for (const m of menu) {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `menu/${tenant.slug}/${m.id}.svg`,
        Body: menuSvg(m.name, tenant.cuisine),
        ContentType: "image/svg+xml"
      })
    );
  }

  const csv = [
    "order_id,item,quantity,total,placed_at",
    ...items
      .filter((i) => i.entity === "order")
      .slice(0, 40)
      .map((o) => `${o.orderId},${o.itemName},${o.quantity},${o.total},${o.placedAt}`)
  ].join("\n");

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `settlement/${tenant.slug}/latest.csv`,
      Body: csv,
      ContentType: "text/csv"
    })
  );

  console.log(`  ${tenant.name}: ${ORDERS_PER_TENANT} orders, ${menu.length} menu items`);
}

async function main() {
  console.log(`Region ${REGION} | table ${TABLE} | bucket ${BUCKET}\n`);
  await ensureTable();
  await ensureBucket();
  console.log("\nSeeding tenants...");
  for (let i = 0; i < TENANTS.length; i++) {
    await seedTenant(TENANTS[i], i);
  }
  console.log("\nSeed complete. Run `npm start` and open http://localhost:5173");
  console.log("Now take a Clumio backup before you break anything.");
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message);
  process.exit(1);
});
