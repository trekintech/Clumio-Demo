import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { s3 } from "../aws.js";
import { BUCKET, BLAST_RADIUS } from "../config.js";

async function keysUnder(prefix) {
  const keys = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token })
    );
    for (const o of res.Contents || []) keys.push({ Key: o.Key });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function main() {
  console.log(`Simulating asset loss (deletion) in s3://${BUCKET}\n`);
  console.log(
    "The availability scenario: S3 returns 403/404 for the deleted keys, so the\n" +
      "three blast-radius restaurants lose their published menu and cannot take\n" +
      "orders. An error code is exactly what CloudFront failover can route around.\n"
  );
  let total = 0;

  for (const slug of BLAST_RADIUS) {
    const keys = [
      ...(await keysUnder(`menu/${slug}/`)),
      ...(await keysUnder(`settlement/${slug}/`))
    ];
    if (!keys.length) {
      console.log(`  ${slug}: nothing found, already gone?`);
      continue;
    }
    for (let i = 0; i < keys.length; i += 1000) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: keys.slice(i, i + 1000), Quiet: true }
        })
      );
    }
    total += keys.length;
    console.log(`  ${slug}: ${keys.length} objects removed`);
  }

  console.log(`\n${total} objects gone. Those tenants are now down.`);
  console.log("\nRecovery: request Instant Access in Clumio, then add the read-only access");
  console.log("point it gives you as a second CloudFront origin and create an origin group");
  console.log("(bucket primary, access point secondary, failover on 403 AND 404). The");
  console.log("storefront comes back before anything has been restored.");
  console.log("\nRestoring the source objects afterwards needs no switch back: CloudFront");
  console.log("retries the primary every request, so traffic drains back on its own.");
  console.log("\nSee docs/cloudfront-setup.md.");
}

main().catch((err) => {
  console.error("\nS3 incident failed:", err.message);
  process.exit(1);
});
