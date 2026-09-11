// Prompting that still works when stdin isn't a TTY.
//
// `npm run` on Windows pipes stdio through npm.ps1, so process.stdin.isTTY is
// false even though a real human is sat at a real console. Relying on isTTY
// alone means the prompts silently never appear, which is exactly the bug this
// file exists to fix. So: fall back to opening the console device directly.
import fs from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

let rl = null;
let usable = null;

function openConsole() {
  if (stdin.isTTY) return stdin;
  // CONIN$ is the Windows console input device; /dev/tty the POSIX one.
  for (const path of process.platform === "win32" ? ["\\\\.\\CONIN$", "conin$"] : ["/dev/tty"]) {
    try {
      const fd = fs.openSync(path, "r");
      return fs.createReadStream("", { fd, autoClose: false });
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

// Honour the usual CI signals, and an explicit opt-out, before anything else.
function forcedNonInteractive() {
  return Boolean(process.env.CI) || process.argv.includes("--yes") || process.argv.includes("--non-interactive");
}

export function canPrompt() {
  if (usable !== null) return usable;
  if (forcedNonInteractive()) {
    usable = false;
    return usable;
  }
  const input = openConsole();
  if (!input) {
    usable = false;
    return usable;
  }
  rl = createInterface({ input, output: stdout });
  usable = true;
  return usable;
}

export async function ask(question, fallback = "") {
  if (!canPrompt()) return fallback;
  const answer = await rl.question(question);
  return answer.trim();
}

export async function confirm(question, defaultYes = true) {
  if (!canPrompt()) return false;
  const answer = (await ask(`${question}${defaultYes ? " [Y/n] " : " [y/N] "}`)).toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith("y");
}

// Presents a numbered menu and returns the chosen option's `value`.
export async function choose(question, options) {
  if (!canPrompt()) return null;
  console.log(`\n${question}`);
  options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}`));
  while (true) {
    const answer = await ask("  Choice: ");
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
    if (!answer) return options[0].value;
    console.log("    Pick one of the numbers listed.");
  }
}

export function closePrompt() {
  rl?.close();
  rl = null;
}
