// Runs as the npm "pre" hook on every script that touches AWS. Those scripts
// import the AWS SDK statically, so if dependencies were never installed the
// failure is Node's raw ERR_MODULE_NOT_FOUND — a stack trace pointing at
// internal module resolution, not at the actual fix. Catch it here instead,
// with only built-in Node modules so this check itself can never fail the
// same way.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isWindows } from "./env-syntax.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const marker = join(root, "node_modules", "@aws-sdk", "client-dynamodb");

if (!existsSync(marker)) {
  const M = isWindows() ? { bad: "[!!]" } : { bad: "✗" };
  console.error(`\n  ${M.bad} Dependencies aren't installed yet.\n`);
  console.error("    Run this first:");
  console.error("      npm run setup\n");
  console.error("    (that installs dependencies and checks Node/AWS CLI/credentials too)\n");
  process.exit(1);
}
