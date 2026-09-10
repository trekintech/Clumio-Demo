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
  console.log(`Simulating asset loss in s3://${BUCKET}\n`);
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

  console.log(`\n${total} objects gone. The storefront gallery will now show missing images.`);
  console.log("Recover them from Clumio, then refresh the dashboard.");
}

main().catch((err) => {
  console.error("\nS3 incident failed:", err.message);
  process.exit(1);
});
