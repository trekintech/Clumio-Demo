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

  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `menu/${slug}/` })
  );
  const keys = (listed.Contents || []).map((o) => o.Key);

  // menu.json is what decides whether the tenant can trade at all; images
  // are cosmetic by comparison. Report them separately.
  return {
    slug,
    total: orders.length,
    bad,
    images: keys.filter((k) => k.endsWith(".svg")).length,
    trading: keys.includes(`menu/${slug}/menu.json`)
  };
}

async function main() {
  console.log("Tenant                 Orders   Corrupt   Images   Trading   State");
  console.log("-".repeat(72));

  let anyBad = false;
  let collateral = false;

  // Only the named tenants carry menus/assets worth auditing — the synthetic
  // filler (see CLAUDE.md "Scale") has no S3 objects and is never part of
  // the blast radius, so looping over all of it here would turn this
  // filmed, on-stage step into a multi-minute scan for no reason.
  for (const t of TENANTS.filter((t) => !t.synthetic)) {
    const r = await auditTenant(t.slug);
    const inBlast = BLAST_RADIUS.includes(t.slug);
    const healthy = r.bad === 0 && r.images > 0 && r.trading;
    if (!healthy) anyBad = true;
    if (!healthy && !inBlast) collateral = true;

    // "DOWN" outranks "DEGRADED": no menu document means no orders at all.
    const state = !r.trading ? "DOWN" : healthy ? "healthy" : "DEGRADED";
    console.log(
      `${t.name.padEnd(22)} ${String(r.total).padStart(6)}   ${String(r.bad).padStart(7)}   ${String(r.images).padStart(6)}   ${(r.trading ? "yes" : "NO").padStart(7)}   ${state}`
    );
  }

  console.log("-".repeat(72));
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
