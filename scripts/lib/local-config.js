// Remembers what setup resolved, so you don't have to re-export variables in
// every new terminal. A program can't change its parent shell's environment,
// so without this the bucket name would be lost the moment setup exits.
//
// Environment variables always win, so nothing here can override a deliberate
// choice. Git-ignored: it holds a bucket name and profile name, never secrets.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), ".kerbside-local.json");

export function readLocalConfig() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function writeLocalConfig(patch) {
  const merged = { ...readLocalConfig(), ...patch };
  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2) + "\n");
  return merged;
}

export const LOCAL_CONFIG_PATH = FILE;
