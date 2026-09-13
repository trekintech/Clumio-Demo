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
  PutObjectCommand,
  PutBucketVersioningCommand
} from "@aws-sdk/client-s3";
import { ddb, rawDdb, s3 } from "../aws.js";
import { REGION, TABLE, BUCKET, TENANTS, defaultMenu } from "../config.js";

const ORDERS_PER_TENANT = Number(process.env.ORDERS_PER_TENANT || 150);
const SYNTHETIC_ORDERS_PER_TENANT = Number(process.env.SYNTHETIC_ORDERS_PER_TENANT || 75);
const SEED_CONCURRENCY = Number(process.env.SEED_CONCURRENCY || 24);

// Written onto the menu objects so an edge cache can't mask the deletion
// scenario. Override if you deliberately want to demonstrate edge caching.
const CACHE_CONTROL = process.env.MENU_CACHE_CONTROL || "no-cache, max-age=0";

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const CUISINE_HUES = { Japanese: 18, Turkish: 32, Cafe: 200, Seafood: 195, Thai: 96, Italian: 8, Deli: 140, Spanish: 26 };

// One small hand-drawn icon per named-tenant dish, keyed by menu item id —
// flat shapes, not photography (no image-generation tool available). Falls
// back to a plain badge for anything not in this map. No baked-in text: the
// HTML caption already shows the name, and at this tile's aspect ratio
// object-fit:cover clips text near the bottom edge.
const DISH_ICONS = {
  "katsu-curry": (h) => `
<ellipse cx="160" cy="132" rx="36" ry="13" fill="#f3e9d2"/>
<rect x="126" y="92" width="68" height="24" rx="7" fill="hsl(${h},55%,42%)"/>
<path d="M132,104 q14,-14 28,0 t28,0 t28,0" fill="none" stroke="hsl(${h},75%,35%)" stroke-width="7" stroke-linecap="round"/>`,

  "bao-set": (h) => `
<path d="M110,110 Q110,72 160,72 Q210,72 210,110 Q210,124 160,124 Q110,124 110,110 Z" fill="#f6ede0"/>
<path d="M118,108 Q160,96 202,108" fill="none" stroke="#d8c9ae" stroke-width="3"/>
<ellipse cx="160" cy="113" rx="32" ry="6" fill="hsl(${h},55%,45%)"/>`,

  gyoza: (h) => `
<g fill="#f3e6d3" stroke="hsl(${h},50%,45%)" stroke-width="2">
<path d="M116,120 Q116,96 140,96 Q152,96 152,110 Q152,122 140,122 Z"/>
<path d="M148,124 Q148,98 174,98 Q188,98 188,111 Q188,125 174,125 Z"/>
<path d="M182,120 Q182,96 206,96 Q218,96 218,110 Q218,120 206,120 Z"/>
</g>`,

  ramen: (h) => `
<path d="M112,112 Q112,140 160,140 Q208,140 208,112 Z" fill="hsl(${h},60%,40%)"/>
<ellipse cx="160" cy="112" rx="48" ry="10" fill="hsl(${h},70%,55%)"/>
<path d="M138,108 q6,-8 12,0 t12,0 t12,0" fill="none" stroke="#f6ede0" stroke-width="4" stroke-linecap="round"/>
<g stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.7" fill="none">
<path d="M144,70 q-6,10 0,18"/><path d="M160,64 q-6,10 0,18"/><path d="M176,70 q-6,10 0,18"/>
</g>`,

  adana: (h) => `
<line x1="112" y1="104" x2="208" y2="104" stroke="#8a8a8a" stroke-width="4" stroke-linecap="round"/>
<g fill="hsl(${h},55%,42%)">
<rect x="122" y="90" width="26" height="28" rx="10"/>
<rect x="152" y="90" width="26" height="28" rx="10"/>
<rect x="182" y="90" width="26" height="28" rx="10"/>
</g>`,

  lahmacun: (h) => `
<ellipse cx="160" cy="104" rx="52" ry="30" fill="hsl(${h},45%,72%)" stroke="hsl(${h},50%,50%)" stroke-width="2"/>
<g fill="hsl(${h},60%,35%)">
<circle cx="140" cy="96" r="3"/><circle cx="160" cy="90" r="3"/><circle cx="178" cy="100" r="3"/>
<circle cx="148" cy="112" r="3"/><circle cx="172" cy="114" r="3"/><circle cx="160" cy="106" r="3"/>
</g>`,

  pide: (h) => `
<path d="M112,110 Q160,84 208,110 Q160,128 112,110 Z" fill="hsl(${h},50%,58%)"/>
<path d="M130,106 L190,106 M136,112 L184,112" stroke="#f6ede0" stroke-width="3" stroke-linecap="round"/>`,

  baklava: (h) => `
<g fill="hsl(${h},55%,55%)" stroke="hsl(${h},55%,35%)" stroke-width="1.5">
<rect x="126" y="80" width="34" height="34" transform="rotate(45 143 97)"/>
<rect x="162" y="80" width="34" height="34" transform="rotate(45 179 97)"/>
<rect x="144" y="108" width="34" height="34" transform="rotate(45 161 125)"/>
</g>`,

  "flat-white": (h) => `
<ellipse cx="160" cy="134" rx="44" ry="8" fill="hsl(${h},35%,80%)"/>
<path d="M132,90 h56 v30 a28,20 0 0 1 -56,0 Z" fill="#ffffff" stroke="hsl(${h},40%,60%)" stroke-width="2"/>
<path d="M188,98 q16,2 16,16 q0,14 -16,12" fill="none" stroke="hsl(${h},40%,60%)" stroke-width="4"/>
<path d="M140,100 q20,10 40,0" fill="none" stroke="hsl(${h},55%,45%)" stroke-width="3" stroke-linecap="round"/>`,

  sourdough: (h) => `
<path d="M120,120 Q120,70 160,66 Q200,70 200,120 Z" fill="hsl(${h},45%,72%)" stroke="hsl(${h},45%,45%)" stroke-width="5"/>
<g fill="hsl(${h},40%,55%)" opacity="0.6">
<circle cx="145" cy="95" r="3"/><circle cx="165" cy="88" r="2.5"/><circle cx="178" cy="102" r="3"/>
</g>`,

  granola: (h) => `
<path d="M112,108 Q112,136 160,136 Q208,136 208,108 Z" fill="hsl(${h},45%,60%)"/>
<ellipse cx="160" cy="108" rx="48" ry="10" fill="hsl(${h},55%,78%)"/>
<g fill="hsl(${h},50%,40%)">
<circle cx="140" cy="104" r="4"/><circle cx="156" cy="98" r="3.5"/><circle cx="174" cy="103" r="4"/><circle cx="182" cy="96" r="3"/>
</g>
<g fill="#c94f4f"><circle cx="148" cy="96" r="3"/><circle cx="170" cy="94" r="3"/></g>`,

  brownie: (h) => `
<rect x="128" y="80" width="64" height="48" rx="4" fill="hsl(${h},35%,30%)"/>
<path d="M132,92 q16,10 32,0 t32,0" fill="none" stroke="#f3e6d3" stroke-width="3" stroke-linecap="round" opacity="0.85"/>`,

  "house-special": (h) => `
<path d="M118,116 a42,38 0 0 1 84,0 Z" fill="hsl(${h},45%,55%)"/>
<rect x="150" y="70" width="20" height="10" rx="3" fill="hsl(${h},45%,55%)"/>
<ellipse cx="160" cy="118" rx="48" ry="8" fill="hsl(${h},35%,72%)"/>`,

  "side-salad": () => `
<path d="M114,110 Q114,136 160,136 Q206,136 206,110 Z" fill="hsl(30,40%,62%)"/>
<g fill="hsl(120,35%,42%)">
<path d="M138,100 q-6,-14 8,-16 q10,10 -8,16 Z"/>
<path d="M160,96 q-4,-16 10,-16 q8,12 -10,16 Z"/>
<path d="M182,100 q-4,-14 10,-14 q8,10 -10,14 Z"/>
</g>`,

  "soft-drink": (h) => `
<path d="M136,80 h48 l-6,56 a36,8 0 0 1 -36,0 Z" fill="hsl(${h},50%,60%)"/>
<ellipse cx="160" cy="80" rx="24" ry="6" fill="hsl(${h},55%,74%)"/>
<rect x="156" y="58" width="6" height="30" rx="3" fill="#ffffff" transform="rotate(12 159 73)"/>`
};

