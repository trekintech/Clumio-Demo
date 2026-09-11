// Guards the chicken-and-egg bug: setup.js is what installs dependencies, so
// it must not statically import anything that needs them. It regressed once
// (a static @aws-sdk/client-s3 import made a fresh clone crash before the
// install ran), so this checks it mechanically.
//
//   node scripts/lib/check-bootstrap.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const setup = path.join(root, "scripts", "setup.js");

// Local files that are themselves dependency-free, so are safe to import.
const SAFE_LOCAL = new Set([
  "../config.js",
  "./env-syntax.js",
  "./lib/prompt.js",
  "./lib/local-config.js"
]);

const source = fs.readFileSync(setup, "utf8");

// Only inspect the static import block at the top; dynamic await import() is
// exactly the fix and must not be flagged.
const staticImports = [...source.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

const offenders = staticImports.filter((spec) => {
  if (spec.startsWith("node:")) return false;
  if (SAFE_LOCAL.has(spec)) return false;
  return true;
});

if (offenders.length) {
  console.error("\nsetup.js statically imports things that need node_modules:\n");
  for (const o of offenders) console.error(`  ${o}`);
  console.error("\nThat breaks a fresh clone: setup.js runs npm install, so it cannot");
  console.error("depend on the install having already happened. Use a dynamic");
  console.error("await import() after the install step instead.\n");
  process.exit(1);
}

console.log("setup.js bootstrap imports are clean (no dependency needed before npm install)");
