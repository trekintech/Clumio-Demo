// Optional prompting.
//
// Deliberately strict: only prompt when stdin is genuinely a TTY. An earlier
// version tried to open the console device directly (CONIN$ / dev/tty) so that
// `npm run` on Windows could still prompt - npm pipes stdio through npm.ps1,
// so isTTY is false there. Opening CONIN$ succeeds but never delivers input,
// so the script decided it could prompt and then hung forever. Not worth it.
//
// Instead: every caller must have a sensible default, prompting is a nicety,
// and nothing ever blocks. Running `node scripts/setup.js` directly (rather
// than through npm) does give a real TTY if you want the questions.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

let rl = null;

export function canPrompt() {
  if (process.env.CI || process.argv.includes("--yes") || process.argv.includes("--non-interactive")) {
    return false;
  }
  return Boolean(stdin.isTTY);
}

function ensure() {
  if (!rl) rl = createInterface({ input: stdin, output: stdout });
  return rl;
}

export async function ask(question, fallback = "") {
  if (!canPrompt()) return fallback;
  const answer = await ensure().question(question);
  return answer.trim();
}

export async function confirm(question, defaultYes = true) {
  if (!canPrompt()) return defaultYes;
  const answer = (await ask(`${question}${defaultYes ? " [Y/n] " : " [y/N] "}`)).toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith("y");
}

export async function choose(question, options) {
  if (!canPrompt()) return options[0].value;
  console.log(`\n${question}`);
  options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}`));
  while (true) {
    const answer = await ask("  Choice: ");
    if (!answer) return options[0].value;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
    console.log("    Pick one of the numbers listed.");
  }
}

export function closePrompt() {
  rl?.close();
  rl = null;
}
