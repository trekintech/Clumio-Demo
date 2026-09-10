import { QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { writeFileSync } from "node:fs";
import { ddb } from "../aws.js";
import { TABLE, BLAST_RADIUS, TENANTS } from "../config.js";

async function ordersFor(slug) {
  const out = [];
  let last;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": `TENANT#${slug}`, ":sk": "ORDER#" },
        ExclusiveStartKey: last
      })
    );
    out.push(...(res.Items || []));
    last = res.LastEvaluatedKey;
  } while (last);
  return out;
}

function corrupt(order) {
  const mode = Math.random();
  const next = { ...order, corruptedBy: "pricing-svc@4.11.2" };
  if (mode < 0.55) {
    next.total = 0;
    next.modifiers = [];
  } else {
    next.total = Number((order.unitPrice * 72 + Math.random() * 40).toFixed(2));
    next.modifiers = [];
  }
  return next;
}

async function main() {
  const stamp = new Date();
  console.log(`Simulated deploy of pricing-svc 4.11.2 at ${stamp.toISOString()}\n`);

  let touched = 0;
  for (const slug of BLAST_RADIUS) {
    const orders = await ordersFor(slug);
    const affected = orders.filter(() => Math.random() < 0.95).map(corrupt);

    for (let i = 0; i < affected.length; i += 25) {
      const chunk = affected.slice(i, i + 25);
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: { [TABLE]: chunk.map((Item) => ({ PutRequest: { Item } })) }
        })
      );
    }
    touched += affected.length;
    const name = TENANTS.find((t) => t.slug === slug)?.name || slug;
    console.log(`  ${name}: ${affected.length} of ${orders.length} orders corrupted`);
  }

  const done = new Date();
  const record = {
    deployId: "pricing-svc@4.11.2",
    startedAt: stamp.toISOString(),
    finishedAt: done.toISOString(),
    recoverToBefore: new Date(stamp.getTime() - 60000).toISOString(),
    partitionKeys: BLAST_RADIUS.map((s) => `TENANT#${s}`),
    ordersAffected: touched
  };
  writeFileSync(new URL("../incident.json", import.meta.url), JSON.stringify(record, null, 2));

  console.log(`\n${touched} orders corrupted across ${BLAST_RADIUS.length} partition keys.`);
  console.log("Written to incident.json — this is your Backtrack target.\n");
  console.log(`  Restore to a point before: ${record.recoverToBefore}`);
  console.log(`  Partition keys:            ${record.partitionKeys.join(", ")}`);
}

main().catch((err) => {
  console.error("\nDeploy simulation failed:", err.message);
  process.exit(1);
});
