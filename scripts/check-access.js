// Standalone permission check. `npm run setup` runs this same probe as part
// of its flow; this is here for re-checking later without the full setup.
//
//   npm run check-access
//   npm run check-access -- --read-only   skip the write probes
import { REGION, TABLE, BUCKET } from "../config.js";
import { isWindows, setEnv } from "./env-syntax.js";
import { credentialsWork, probeAccess, policyDocument } from "./lib/aws-probe.js";

const READ_ONLY = process.argv.includes("--read-only");
const M = isWindows() ? { ok: "[ok]", bad: "[!!]", info: " - " } : { ok: "✓", bad: "✗", info: " - " };

console.log(`\nAccess check: table ${TABLE}, bucket ${BUCKET}, region ${REGION}\n`);

const creds = await credentialsWork(REGION);
if (!creds.ok) {
  console.log(`  ${M.bad} No AWS credentials resolved.`);
  console.log(`\n  Set one and retry, e.g. ${setEnv("AWS_PROFILE", "your-profile")}`);
  console.log("  Or run: npm run setup   (walks you through it)");
  process.exit(1);
}
console.log(
  `  ${M.ok} Credentials working${process.env.AWS_PROFILE ? ` (profile: ${process.env.AWS_PROFILE})` : ""}`
);

const probe = await probeAccess({ region: REGION, table: TABLE, bucket: BUCKET, readOnly: READ_ONLY });

for (const c of probe.checks) {
  if (c.state === "ok") console.log(`  ${M.ok} ${c.label}`);
  else if (c.state === "denied") {
    console.log(`  ${M.bad} ${c.label} - DENIED`);
    if (c.detail) console.log(`     ${c.detail}`);
  } else if (c.state === "warn") console.log(`  ${M.bad} ${c.label}`);
  else {
    console.log(`  ${M.info}${c.label}`);
    if (c.detail) console.log(`     ${c.detail}`);
  }
}

console.log();
if (probe.blocking === 0) {
  console.log("No permission problems found.");
  console.log("Next: npm run seed");
} else {
  const actions = [...new Set(probe.checks.filter((c) => c.action).map((c) => c.action))];
  console.log("Missing IAM permissions. Add this policy to the role:\n");
  console.log(policyDocument(TABLE, BUCKET, REGION));
  console.log(`\nActions needed: ${actions.join(", ")}`);
  process.exit(1);
}
