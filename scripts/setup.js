// One guided setup. Installs dependencies, resolves credentials, picks a
// bucket, verifies permissions, and offers to seed - asking whenever it needs
// a decision instead of telling you to go and run something else.
//
// Non-interactive (CI, piped, or --yes) it reports the same findings as plain
// text and exits, never waiting for input that can't arrive.
import { execSync } from "node:child_process";
import { REGION, TABLE, BUCKET } from "../config.js";
import { setEnv, isWindows } from "./env-syntax.js";
import { ask, confirm, choose, canPrompt, closePrompt } from "./lib/prompt.js";
import { listProfiles, credentialsWork, probeAccess, policyDocument } from "./lib/aws-probe.js";

if (isWindows()) {
  try {
    execSync("chcp 65001", { stdio: "ignore" });
  } catch {
    /* cosmetic only */
  }
}

const M = isWindows() ? { ok: "[ok]", bad: "[!!]", info: " - " } : { ok: "✓", bad: "✗", info: " - " };
const ok = (m) => console.log(`  ${M.ok} ${m}`);
const bad = (m) => console.log(`  ${M.bad} ${m}`);
const info = (m) => console.log(`     ${m}`);

function step(n, title) {
  console.log(`\n${n}. ${title}`);
}

function fail(message, hints = []) {
  console.log(`\n${message}`);
  for (const h of hints) console.log(`  ${h}`);
  closePrompt();
  process.exit(1);
}

let bucket = process.env.KERBSIDE_BUCKET || BUCKET;
const interactive = canPrompt();

console.log("\nKerbside setup");
if (!interactive) {
  console.log("(non-interactive: reporting only, no prompts)");
}

// ------------------------------------------------------- 1. dependencies

step(1, "Dependencies");
try {
  // Quiet by default; the funding/audit noise buries the things that matter.
  execSync("npm install --no-fund --no-audit --loglevel=error", { stdio: ["ignore", "pipe", "pipe"] });
  ok("Installed");
} catch (err) {
  console.log(err.stdout?.toString() || "");
  console.log(err.stderr?.toString() || "");
  fail("Dependency install failed. The output above should say why.");
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 20) ok(`Node ${process.version}`);
else
  fail(`Node ${process.version} is too old - this needs Node 20+.`, [
    isWindows() ? "winget install --exact --id OpenJS.NodeJS.LTS" : "brew install node",
    "Then open a new terminal and run: npm run setup"
  ]);

// -------------------------------------------------------- 2. credentials

step(2, "AWS credentials");

let creds = await credentialsWork(REGION);

if (!creds.ok && interactive) {
  bad("No AWS credentials found.");
  const profiles = listProfiles();

  let resolved = false;
  for (let attempt = 0; attempt < 3 && !resolved; attempt++) {
    const options = [];
    if (profiles.length) options.push({ label: `Use an existing profile (${profiles.join(", ")})`, value: "profile" });
    options.push({ label: "Sign in with IAM Identity Center / SSO", value: "sso" });
    options.push({ label: "Enter access keys", value: "keys" });
    options.push({ label: "Quit and sort it out myself", value: "quit" });

    const pick = await choose("  How do you want to authenticate?", options);

    if (pick === "profile") {
      const name =
        profiles.length === 1
          ? profiles[0]
          : (await ask(`  Which profile? [${profiles[0]}] `)) || profiles[0];
      process.env.AWS_PROFILE = name;
      console.log(`  Checking ${name}...`);
      creds = await credentialsWork(REGION);
      if (!creds.ok && (await confirm(`  "${name}" didn't work. It may need an SSO login. Try that now?`))) {
        try {
          execSync(`aws sso login --profile ${name}`, { stdio: "inherit" });
          creds = await credentialsWork(REGION);
        } catch {
          bad("aws sso login failed (is the AWS CLI installed?)");
        }
      }
    } else if (pick === "sso") {
      const name = (await ask("  Profile name to create [kerbside-demo]: ")) || "kerbside-demo";
      try {
        execSync(`aws configure sso --profile ${name}`, { stdio: "inherit" });
        execSync(`aws sso login --profile ${name}`, { stdio: "inherit" });
        process.env.AWS_PROFILE = name;
        creds = await credentialsWork(REGION);
      } catch {
        bad("That needs the AWS CLI, which isn't installed.");
        info(isWindows() ? "winget install --exact --id Amazon.AWSCLI" : "brew install awscli");
        info("Then open a NEW terminal and run: npm run setup");
      }
    } else if (pick === "keys") {
      const name = (await ask("  Profile name to create [kerbside-demo]: ")) || "kerbside-demo";
      try {
        execSync(`aws configure --profile ${name}`, { stdio: "inherit" });
        process.env.AWS_PROFILE = name;
        creds = await credentialsWork(REGION);
      } catch {
        bad("That needs the AWS CLI, which isn't installed.");
        info(isWindows() ? "winget install --exact --id Amazon.AWSCLI" : "brew install awscli");
      }
    } else {
      break;
    }

    resolved = creds.ok;
  }
}

