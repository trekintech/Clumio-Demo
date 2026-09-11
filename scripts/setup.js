import { execSync } from "node:child_process";
import { REGION, TABLE, BUCKET, IMAGE_BASE_URL } from "../config.js";

function run(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function problem(msg) {
  console.log(`  ✗ ${msg}`);
  return false;
}

function note(msg) {
  console.log(`  · ${msg}`);
}

console.log("Kerbside setup check\n");

console.log("Installing dependencies...");
execSync("npm install", { stdio: "inherit" });
console.log();

let ready = true;

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 20) {
  ok(`Node ${process.version}`);
} else {
  ready = problem(`Node ${process.version} — this repo needs Node 20+`);
}

try {
  const version = run("aws --version");
  ok(`AWS CLI found (${version})`);
} catch {
  ready = problem("AWS CLI not found. Install it, then configure a profile before continuing.");
}

try {
  const identity = JSON.parse(run("aws sts get-caller-identity --output json"));
  ok(`AWS credentials valid — account ${identity.Account}, as ${identity.Arn}`);
} catch {
  ready = problem("AWS credentials aren't resolving. Any source works (profile, assume-role,");
  console.log("    SSO, env vars, instance role) as long as this succeeds:");
  console.log("      aws sts get-caller-identity");
  console.log("    e.g. export AWS_PROFILE=kerbside-demo, or aws sso login --profile <name>");
}

if (BUCKET === "kerbside-demo-assets") {
  ready = problem(
    `KERBSIDE_BUCKET is unset, defaulting to "${BUCKET}" — bucket names are globally unique, this will likely collide with someone else's bucket. Set your own:`
  );
  console.log("      export KERBSIDE_BUCKET=kerbside-demo-assets-<something-unique>");
} else {
  ok(`KERBSIDE_BUCKET set to "${BUCKET}"`);
}

ok(`Region ${REGION}, table ${TABLE}`);

if (IMAGE_BASE_URL) {
  ok(`IMAGE_BASE_URL set — app will read menu images via ${IMAGE_BASE_URL}`);
} else {
  note("IMAGE_BASE_URL not set — app will read menu images directly from S3 (fine for now).");
  note("Not a blocker: this is built later, after seeding. See docs/s3-demo-runbook.md.");
  note("Once the CloudFront origin group exists in the console, before the S3 clip:");
  console.log("      export IMAGE_BASE_URL=https://<distribution-id>.cloudfront.net");
}

console.log();
if (ready) {
  console.log("All checks passed. Next:");
  console.log("  npm run seed && npm start");
} else {
  console.log("Fix the item(s) above, then re-run: npm run setup");
  process.exit(1);
}
