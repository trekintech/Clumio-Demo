// Prompting is strictly opt-in, via --interactive.
//
// Two separate attempts at auto-detecting "can I ask a question here?" both
// hung on Windows under `npm run`:
//   1. Opening CONIN$ directly succeeds but never delivers input.
//   2. stdin.isTTY can be true while stdout is a pipe, and readline writes its
//      prompt without a trailing newline - so the question sits unflushed in
//      the buffer and the user sees a frozen screen with no question on it.
//
// Rather than keep guessing, the default is now fully automatic: every caller
// has a sensible default and nothing is ever asked. Pass --interactive (or
// -i) to be asked instead. Questions are printed with console.log, so they
// always end in a newline and always appear.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

let rl = null;

export function canPrompt() {
  if (process.env.CI) return false;
  const wants = process.argv.includes("--interactive") || process.argv.includes("-i");
  return wants && Boolean(stdin.isTTY);
}

function ensure() {
  if (!rl) rl = createInterface({ input: stdin, output: stdout });
  return rl;
}

export async function ask(question, fallback = "") {
  if (!canPrompt()) return fallback;
  // Newline-terminated, so it can never be stuck in a block buffer.
  console.log(question);
  const answer = await ensure().question("> ");
  return answer.trim();
}

export async function confirm(question, defaultYes = true) {
  if (!canPrompt()) return defaultYes;
  const answer = (await ask(`${question}${defaultYes ? " [Y/n]" : " [y/N]"}`)).toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith("y");
}

export async function choose(question, options) {
  if (!canPrompt()) return options[0].value;
  while (true) {
    console.log(question);
    options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}`));
    const answer = await ask("Choose a number:");
    if (!answer) return options[0].value;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
    console.log("  Not one of the options - try again.");
  }
}

export function closePrompt() {
  rl?.close();
  rl = null;
}