if (!creds.ok) {
  fail("Still no working AWS credentials, so nothing further can be checked.", [
    "Any source works: profile, SSO, assume-role, env vars, instance role.",
    `Set one and re-run, e.g. ${setEnv("AWS_PROFILE", "your-profile")}`,
    "Full options are in the README under Prerequisites."
  ]);
}

ok(process.env.AWS_PROFILE ? `Working (profile: ${process.env.AWS_PROFILE})` : "Working (default credential chain)");

// ------------------------------------------------------------- 3. bucket

step(3, "S3 bucket name");

if (bucket === "kerbside-demo-assets") {
  if (!interactive) {
    fail('KERBSIDE_BUCKET is still the default, which will collide - bucket names are global.', [
      setEnv("KERBSIDE_BUCKET", "kerbside-demo-assets-something-unique")
    ]);
  }
  bad(`"${bucket}" is the default and will collide - S3 names are globally unique.`);
  let chosen = "";
  while (!chosen) {
    const answer = await ask("  Bucket name to use (e.g. kerbside-demo-assets-yourname): ");
    if (/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(answer)) chosen = answer;
    else if (answer) console.log("     Lowercase letters, numbers, dots and hyphens only.");
  }
  bucket = chosen;
  process.env.KERBSIDE_BUCKET = bucket;
}
ok(`Using ${bucket} in ${REGION}`);

// -------------------------------------------------------- 4. permissions

step(4, "Permissions");

let probe = await probeAccess({ region: REGION, table: TABLE, bucket });

async function reportAndMaybeRetry() {
  while (true) {
    for (const c of probe.checks) {
      if (c.state === "ok") ok(c.label);
      else if (c.state === "denied") {
        bad(`${c.label} - DENIED`);
        if (c.detail) info(c.detail);
      } else if (c.state === "warn") {
        bad(c.label);
      } else {
        console.log(`  ${M.info}${c.label}`);
        if (c.detail) info(c.detail);
      }
    }

    if (probe.blocking === 0) return true;

    const actions = [...new Set(probe.checks.filter((c) => c.action).map((c) => c.action))];
    console.log("\n  Missing IAM permissions. Add this policy to the role, then retry:");
    console.log();
    console.log(policyDocument(TABLE, bucket, REGION));
    console.log();
    console.log(`  Actions needed: ${actions.join(", ")}`);

    if (!interactive) return false;
    if (!(await confirm("\n  Retry the permission check now?"))) return false;
    console.log();
    probe = await probeAccess({ region: REGION, table: TABLE, bucket });
  }
}

const permissionsOk = await reportAndMaybeRetry();
if (!permissionsOk) {
  fail("Setup stopped: the role can't do what the demo needs.");
}

// ------------------------------------------------------------ 5. finished

step(5, "Ready");

console.log("  Keep these for any new terminal you use:");
console.log(`     ${setEnv("AWS_PROFILE", process.env.AWS_PROFILE || "(default chain)")}`);
console.log(`     ${setEnv("KERBSIDE_BUCKET", bucket)}`);

if (interactive) {
  const what = await choose("\n  Seed the demo data now?", [
    { label: "Yes, a small 50-tenant estate (fast, for rehearsing)", value: "small" },
    { label: "Yes, the full 4,127-tenant estate (a few minutes, for recording)", value: "full" },
    { label: "Not now", value: "no" }
  ]);

  if (what !== "no") {
    const env = { ...process.env, KERBSIDE_BUCKET: bucket };
    if (what === "small") env.SYNTHETIC_TENANT_COUNT = "50";
    closePrompt();
    console.log();
    try {
      execSync("node scripts/seed.js", { stdio: "inherit", env });
      console.log("\nSeeded. Start the dashboard with: npm start");
    } catch {
      console.log("\nSeeding failed - the output above should say why.");
      process.exit(1);
    }
    process.exit(0);
  }
}

closePrompt();
console.log("\nNext: npm run seed, then npm start");