function menuSvg(itemId, cuisine) {
  const h = CUISINE_HUES[cuisine] ?? 220;
  const draw = DISH_ICONS[itemId] || (() => `<circle cx="160" cy="104" r="38" fill="hsl(${h},52%,62%)"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
<rect width="320" height="240" fill="hsl(${h},42%,88%)"/>
<circle cx="160" cy="104" r="58" fill="hsl(${h},48%,72%)"/>
${draw(h)}
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
  let exists = true;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log(`Bucket ${BUCKET} already exists`);
  } catch (err) {
    exists = false;
    if (err.$metadata?.httpStatusCode !== 404 && err.name !== "NotFound") {
      console.warn(`HeadBucket returned ${err.name}. Attempting create anyway.`);
    }
  }

  if (!exists) {
    console.log(`Creating bucket ${BUCKET}...`);
    const input = { Bucket: BUCKET };
    if (REGION !== "us-east-1") {
      input.CreateBucketConfiguration = { LocationConstraint: REGION };
    }
    await s3.send(new CreateBucketCommand(input));
    console.log("Bucket ready");
  }

  try {
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: BUCKET,
        VersioningConfiguration: { Status: "Enabled" }
      })
    );
    console.log("Bucket versioning enabled (the overwrite/corruption scenario rolls back to a previous version)");
  } catch (err) {
    console.warn(`Could not enable bucket versioning: ${err.name}. Continuing.`);
  }
}

// DynamoDB returns transient 500s ("Internal server error") and throttling
// under sustained concurrent load, which is precisely what seeding does. The
// SDK retries some of this, but a 500 can still surface here and would
// otherwise abandon the whole run - losing an hour's writes at 90%.
const TRANSIENT = new Set([
  "InternalServerError",
  "InternalServerErrorException",
  "ServiceUnavailable",
  "ThrottlingException",
  "ProvisionedThroughputExceededException",
  "RequestLimitExceeded",
  "TimeoutError",
  "NetworkingError",
  "ECONNRESET",
  "EPIPE"
]);

const isTransient = (err) =>
  TRANSIENT.has(err.name) ||
  TRANSIENT.has(err.code) ||
  err.$retryable?.throttling === true ||
  (err.$metadata?.httpStatusCode >= 500 && err.$metadata?.httpStatusCode < 600);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exponential backoff with jitter; jitter matters because 24 workers failing
// together would otherwise retry in lockstep and re-trigger the throttle.
const backoff = (attempt) => Math.min(8000, 2 ** attempt * 100) * (0.5 + Math.random());

async function writeRawBatch(items) {
  let chunk = items.map((Item) => ({ PutRequest: { Item } }));
  let attempt = 0;

  while (chunk.length) {
    try {
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: chunk } }));
      const leftover = res.UnprocessedItems?.[TABLE] || [];
      if (leftover.length === chunk.length) {
        // Nothing got through: we're being throttled, so back off before
        // retrying rather than spinning on it.
        attempt++;
        if (attempt > 12) throw new Error(`Gave up after ${attempt} throttled attempts`);
        await sleep(backoff(attempt));
      } else {
        attempt = 0;
      }
      chunk = leftover;
    } catch (err) {
      if (!isTransient(err)) throw err;
      attempt++;
      if (attempt > 12) throw err;
      await sleep(backoff(attempt));
    }
  }
}

async function writeBatch(items) {
  for (let i = 0; i < items.length; i += 25) {
    await writeRawBatch(items.slice(i, i + 25));
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

  // The menu is NOT in DynamoDB. It is published to S3 as the document the
  // storefront actually serves — see CLAUDE.md "What S3 holds, and why it is
  // load-bearing". Lose this object and the tenant cannot take orders at all.
  const menuDoc = {
    tenant: tenant.slug,
    name: tenant.name,
    cuisine: tenant.cuisine,
    publishedAt: new Date().toISOString(),
    items: menu.map((m) => ({
      id: m.id,
      name: m.name,
      price: m.price,
      imageKey: `menu/${tenant.slug}/${m.id}.svg`
    }))
  };

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

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `menu/${tenant.slug}/menu.json`,
      Body: JSON.stringify(menuDoc, null, 2),
      ContentType: "application/json",
      // CloudFront honours origin Cache-Control within its cache policy's TTL
      // bounds. Without this, an edge can keep serving a deleted object and
      // the S3 scenario looks like it did nothing at all.
      CacheControl: CACHE_CONTROL
    })
  );

  for (const m of menu) {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `menu/${tenant.slug}/${m.id}.svg`,
        Body: menuSvg(m.id, tenant.cuisine),
        ContentType: "image/svg+xml",
        CacheControl: CACHE_CONTROL
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

  console.log(
    `  ${tenant.name}: ${ORDERS_PER_TENANT} orders, ${menu.length} menu items published to s3://${BUCKET}/menu/${tenant.slug}/menu.json`
  );
}

