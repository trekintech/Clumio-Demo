// Shell syntax differs enough between platforms to break copy-paste, and the
// inline form (FOO=bar npm run x) does not exist on Windows at all. Keep the
// wording in one place so setup.js and the docs cannot drift apart.

export function isWindows(platform = process.platform) {
  return platform === "win32";
}

// "export FOO=bar" vs "$env:FOO = \"bar\""
export function setEnv(name, value, platform = process.platform) {
  return isWindows(platform) ? `$env:${name} = "${value}"` : `export ${name}=${value}`;
}

// One-off override for a single command. There is no inline form in
// PowerShell, so it becomes two statements.
export function envPrefixed(name, value, command, platform = process.platform) {
  return isWindows(platform)
    ? `$env:${name} = "${value}"; ${command}`
    : `${name}=${value} ${command}`;
}

export function shellName(platform = process.platform) {
  return isWindows(platform) ? "PowerShell" : "your shell";
}
