#!/usr/bin/env node
// Build, sign and install Tempo on a connected iPhone.
//
// Tauri CLI 2.12's IPA export fails on Xcode 27 ("Couldn't load
// -exportOptionsPlist"), even though the signed app is fine. So this archives
// the app and installs the signed bundle with Apple's devicectl instead.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appPath = resolve(
  root,
  "src-tauri/gen/apple/build/tempo_iOS.xcarchive/Products/Applications/Tempo.app",
);

function findDevice() {
  const out = execFileSync("xcrun", ["devicectl", "list", "devices"], {
    encoding: "utf8",
  });
  for (const line of out.split("\n")) {
    if (!/\bphysical\b/.test(line)) continue;
    const match = line.match(/([0-9A-F]{8}-[0-9A-F]{16})\s+\(UDID\)/);
    if (match) return match[1];
  }
  throw new Error(
    "No connected iPhone found. Connect it with a cable, unlock it, and tap Trust.",
  );
}

const device = process.argv[2] ?? findDevice();

console.log(`\nBuilding and signing Tempo for ${device}...\n`);
execFileSync("npx", ["tauri", "ios", "build", "--archive-only", "-d"], {
  cwd: root,
  stdio: "inherit",
});

if (!existsSync(appPath)) {
  throw new Error(`Build finished but ${appPath} is missing.`);
}

console.log(`\nInstalling ${appPath}...\n`);
execFileSync(
  "xcrun",
  ["devicectl", "device", "install", "app", "--device", device, appPath],
  { cwd: root, stdio: "inherit" },
);

console.log(
  "\nInstalled. If Tempo does not open, trust the developer on the phone:\n" +
    "  Settings → General → VPN & Device Management → Developer App → Trust.\n",
);
