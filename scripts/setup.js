// Interactive setup: does what it can on its own, and for anything only you
// can decide (which profile, which bucket name, whether to install
// something) it explains what's needed and lets you answer right here,
// then carries on rather than dumping you back to the prompt.
//
// Falls back to a plain read-only report (today's behaviour) when there's no
// interactive terminal attached — CI, a piped invocation, etc. — so this can
// never sit waiting for input that will never come.
import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { REGION, TABLE, BUCKET, IMAGE_BASE_URL } from "../config.js";
import { setEnv, isWindows } from "./env-syntax.js";

// Best-effort: lets Windows Terminal / conhost render UTF-8 correctly for
// everything printed after this, including the AWS CLI's own output. Safe to
// fail silently — every string this script prints is plain ASCII regardless.
if (isWindows()) {
  try {
    execSync("chcp 65001", { stdio: "ignore" });
  } catch {
    /* cosmetic only */
  }
}

const MARK = isWindows() ? { ok: "[ok]", bad: "[!!]", info: "[--]" } : { ok: "✓", bad: "✗", info: "·" };
const INTERACTIVE = Boolean(stdin.isTTY && stdout.isTTY);
const rl = INTERACTIVE ? createInterface({ input: stdin, output: stdout }) : null;

function run(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function tryRun(cmd) {
  try {
    return { ok: true, out: run(cmd) };
  } catch (err) {
    return { ok: false, err };
  }
}

// Runs a command the user needs to see and interact with directly (an
// installer, `aws configure`, an SSO browser flow) rather than capturing it.
function runInteractive(cmd) {
  try {
    execSync(cmd, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

function ok(msg) {
  console.log(`  ${MARK.ok} ${msg}`);
}
function problem(msg) {
  console.log(`  ${MARK.bad} ${msg}`);
  return false;
}
function note(msg) {
  console.log(`  ${MARK.info} ${msg}`);
}

async function ask(question) {
  if (!rl) return "";
  return (await rl.question(question)).trim();
}

async function confirm(question, defaultYes = true) {
  if (!rl) return false;
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const answer = (await ask(question + suffix)).toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith("y");
}

console.log("Kerbside setup\n");

console.log("Installing dependencies...");
execSync("npm install", { stdio: "inherit" });
console.log();

let ready = true;

// ------------------------------------------------------------------- node

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 20) {
  ok(`Node ${process.version}`);
} else {
  ready = problem(`Node ${process.version} - this repo needs Node 20+`);
  note(isWindows() ? "winget install --exact --id OpenJS.NodeJS.LTS" : "brew install node   # macOS, or use your version manager");
  note("Open a new terminal afterwards, then re-run: npm run setup");
}

// --------------------------------------------------------------- aws cli

let awsCliOk = tryRun("aws --version").ok;
if (awsCliOk) {
  ok(`AWS CLI found (${run("aws --version")})`);
} else {
  problem("AWS CLI not found on PATH.");
  const installCmd = isWindows()
    ? "winget install --exact --id Amazon.AWSCLI --accept-source-agreements --accept-package-agreements"
    : process.platform === "darwin"
      ? "brew install awscli"
      : null; // Linux: too many install layouts to run unattended; always show the manual steps.

  if (installCmd && (await confirm(`  Install it now with: ${installCmd}?`))) {
    console.log();
    runInteractive(installCmd);
    console.log();
    if (isWindows()) {
      note("Installer finished. Windows won't pick up the new PATH in this");
      note("terminal - open a NEW one and run: npm run setup");
      ready = false;
    } else {
      awsCliOk = tryRun("aws --version").ok;
      if (awsCliOk) ok(`AWS CLI found (${run("aws --version")})`);
      else ready = problem("Still not found. Open a new terminal and re-run: npm run setup");
    }
  } else {
    ready = false;
    if (isWindows()) {
      note("winget install --exact --id Amazon.AWSCLI");
      note("Then open a NEW terminal so PATH is picked up.");
    } else if (process.platform === "darwin") {
      note("brew install awscli");
    } else {
      note('curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip');
      note("unzip awscliv2.zip && sudo ./aws/install");
    }
  }
}

// ----------------------------------------------------------- credentials

async function checkIdentity() {
  const res = tryRun("aws sts get-caller-identity --output json");
  if (!res.ok) return null;
  try {
    return JSON.parse(res.out);
  } catch {
    return null;
  }
}

function listProfiles() {
  const res = tryRun("aws configure list-profiles");
  return res.ok ? res.out.split("\n").filter(Boolean) : [];
}

if (awsCliOk) {
  let identity = await checkIdentity();

  if (!identity && INTERACTIVE) {
    problem("AWS credentials aren't resolving.");
    let attempts = 0;
    while (!identity && attempts < 3) {
      attempts++;
      const profiles = listProfiles();
      console.log();
      console.log("  What would you like to do?");
      if (profiles.length) console.log(`    1) Use an existing profile (${profiles.join(", ")})`);
      console.log("    2) Set up IAM Identity Center (SSO) now");
      console.log("    3) Set up access keys now");
      console.log("    4) Skip - I'll sort this out myself");
      const choice = await ask("  Choice: ");

      if (choice === "1" && profiles.length) {
        const name = (await ask(`  Which profile? [${profiles[0]}] `)) || profiles[0];
        process.env.AWS_PROFILE = name;
        console.log(`\n  Checking as AWS_PROFILE=${name}...`);
        identity = await checkIdentity();
        if (!identity) {
          problem(`Still not resolving as "${name}". It may need `);
          note(`aws sso login --profile ${name}`);
        }
      } else if (choice === "2") {
        const name = (await ask("  Profile name to create [kerbside-demo]: ")) || "kerbside-demo";
        console.log();
        runInteractive(`aws configure sso --profile ${name}`);
        console.log();
        runInteractive(`aws sso login --profile ${name}`);
        process.env.AWS_PROFILE = name;
        identity = await checkIdentity();
      } else if (choice === "3") {
        const name = (await ask("  Profile name to create [kerbside-demo]: ")) || "kerbside-demo";
        console.log();
        runInteractive(`aws configure --profile ${name}`);
        process.env.AWS_PROFILE = name;
        identity = await checkIdentity();
      } else {
        break;
      }

      if (!identity && choice !== "1") {
        console.log();
        if (!(await confirm("  Still not resolving. Try something else?"))) break;
      }
    }
  }

  if (identity) {
    ok(`Authenticated as ${identity.Arn}`);
    note(`Account ${identity.Account}`);
  } else {
    ready = problem("AWS credentials aren't resolving. Any source works (profile, assume-role,");
    console.log("    SSO, env vars, instance role) as long as this succeeds:");
    console.log("      aws sts get-caller-identity");
    console.log(`    e.g. ${setEnv("AWS_PROFILE", "kerbside-demo")}`);
    console.log("    or:  aws sso login --profile kerbside-demo");
  }
} else {
  note("Skipping the credential check until the AWS CLI is installed.");
}

// ---------------------------------------------------------------- bucket

let bucket = process.env.KERBSIDE_BUCKET || BUCKET;

if (bucket === "kerbside-demo-assets") {
  problem(`KERBSIDE_BUCKET is unset, defaulting to "${bucket}" - bucket names are`);
  console.log("    globally unique, this will collide with someone else's bucket.");

  if (INTERACTIVE) {
    let chosen = "";
    while (!chosen) {
      const answer = await ask("  Bucket name to use (e.g. kerbside-demo-assets-yourname): ");
      if (/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(answer)) {
        chosen = answer;
      } else if (answer) {
        console.log("    S3 bucket names: lowercase letters, numbers, dots and hyphens only.");
      }
    }
    process.env.KERBSIDE_BUCKET = chosen;
    bucket = chosen;
    ok(`KERBSIDE_BUCKET set to "${bucket}" for this session`);
  } else {
    ready = false;
    console.log(`      ${setEnv("KERBSIDE_BUCKET", "kerbside-demo-assets-<something-unique>")}`);
  }
} else {
  ok(`KERBSIDE_BUCKET set to "${bucket}"`);
}

ok(`Region ${REGION}, table ${TABLE}`);

if (IMAGE_BASE_URL) {
  ok(`IMAGE_BASE_URL set - app will read menu images via ${IMAGE_BASE_URL}`);
} else {
  note("IMAGE_BASE_URL not set - app will read menu images directly from S3 (fine for now).");
  note("Not a blocker: this is built later, after seeding. See docs/s3-demo-runbook.md.");
}

// ---------------------------------------------------------------- summary

console.log();

if (!ready) {
  rl?.close();
  console.log("Fix the item(s) above, then re-run: npm run setup");
  process.exit(1);
}

console.log("Ready. Values resolved for this session:");
console.log(`  ${setEnv("AWS_PROFILE", process.env.AWS_PROFILE || "(default credential chain)")}`);
console.log(`  ${setEnv("KERBSIDE_BUCKET", bucket)}`);
console.log();
console.log("These apply for the rest of this terminal session. Paste the same lines");
console.log("into any new terminal before running seed/start there too.");

// Only readline needs to stay open for this last question, so close it
// immediately afterwards either way - leaving it open holds the process alive.
const runNow = INTERACTIVE && (await confirm("\nRun the permission check now (npm run check-access)?"));
rl?.close();

if (runNow) {
  console.log();
  execSync("node scripts/check-access.js", { stdio: "inherit", env: process.env });
} else {
  console.log("\nNext:");
  console.log("  npm run check-access    # proves the role can actually do the work");
  console.log("  npm run seed");
}