// Synthetic tenants exist only to make the dropdown read as a real estate
// (see CLAUDE.md "Scale"). They get a profile and orders and nothing else —
// no menu rows, no S3 objects — so they never show up as "degraded" in the
// health check and never cost more than a few hundred KB to store.
async function seedSyntheticTenants(tenants) {
  if (!tenants.length) return;

  const modifierPool = ["Extra sauce", "No chilli", "Large", "Side salad", "Gluten free"];
  const batches = [];
  let current = [];
  const pushItem = (item) => {
    current.push(item);
    if (current.length === 25) {
      batches.push(current);
      current = [];
    }
  };

  tenants.forEach((tenant, index) => {
    const pk = `TENANT#${tenant.slug}`;
    pushItem({ pk, sk: "PROFILE", entity: "tenant", name: tenant.name, cuisine: tenant.cuisine, status: "active" });

    const menu = defaultMenu(tenant.slug);
    const base = 40000 + index * 1000;
    for (let i = 0; i < SYNTHETIC_ORDERS_PER_TENANT; i++) {
      const m = pick(menu);
      const mods = [];
      const modCount = Math.floor(Math.random() * 3);
      for (let k = 0; k < modCount; k++) mods.push(pick(modifierPool));
      const modTotal = mods.length * 0.75;
      const qty = 1 + Math.floor(Math.random() * 2);
      const total = Number((m.price * qty + modTotal).toFixed(2));
      const placedAt = new Date(Date.now() - Math.floor(Math.random() * 6 * 3600 * 1000)).toISOString();

      pushItem({
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
  });
  if (current.length) batches.push(current);

  const totalItems = tenants.length * (1 + SYNTHETIC_ORDERS_PER_TENANT);
  console.log(
    `\nSeeding ${tenants.length} synthetic tenants: ${totalItems} items in ${batches.length} batches ` +
      `(${SEED_CONCURRENCY} concurrent)...`
  );

  let done = 0;
  const logEvery = Math.max(1, Math.round(batches.length / 10 / SEED_CONCURRENCY) * SEED_CONCURRENCY);
  for (let i = 0; i < batches.length; i += SEED_CONCURRENCY) {
    const wave = batches.slice(i, i + SEED_CONCURRENCY);
    await Promise.all(wave.map(writeRawBatch));
    done += wave.length;
    if (done % logEvery === 0 || done === batches.length) {
      console.log(`  ${done}/${batches.length} batches (${Math.round((done / batches.length) * 100)}%)`);
    }
  }

  console.log(`  synthetic tenants seeded: ${tenants.length} tenants, ${totalItems} items, no S3 assets`);
}

async function main() {
  console.log(`Region ${REGION} | table ${TABLE} | bucket ${BUCKET}\n`);
  await ensureTable();
  await ensureBucket();

  const named = TENANTS.filter((t) => !t.synthetic);
  const synthetic = TENANTS.filter((t) => t.synthetic);

  console.log(`\nSeeding ${named.length} named tenants (menu, artwork, settlement CSV)...`);
  for (let i = 0; i < named.length; i++) {
    await seedTenant(named[i], i);
  }

  await seedSyntheticTenants(synthetic);

  console.log(
    `\nSeed complete: ${named.length} named + ${synthetic.length} synthetic = ${TENANTS.length} tenants total.`
  );
  console.log("Run `npm start` and open http://localhost:5173");
  console.log("Now take a Clumio backup before you break anything.");
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  console.error("\nRe-running is safe: every write overwrites by key, so nothing");
  console.error("duplicates and already-seeded tenants are simply rewritten.");
  console.error("  npm run seed");
  console.error("\nIf it keeps failing at the same point, ease off the write rate:");
  console.error(
    `  ${process.platform === "win32" ? '$env:SEED_CONCURRENCY = "8"; npm run seed' : "SEED_CONCURRENCY=8 npm run seed"}`
  );
  process.exit(1);
});
