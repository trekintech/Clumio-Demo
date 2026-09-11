// Deletes the demo's AWS resources. Destructive and deliberately awkward.
//
//   npm run teardown                          shows what exists, deletes nothing
//   npm run teardown -- --confirm <bucket>    actually deletes
//
// Confirmation is a flag rather than a prompt on purpose: prompts don't work
// reliably under `npm run` on Windows, and a delete that depends on an
// unreliable prompt is a bad idea. Requiring the bucket name to be typed out
// also makes it very hard to aim this at the wrong account by accident.
import {
  DeleteTableCommand,
  DescribeTableCommand,
  UpdateContinuousBackupsCommand
} from "@aws-sdk/client-dynamodb";
import {
  HeadBucketCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand
} from "@aws-sdk/client-s3";
import { rawDdb, s3 } from "../aws.js";
import { REGION, TABLE, BUCKET } from "../config.js";
import { isWindows } from "./env-syntax.js";

const M = isWindows() ? { ok: "[ok]", bad: "[!!]", info: " - " } : { ok: "✓", bad: "✗", info: "·" };
const ok = (m) => console.log(`  ${M.ok} ${m}`);
const bad = (m) => console.log(`  ${M.bad} ${m}`);
const info = (m) => console.log(`     ${m}`);

// Confirmation is "the bucket name appears in the arguments", in any form.
// It deliberately does not require a --confirm flag: `npm run teardown --
// --confirm <name>` on Windows PowerShell drops the flag and forwards only
// the value, so a flag-based check silently never fires. Matching on the name
// itself works the same whichever way the arguments survive the shell, and
// typing the exact name is the safety catch regardless.
const args = process.argv.slice(2);
const confirmed = args.includes(BUCKET);
const nameLike = args.find((a) => !a.startsWith("-") && a !== BUCKET);
const keepBucket = args.includes("--keep-bucket");
const keepTable = args.includes("--keep-table");

const absent = (err) =>
  err.name === "ResourceNotFoundException" ||
  err.name === "NotFound" ||
  err.name === "NoSuchBucket" ||
  err.$metadata?.httpStatusCode === 404;

console.log(`\nTeardown: table ${TABLE}, bucket ${BUCKET}, region ${REGION}\n`);

// ------------------------------------------------------------ what exists

let tableExists = false;
let unreadable = 0;

try {
  const d = await rawDdb.send(new DescribeTableCommand({ TableName: TABLE }));
  tableExists = true;
  const n = d.Table?.ItemCount;
  ok(`Table ${TABLE} exists${typeof n === "number" ? ` (~${n.toLocaleString("en-GB")} items at last count)` : ""}`);
} catch (err) {
  if (absent(err)) info(`Table ${TABLE} doesn't exist`);
  else {
    unreadable++;
    bad(`Couldn't check the table: ${err.name}`);
  }
}

let bucketExists = false;
try {
  await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  bucketExists = true;
  ok(`Bucket ${BUCKET} exists`);
} catch (err) {
  if (absent(err)) info(`Bucket ${BUCKET} doesn't exist`);
  else {
    unreadable++;
    bad(`Couldn't check the bucket: ${err.name}`);
  }
}

// "Couldn't check" is not the same as "isn't there" - saying nothing needs
// deleting on the back of a failed check would be a lie worth avoiding.
if (unreadable) {
  console.log("\nCouldn't determine what exists, so nothing was touched.");
  console.log("Fix the access problem above and re-run. If it's credentials:");
  console.log("  npm run setup");
  process.exit(1);
}

if (!tableExists && !bucketExists) {
  console.log("\nNothing to delete - already clean.");
  process.exit(0);
}

// --------------------------------------------------------------- dry run

if (!confirmed) {
  console.log("\nThis is a dry run. Nothing has been deleted.\n");
  if (nameLike) {
    bad(`"${nameLike}" doesn't match, so nothing was touched.`);
    info(`Expected exactly: ${BUCKET}`);
  }
  console.log("  To delete for real, pass the bucket name back:");
  console.log(`     npm run teardown -- ${BUCKET}`);
  console.log("\n  Add --keep-table or --keep-bucket to spare either one.");
  console.log("\n  Note this does NOT touch: your Clumio backups, or any CloudFront");
  console.log("  distribution you built by hand. Remove those in their own consoles.");
  process.exit(0);
}

// ---------------------------------------------------------------- delete

console.log("\nDeleting for real.\n");

if (bucketExists && !keepBucket) {
  // Versioning is enabled by the seed, so every version and delete marker has
  // to go before the bucket itself can be removed.
  console.log("  Emptying bucket (all object versions and delete markers)...");
  let removed = 0;
  let keyMarker;
  let versionMarker;

  do {
    const listed = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: BUCKET,
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker
      })
    );

    const objects = [
      ...(listed.Versions || []).map((v) => ({ Key: v.Key, VersionId: v.VersionId })),
      ...(listed.DeleteMarkers || []).map((v) => ({ Key: v.Key, VersionId: v.VersionId }))
    ];

    for (let i = 0; i < objects.length; i += 1000) {
      const slice = objects.slice(i, i + 1000);
      await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: slice, Quiet: true } }));
      removed += slice.length;
      if (removed % 5000 === 0) console.log(`     ${removed} removed...`);
    }

    keyMarker = listed.IsTruncated ? listed.NextKeyMarker : undefined;
    versionMarker = listed.IsTruncated ? listed.NextVersionIdMarker : undefined;
  } while (keyMarker || versionMarker);

  ok(`Bucket emptied (${removed} versions/markers)`);

  await s3.send(new DeleteBucketCommand({ Bucket: BUCKET }));
  ok(`Bucket ${BUCKET} deleted`);
} else if (keepBucket) {
  info("Bucket kept (--keep-bucket)");
}

if (tableExists && !keepTable) {
  // Turning PITR off first stops continuous-backup charges immediately, in
  // case the table delete is slow or is interrupted.
  try {
    await rawDdb.send(
      new UpdateContinuousBackupsCommand({
        TableName: TABLE,
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false }
      })
    );
    ok("Point-in-time recovery disabled");
  } catch {
    info("Couldn't disable PITR (it goes with the table anyway)");
  }

  await rawDdb.send(new DeleteTableCommand({ TableName: TABLE }));
  ok(`Table ${TABLE} deletion started (AWS completes it in the background)`);
} else if (keepTable) {
  info("Table kept (--keep-table)");
}

console.log("\nDone.");
console.log("\nStill costing money elsewhere, if you created them:");
console.log("  - CloudFront distribution (disable, then delete, in the CloudFront console)");
console.log("  - Clumio backups and protection policies (in the Clumio console)");
console.log("\nRe-create everything later with: npm run setup && npm run seed");
