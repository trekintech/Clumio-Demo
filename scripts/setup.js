// One setup that gets on with it: installs dependencies, resolves
// credentials, picks and creates the S3 bucket, verifies permissions, and
// tells you exactly what to run next.
//
// Fully automatic by default - it never waits for input, so it cannot hang.
// Pass --interactive (or -i) to be asked before it chooses anything.
// IMPORTANT: only Node built-ins and dependency-free local files may be
// imported at the top of this file. This script is what installs the
// dependencies, so anything importing the AWS SDK here would crash on a fresh
// clone before the install ever ran. The SDK-backed modules are imported
// dynamically further down, once `npm install` has finished.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { REGION, TABLE, BUCKET } from "../config.js";
import { setEnv, isWindows } from "./env-syntax.js";
import { ask, confirm, choose, canPrompt, closePrompt } from "./lib/prompt.js";
import { writeLocalConfig, LOCAL_CONFIG_PATH } from "./lib/local-config.js";

if (isWindows()) {
  try {
    execSync("chcp 65001", { stdio: "ignore" });
  } catch {
    /* cosmetic only */
  }
}

const M = isWindows() ? { ok: "[ok]", bad: "[!!]" } : { ok: "✓", bad: "✗" };
const ok = (m) => console.log(`  ${M.ok} ${m}`);
const bad = (m) => console.log(`  ${M.bad} ${m}`);
const info = (m) => console.log(`     ${m}`);
const step = (n, t) => console.log(`\n${n}. ${t}`);

function fail(message, hints = []) {
  console.log(`\n${message}`);
  for (const h of hints) console.log(`  ${h}`);
  closePrompt();
  process.exit(1);
}

const interactive = canPrompt();

console.log("\nKerbside setup");
console.log(
  interactive
    ? "Interactive mode: it'll ask before making choices."
    : "Automatic: it decides everything itself and tells you what it picked."
);
if (!interactive) console.log("(want to be asked instead? run: node scripts/setup.js --interactive)");

// ------------------------------------------------------- 1. dependencies

step(1, "Dependencies");
try {
  execSync("npm install --no-fund --no-audit --loglevel=error", { stdio: ["ignore", "pipe", "pipe"] });
  ok("Installed");
} catch (err) {
  console.log(err.stdout?.toString() || "");
  console.log(err.stderr?.toString() || "");
  fail("Dependency install failed - the output above should say why.");
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 20) ok(`Node ${process.version}`);
else
  fail(`Node ${process.version} is too old - this needs Node 20+.`, [
    isWindows() ? "winget install --exact --id OpenJS.NodeJS.LTS" : "brew install node",
    "Then open a new terminal and run: npm run setup"
  ]);

// Safe to load the SDK-backed modules now that dependencies are present.
const { CreateBucketCommand, HeadBucketCommand } = await import("@aws-sdk/client-s3");
const { listProfiles, credentialsWork, probeAccess, policyDocument, clientsFor, denied, absent } =
  await import("./lib/aws-probe.js");

// -------------------------------------------------------- 2. credentials

step(2, "AWS credentials");
console.log("     Checking whether AWS credentials resolve...");

let creds = await credentialsWork(REGION);

if (!creds.ok && interactive) {
  bad("No AWS credentials found.");
  const profiles = listProfiles();
  for (let attempt = 0; attempt < 3 && !creds.ok; attempt++) {
    const options = [];
    if (profiles.length) options.push({ label: `Use an existing profile (${profiles.join(", ")})`, value: "profile" });
    options.push({ label: "Sign in with IAM Identity Center / SSO", value: "sso" });
    options.push({ label: "Enter access keys", value: "keys" });
    options.push({ label: "Quit", value: "quit" });

    const pick = await choose("  How do you want to authenticate?", options);
    if (pick === "quit") break;

    try {
      if (pick === "profile") {
        const name = profiles.length === 1 ? profiles[0] : (await ask(`  Which profile? [${profiles[0]}] `)) || profiles[0];
        process.env.AWS_PROFILE = name;
        creds = await credentialsWork(REGION);
        if (!creds.ok && (await confirm(`  "${name}" didn't work - try an SSO login for it?`))) {
          execSync(`aws sso login --profile ${name}`, { stdio: "inherit" });
          creds = await credentialsWork(REGION);
        }
      } else if (pick === "sso") {
        const name = (await ask("  Profile name to create [kerbside-demo]: ")) || "kerbside-demo";
        execSync(`aws configure sso --profile ${name}`, { stdio: "inherit" });
        execSync(`aws sso login --profile ${name}`, { stdio: "inherit" });
        process.env.AWS_PROFILE = name;
        creds = await credentialsWork(REGION);
      } else if (pick === "keys") {
        const name = (await ask("  Profile name to create [kerbside-demo]: ")) || "kerbside-demo";
        execSync(`aws configure --profile ${name}`, { stdio: "inherit" });
        process.env.AWS_PROFILE = name;
        creds = await credentialsWork(REGION);
      }
    } catch {
      bad("That step needs the AWS CLI, which isn't installed.");
      info(isWindows() ? "winget install --exact --id Amazon.AWSCLI" : "brew install awscli");
      info("Then open a NEW terminal and run: npm run setup");
    }
  }
}

if (!creds.ok) {
  fail("No working AWS credentials, so nothing further can be checked.", [
    "Any source works: profile, SSO, assume-role, env vars, instance role.",
    `Set one and re-run, e.g. ${setEnv("AWS_PROFILE", "your-profile")}`,
    "Or see the README under Prerequisites."
  ]);
}

ok(process.env.AWS_PROFILE ? `Working (profile: ${process.env.AWS_PROFILE})` : "Working (default credential chain)");

