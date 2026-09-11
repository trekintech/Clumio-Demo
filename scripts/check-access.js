// Proves the credentials you're about to demo with can actually do the work,
// rather than just existing. `aws sts get-caller-identity` succeeding tells
// you nothing about whether the role can create a table or write an object.
//
//   npm run check-access                 probe, including a write round-trip
//   npm run check-access -- --read-only  skip the write probes
//
// Probes deliberately use the AWS SDK, not the CLI, because that's the exact
// credential path server.js and the seed use. The CLI can resolve differently.
import { execSync } from "node:child_process";
import {
  DescribeTableCommand,
  DescribeContinuousBackupsCommand,
  ListTablesCommand
} from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  HeadBucketCommand,
  GetBucketVersioningCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";
import { ddb, rawDdb, s3 } from "../aws.js";
import { REGION, TABLE, BUCKET } from "../config.js";
import { setEnv, isWindows } from "./env-syntax.js";

const READ_ONLY = process.argv.includes("--read-only");
const M = isWindows()
  ? { ok: "[ok]", bad: "[!!]", warn: "[??]", info: "[--]" }
  : { ok: "✓", bad: "✗", warn: "!", info: "·" };

let blocking = 0;
const missing = new Set();

const ok = (m) => console.log(`  ${M.ok} ${m}`);
const info = (m) => console.log(`  ${M.info} ${m}`);
const warn = (m) => console.log(`  ${M.warn} ${m}`);
const bad = (m, action) => {
  console.log(`  ${M.bad} ${m}`);
  if (action) missing.add(action);
  blocking++;
};

const denied = (err) =>
  err.name === "AccessDenied" ||
  err.name === "AccessDeniedException" ||
  err.name === "Forbidden" ||
  err.$metadata?.httpStatusCode === 403;

const absent = (err) =>
  err.name === "ResourceNotFoundException" ||
  err.name === "NotFound" ||
  err.name === "NoSuchBucket" ||
  err.$metadata?.httpStatusCode === 404;

// ---------------------------------------------------------------- identity

console.log("\nAccess check\n");
console.log(`Target: table ${TABLE}, bucket ${BUCKET}, region ${REGION}\n`);

let identity;
try {
  identity = JSON.parse(
    execSync("aws sts get-caller-identity --output json", {
      stdio: ["ignore", "pipe", "pipe"]
    }).toString()
  );
  ok(`Authenticated as ${identity.Arn}`);
  info(`Account ${identity.Account}`);

  if (identity.Arn.includes(":assumed-role/")) {
    const role = identity.Arn.split("/")[1];
    info(`Using assumed role "${role}". Permissions below are that role's.`);
  } else if (identity.Arn.includes(":user/")) {
    info("Using an IAM user's long-lived keys rather than a role.");
  }
} catch {
  bad("No credentials resolved. Nothing below can be checked.");
  console.log("\n    Which profile do you want? Configured ones:");
  try {
    const profiles = execSync("aws configure list-profiles", {
      stdio: ["ignore", "pipe", "pipe"]
    })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    if (profiles.length) {
      for (const p of profiles) console.log(`      ${p}`);
      console.log(`\n    Pick one for this session:`);
      console.log(`      ${setEnv("AWS_PROFILE", profiles[0])}`);
      console.log("    If it's an SSO profile you may need to sign in first:");
      console.log(`      aws sso login --profile ${profiles[0]}`);
    } else {
      console.log("      (none configured  -  see README Prerequisites)");
    }
  } catch {
    console.log("      (couldn't list profiles; is the AWS CLI installed?)");
  }
  process.exit(1);
}

// Show what else is available, so an existing profile gets used rather than
// a new one invented.
try {
  const profiles = execSync("aws configure list-profiles", {
    stdio: ["ignore", "pipe", "pipe"]
  })
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  const active = process.env.AWS_PROFILE;
  if (profiles.length) {
    info(
      active
        ? `AWS_PROFILE=${active} (others available: ${profiles.filter((p) => p !== active).join(", ") || "none"})`
        : `No AWS_PROFILE set, using the default chain. Configured profiles: ${profiles.join(", ")}`
    );
  }
} catch {
  /* CLI missing; identity already proved credentials work */
}

// --------------------------------------------------------------- dynamodb

console.log("\nDynamoDB");

let tableExists = false;
try {
  await rawDdb.send(new DescribeTableCommand({ TableName: TABLE }));
  tableExists = true;
  ok(`DescribeTable  -  table ${TABLE} exists`);
} catch (err) {
  if (absent(err)) {
    ok(`DescribeTable  -  allowed (table ${TABLE} doesn't exist yet, which is fine)`);
  } else if (denied(err)) {
    bad("DescribeTable denied", "dynamodb:DescribeTable");
  } else {
    bad(`DescribeTable failed: ${err.name}`);
  }
}

