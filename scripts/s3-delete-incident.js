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
    "This is the availability scenario: S3 returns 403/404 for the deleted keys.\n" +
      "If the app is reading via presigned S3 URLs (IMAGE_BASE_URL unset), the\n" +
      "gallery will show 404 tiles. If it's reading through the CloudFront origin\n" +
      "group (IMAGE_BASE_URL set to the distribution), CloudFront should fail over\n" +
      "to the Clumio Instant Access origin with no visible change — that's the point.\n"
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

  console.log(`\n${total} objects gone.`);
  console.log("Behind CloudFront: nothing to do — Instant Access is already serving. Restoring");
  console.log("the source objects is what brings the primary origin back; CloudFront routes to");
  console.log("primary first on every request, so it picks the recovery up automatically.");
  console.log("Direct S3: recover from Clumio, then refresh the dashboard.");
}

main().catch((err) => {
  console.error("\nS3 incident failed:", err.message);
  process.exit(1);
});