// ------------------------------------------------------------- 3. bucket

step(3, "S3 bucket");

let bucket = BUCKET;

if (bucket === "kerbside-demo-assets") {
  // The default is guaranteed to collide, since S3 names are global. Pick a
  // unique one rather than making this a blocking question.
  const suggested = `kerbside-demo-assets-${randomBytes(4).toString("hex")}`;
  console.log(`     "${bucket}" is the shared default and will collide - S3 names are global.`);

  if (interactive) {
    bucket = (await ask(`  Bucket name to use, or blank for ${suggested}:`)) || suggested;
    while (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      console.log("     Lowercase letters, numbers, dots and hyphens only.");
      bucket = (await ask(`  Bucket name to use, or blank for ${suggested}:`)) || suggested;
    }
  } else {
    bucket = suggested;
    console.log(`     Picked a unique name automatically: ${bucket}`);
  }
}

process.env.KERBSIDE_BUCKET = bucket;
ok(`Using ${bucket} in ${REGION}`);

// Create it here rather than leaving it to seed, so CreateBucket permission is
// proven now and the permission probe below has a real bucket to test against.
const { s3 } = clientsFor(REGION);
let bucketReady = false;
try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  ok("Bucket already exists");
  bucketReady = true;
} catch (err) {
  if (absent(err)) {
    console.log("     Bucket doesn't exist yet. Creating it...");
    try {
      const input = { Bucket: bucket };
      if (REGION !== "us-east-1") input.CreateBucketConfiguration = { LocationConstraint: REGION };
      await s3.send(new CreateBucketCommand(input));
      ok("Bucket created");
      bucketReady = true;
    } catch (createErr) {
      if (denied(createErr)) {
        bad("Not allowed to create the bucket (s3:CreateBucket denied).");
        info("Either grant s3:CreateBucket, or create it by hand and re-run.");
      } else if (createErr.name === "BucketAlreadyExists") {
        bad(`"${bucket}" is taken by another AWS account. Re-run to get a new name,`);
        info(`or set your own: ${setEnv("KERBSIDE_BUCKET", "something-unique")}`);
      } else {
        bad(`Could not create the bucket: ${createErr.name}`);
      }
    }
  } else if (denied(err)) {
    bad(`"${bucket}" exists but isn't accessible - it likely belongs to another account.`);
    info("Re-run to get a fresh name, or set KERBSIDE_BUCKET yourself.");
  } else {
    bad(`Could not check the bucket: ${err.name}`);
  }
}

// Persist now, so the name survives into every later terminal.
writeLocalConfig({
  bucket,
  region: REGION,
  table: TABLE,
  ...(process.env.AWS_PROFILE ? { profile: process.env.AWS_PROFILE } : {})
});
ok(`Saved to ${LOCAL_CONFIG_PATH.split(/[\\/]/).pop()} - no need to set variables in new terminals`);

if (!bucketReady) {
  fail("Bucket isn't usable yet, so stopping here.");
}

// -------------------------------------------------------- 4. permissions

step(4, "Permissions");
console.log("     Probing what this role can actually do (writes and removes a test object)...");

let probe = await probeAccess({ region: REGION, table: TABLE, bucket });

while (true) {
  for (const c of probe.checks) {
    if (c.state === "ok") ok(c.label);
    else if (c.state === "denied") {
      bad(`${c.label} - DENIED`);
      if (c.detail) info(c.detail);
    } else if (c.state === "warn") bad(c.label);
    else {
      console.log(`     ${c.label}`);
      if (c.detail) info(c.detail);
    }
  }

  if (probe.blocking === 0) break;

  const actions = [...new Set(probe.checks.filter((c) => c.action).map((c) => c.action))];
  console.log("\n  Missing permissions. Add this policy to the role:\n");
  console.log(policyDocument(TABLE, bucket, REGION));
  console.log(`\n  Actions needed: ${actions.join(", ")}`);

  if (!interactive || !(await confirm("\n  Retry now?"))) {
    fail("Stopping: the role can't do what the demo needs.");
  }
  console.log();
  probe = await probeAccess({ region: REGION, table: TABLE, bucket });
}

// ------------------------------------------------------------ 5. finished

step(5, "Ready");

const seedChoice = interactive
  ? await choose("  Seed the demo data now?", [
      { label: "Small 50-tenant estate (quick, for rehearsing)", value: "small" },
      { label: "Full 4,127-tenant estate (a few minutes, for recording)", value: "full" },
      { label: "Not now", value: "no" }
    ])
  : "no";

if (seedChoice !== "no") {
  const env = { ...process.env, KERBSIDE_BUCKET: bucket };
  if (seedChoice === "small") env.SYNTHETIC_TENANT_COUNT = "50";
  closePrompt();
  console.log();
  try {
    execSync("node scripts/seed.js", { stdio: "inherit", env });
  } catch {
    console.log("\nSeeding failed - the output above should say why.");
    process.exit(1);
  }
  console.log("\nDone. Start the dashboard with: npm start");
  process.exit(0);
}

closePrompt();
console.log("  Everything checks out.");
console.log("\n  Next, load the demo data. It prints progress as it goes");
console.log("  (per tenant, then batch percentages) and takes a few minutes:");
console.log("     npm run seed     # load the demo data");
console.log("     npm start        # then open http://localhost:5173");
console.log("\n  To rehearse with a small estate first:");
console.log(`     ${isWindows() ? '$env:SYNTHETIC_TENANT_COUNT = "50"; npm run seed' : "SYNTHETIC_TENANT_COUNT=50 npm run seed"}`);