try {
  await rawDdb.send(new ListTablesCommand({ Limit: 1 }));
  ok("ListTables  -  allowed");
} catch (err) {
  if (denied(err)) warn("ListTables denied (not required, but usually granted alongside)");
}

if (tableExists) {
  try {
    await rawDdb.send(new DescribeContinuousBackupsCommand({ TableName: TABLE }));
    ok("DescribeContinuousBackups  -  allowed (PITR readable)");
  } catch (err) {
    if (denied(err)) {
      warn("DescribeContinuousBackups denied  -  UpdateContinuousBackups likely denied too");
      missing.add("dynamodb:UpdateContinuousBackups");
    }
  }

  if (!READ_ONLY) {
    const probePk = "TENANT#__preflight__";
    try {
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE]: [{ PutRequest: { Item: { pk: probePk, sk: "PROBE", entity: "preflight" } } }]
          }
        })
      );
      ok("BatchWriteItem  -  allowed (wrote a probe item)");
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: { [TABLE]: [{ DeleteRequest: { Key: { pk: probePk, sk: "PROBE" } } }] }
        })
      );
      info("Probe item removed.");
    } catch (err) {
      if (denied(err)) bad("BatchWriteItem denied  -  the seed cannot write", "dynamodb:BatchWriteItem");
      else bad(`BatchWriteItem failed: ${err.name}`);
    }
  }
} else {
  info("Table absent, so write and PITR permissions can't be probed yet.");
  info("They're exercised immediately by `npm run seed`, which fails fast.");
}

// --------------------------------------------------------------------- s3

console.log("\nS3");

let bucketExists = false;
try {
  await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  bucketExists = true;
  ok(`HeadBucket  -  bucket ${BUCKET} exists and is reachable`);
} catch (err) {
  if (absent(err)) {
    ok(`HeadBucket  -  allowed (bucket ${BUCKET} doesn't exist yet, which is fine)`);
  } else if (denied(err)) {
    bad(`HeadBucket returned 403 for ${BUCKET}`);
    console.log("      Either the role lacks s3:ListBucket, or this name belongs to");
    console.log("      another AWS account. Bucket names are globally unique, so if");
    console.log("      you kept a generic name, assume the latter and pick another:");
    console.log(`        ${setEnv("KERBSIDE_BUCKET", "kerbside-demo-assets-<something-unique>")}`);
  } else {
    bad(`HeadBucket failed: ${err.name}`);
  }
}

if (bucketExists) {
  try {
    await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }));
    ok("ListBucket  -  allowed");
  } catch (err) {
    if (denied(err)) bad("ListBucket denied", "s3:ListBucket");
  }

  try {
    const v = await s3.send(new GetBucketVersioningCommand({ Bucket: BUCKET }));
    if (v.Status === "Enabled") ok("Bucket versioning enabled (corruption scenario can roll back)");
    else warn("Bucket versioning not enabled yet  -  `npm run seed` turns it on");
  } catch (err) {
    if (denied(err)) {
      warn("GetBucketVersioning denied  -  PutBucketVersioning likely denied too");
      missing.add("s3:PutBucketVersioning");
    }
  }

  if (!READ_ONLY) {
    const key = ".kerbside-preflight/probe.txt";
    try {
      await s3.send(
        new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: "preflight", ContentType: "text/plain" })
      );
      ok("PutObject  -  allowed (wrote a probe object)");
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      ok("DeleteObject  -  allowed");
      info("Probe object removed.");
    } catch (err) {
      if (denied(err)) bad("PutObject/DeleteObject denied  -  the seed cannot upload", "s3:PutObject");
      else bad(`Write probe failed: ${err.name}`);
    }
  }
} else {
  info("Bucket absent, so object permissions can't be probed yet.");
  info("`npm run seed` creates it and will fail immediately if CreateBucket is denied.");
}

// ----------------------------------------------------------------- summary

console.log("\n" + "-".repeat(64));

const unverifiable = [];
if (!tableExists) unverifiable.push("dynamodb:CreateTable, BatchWriteItem, UpdateContinuousBackups");
if (!bucketExists) unverifiable.push("s3:CreateBucket, PutObject, GetObject, DeleteObject, PutBucketVersioning");
if (READ_ONLY) unverifiable.push("write actions (you passed --read-only)");

if (blocking === 0) {
  console.log("No permission problems found.");
  if (unverifiable.length) {
    console.log("\nStill unverified, because the resources don't exist yet:");
    for (const u of unverifiable) console.log(`  - ${u}`);
    console.log("\nThese are exercised in the first few seconds of `npm run seed`,");
    console.log("which fails immediately and harmlessly if any are denied.");
  }
  console.log("\nNext: npm run seed");
} else {
  console.log(`${blocking} problem(s) found.`);
  if (missing.size) {
    console.log("\nIAM actions to add to the role:");
    for (const a of [...missing].sort()) console.log(`  - ${a}`);
  }
  console.log("\nFull permission list is in the README under Prerequisites.");
  process.exit(1);
}
