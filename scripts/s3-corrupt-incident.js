import { ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../aws.js";
import { BUCKET, BLAST_RADIUS } from "../config.js";

function corruptedSvg(label) {
  const safe = label.replace(/&/g, "and").replace(/</g, "").replace(/>/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
<rect width="320" height="240" fill="#2a0e0e"/>
<rect x="0" y="40" width="320" height="18" fill="#ff3b3b"/>
<rect x="0" y="110" width="320" height="18" fill="#ff3b3b"/>
<rect x="0" y="180" width="320" height="18" fill="#ff3b3b"/>
<text x="160" y="126" font-family="ui-monospace,Menlo,monospace" font-size="22" fill="#ffffff" text-anchor="middle" font-weight="700">CORRUPTED</text>
<text x="160" y="210" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#ffb3b3" text-anchor="middle">${safe}</text>
</svg>`;
}

async function keysUnder(prefix) {
  const keys = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token })
    );
    for (const o of res.Contents || []) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function main() {
  console.log(`Simulating asset corruption (overwrite) in s3://${BUCKET}\n`);
  console.log(
    "This is the data scenario, not the availability one: every key stays in\n" +
      "place and keeps returning 200 — only the content changes. CloudFront origin\n" +
      "failover does NOT fire here, because there is no 403/404 to trigger on. That\n" +
      "is the whole point: recovery is the previous object version, not Instant\n" +
      "Access. Keep these two scenarios separate on stage.\n"
  );

  let total = 0;
  for (const slug of BLAST_RADIUS) {
    const keys = await keysUnder(`menu/${slug}/`);
    if (!keys.length) {
      console.log(`  ${slug}: nothing found, has it been seeded?`);
      continue;
    }
    for (const key of keys) {
      const label = key.split("/").pop();
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: corruptedSvg(label),
          ContentType: "image/svg+xml"
        })
      );
    }
    total += keys.length;
    console.log(`  ${slug}: ${keys.length} objects overwritten in place`);
  }

  console.log(`\n${total} objects corrupted (each key unchanged, still returns 200).`);
  console.log("Recover the previous object version from Clumio, then refresh the dashboard.");
}

main().catch((err) => {
  console.error("\nS3 corruption simulation failed:", err.message);
  process.exit(1);
});
