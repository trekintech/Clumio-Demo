import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { ddb, s3 } from "../aws.js";
import { TABLE, BUCKET, TENANTS, BLAST_RADIUS } from "../config.js";
import { isCorrupt } from "../validation.js";

async function auditTenant(slug) {
  const orders = [];
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
    orders.push(...(res.Items || []));
    last = res.LastEvaluatedKey;
  } while (last);

  const bad = orders.filter(isCorrupt).length;

  const assets = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `menu/${slug}/` })
  );

  return { slug, total: orders.length, bad, assets: assets.KeyCount || 0 };
}

async function main() {
  console.log("Tenant                 Orders   Corrupt   Menu assets   State");
  console.log("-".repeat(68));

  let anyBad = false;
  let collateral = false;

  // Only the named tenants carry menus/assets worth auditing — the synthetic
  // filler (see CLAUDE.md "Scale") has no S3 objects and is never part of
  // the blast radius, so looping over all of it here would turn this
  // filmed, on-stage step into a multi-minute scan for no reason.
  for (const t of TENANTS.filter((t) => !t.synthetic)) {
    const r = await auditTenant(t.slug);
    const inBlast = BLAST_RADIUS.includes(t.slug);
    const healthy = r.bad === 0 && r.assets > 0;
    if (!healthy) anyBad = true;
    if (!healthy && !inBlast) collateral = true;

    const state = healthy ? "healthy" : "DEGRADED";
    console.log(
      `${t.name.padEnd(22)} ${String(r.total).padStart(6)}   ${String(r.bad).padStart(7)}   ${String(r.assets).padStart(11)}   ${state}`
    );
  }

  console.log("-".repeat(68));
  if (!anyBad) {
    console.log("All tenants healthy. Recovery verified.");
  } else if (collateral) {
    console.log("Tenants outside the blast radius are degraded. Investigate before recording.");
  } else {
    console.log("Only the three targeted tenants are degraded, exactly as expected.");
  }
}

main().catch((err) => {
  console.error("\nVerification failed:", err.message);
  process.exit(1);
});
