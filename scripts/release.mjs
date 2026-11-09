#!/usr/bin/env node
/**
 * Cut a Tempo release from the working tree.
 *
 *   npm run release -- patch        # 0.1.0 -> 0.1.1
 *   npm run release -- minor        # 0.1.0 -> 0.2.0
 *   npm run release -- 1.0.0        # explicit version
 *   npm run release -- patch --dry-run
 *
 * The version lives in four places and they drift the moment one is edited by
 * hand, so the bump writes all of them together: package.json,
 * package-lock.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml (with
 * its lockfile entry). The "Unreleased" changelog section is promoted to the
 * new number, the tests run, and the platform bundle is built.
 *
 * Artifacts keep Tauri's versioned names, so the DMG is already
 * Tempo_<version>_<arch>.dmg. Checksums are written next to the bundles for
 * whoever downloads them.
 *
 * Nothing is committed, tagged or pushed here — the script prints the exact
 * commands instead, because those are the steps that leave the machine.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (path) => relative(root, path) || ".";
/** Keep repo-relative paths short, but never print a wall of ../ for a target outside the repo. */
const show = (path) => {
  const local = relative(root, path);
  return local.startsWith("..") ? path : local;
};

const pkgPath = join(root, "package.json");
const lockPath = join(root, "package-lock.json");
const tauriConfPath = join(root, "src-tauri", "tauri.conf.json");
const cargoTomlPath = join(root, "src-tauri", "Cargo.toml");
const cargoLockPath = join(root, "src-tauri", "Cargo.lock");
const changelogPath = join(root, "CHANGELOG.md");

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) fail(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited with ${result.status ?? "no status"}.`);
  }
}

function npmBin(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function nextVersion(current, input) {
  const match = SEMVER.exec(current);
  if (!match) fail(`package.json has an unparseable version: "${current}".`);
  const [, major, minor, patch] = match.map(Number);
  switch (input) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      if (!SEMVER.test(input)) {
        fail(`"${input}" is not patch, minor, major or a version like 1.4.2.`);
      }
      if (input === current) return current;
      if (compare(input, current) < 0) {
        fail(`${input} is older than the current version ${current}.`);
      }
      return input;
  }
}

function compare(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/** Replace the first `occurrences` version fields, leaving dependency pins alone. */
function withVersion(text, version, occurrences) {
  let seen = 0;
  return text.replace(/("version"\s*:\s*")([^"]+)(")/g, (whole, before, _old, after) => {
    if (seen >= occurrences) return whole;
    seen += 1;
    return `${before}${version}${after}`;
  });
}

function countVersions(text) {
  return (text.match(/"version"\s*:/g) ?? []).length;
}

/**
 * Move the Unreleased body under a dated heading and leave a fresh Unreleased
 * in its place. Running this twice for the same version is a no-op, so a failed
 * build can be retried with the same command.
 */
function promoteChangelog(text, version, date) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^## Unreleased\s*$/.test(line));
  if (start === -1) fail("CHANGELOG.md has no '## Unreleased' section to promote.");

  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end === -1) end = lines.length;
  const section = lines.slice(start + 1, end).join("\n");
  if (new RegExp(`^## ${version.replace(/\./g, "\\.")} `, "m").test(section)) {
    return { text, promoted: false };
  }

  let body = section.trim();
  if (!body) body = "### Changed\n\n- Version bump.";
  const heading = [`## Unreleased`, "", `## ${version} — ${date}`, "", body, ""];
  return {
    text: [...lines.slice(0, start), ...heading, ...lines.slice(end)].join("\n"),
    promoted: true,
  };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.endsWith(".app")) out.push(full);
      else walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function bundlesForPlatform() {
  if (process.platform === "darwin") return "app,dmg";
  if (process.platform === "win32") return "nsis";
  return "deb,appimage";
}

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const wantsHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
const input = rawArgs.find((arg) => !arg.startsWith("-"));

if (wantsHelp || !input) {
  console.log(`
Bump Tempo, promote the changelog, test, and build the platform bundle.

  npm run release -- patch|minor|major|X.Y.Z [--dry-run]

  --dry-run   print every change and command without writing or building
  --help      show this message
`);
  process.exit(wantsHelp ? 0 : 1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
const cargoToml = readFileSync(cargoTomlPath, "utf8");
const cargoVersion = /^version = "([^"]+)"/m.exec(cargoToml)?.[1];

const versions = {
  "package.json": pkg.version,
  "src-tauri/tauri.conf.json": tauriConf.version,
  "src-tauri/Cargo.toml": cargoVersion,
};
const distinct = new Set(Object.values(versions));
if (distinct.size !== 1) {
  fail(
    [
      "Versions disagree, so bumping would compound the drift:",
      ...Object.entries(versions).map(([file, value]) => `  ${file}: ${value}`),
      "Align them by hand first, then rerun.",
    ].join("\n"),
  );
}

const current = pkg.version;
const version = nextVersion(current, input);
const resuming = version === current;
const date = new Date().toISOString().slice(0, 10);

console.log(`Tempo ${current} → ${version}${resuming ? " (build only, version already set)" : ""}`);

const changelogBefore = readFileSync(changelogPath, "utf8");
const changelog = resuming
  ? { text: changelogBefore, promoted: false }
  : promoteChangelog(changelogBefore, version, date);

const edits = resuming
  ? []
  : [
      { path: pkgPath, after: withVersion(readFileSync(pkgPath, "utf8"), version, 1), fields: 1 },
      {
        path: lockPath,
        after: withVersion(readFileSync(lockPath, "utf8"), version, 2),
        fields: 2,
      },
      { path: tauriConfPath, after: withVersion(readFileSync(tauriConfPath, "utf8"), version, 1), fields: 1 },
      {
        path: cargoTomlPath,
        after: cargoToml.replace(/^version = "[^"]+"/m, `version = "${version}"`),
        fields: 1,
      },
      {
        path: cargoLockPath,
        after: readFileSync(cargoLockPath, "utf8").replace(
          /(name = "tempo"\nversion = ")[^"]+(")/,
          `$1${version}$2`,
        ),
        fields: 1,
      },
      { path: changelogPath, after: changelog.text, fields: 0 },
    ];

for (const edit of edits) {
  const before = readFileSync(edit.path, "utf8");
  if (edit.after === before) continue;
  if (edit.fields > 0 && countVersions(edit.after) !== countVersions(before)) {
    fail(`Rewriting ${rel(edit.path)} changed how many version fields it has.`);
  }
  if (dryRun) {
    console.log(`  would update ${rel(edit.path)}`);
  } else {
    writeFileSync(edit.path, edit.after);
    console.log(`  updated ${rel(edit.path)}`);
  }
}

if (changelog.promoted) {
  console.log(`  changelog: Unreleased → ${version} — ${date}`);
} else if (!resuming) {
  console.log(`  changelog already has a ${version} section, left as is`);
}

if (dryRun) {
  console.log(`
Dry run — nothing was written and nothing was built. A real run then:
  npm test
  npx tauri build --bundles ${bundlesForPlatform()}
and prints the SHA-256 of each artifact.
`);
  process.exit(0);
}

const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
  cwd: root,
  encoding: "utf8",
});
if (dirty.status === 0 && dirty.stdout.trim()) {
  const count = dirty.stdout.trim().split("\n").length;
  console.log(
    `\nNote: ${count} tracked file${count === 1 ? " is" : "s are"} already modified. ` +
      "The release diff will include them.",
  );
}

step("Running the test suite");
run(npmBin("npm"), ["test"]);

step(`Building bundles (${bundlesForPlatform()})`);
run(npmBin("npx"), ["--no-install", "tauri", "build", "--bundles", bundlesForPlatform()]);

const targetDir = process.env.CARGO_TARGET_DIR
  ? resolve(root, process.env.CARGO_TARGET_DIR)
  : join(root, "src-tauri", "target");
const bundleDir = join(targetDir, "release", "bundle");

const wanted = (path) => {
  const name = path.split("/").pop() ?? "";
  const versioned = name.includes(`_${version}`);
  switch (process.platform) {
    case "darwin":
      return (versioned && name.endsWith(".dmg")) || name.endsWith(".app");
    case "win32":
      return versioned && (name.endsWith(".exe") || name.endsWith(".msi"));
    default:
      return versioned && (name.endsWith(".deb") || name.endsWith(".AppImage"));
  }
};

const artifacts = walk(bundleDir).filter(wanted);
if (artifacts.length === 0) {
  fail(`No ${version} artifacts found under ${show(bundleDir)}. Did the bundle step run?`);
}

step("Artifacts");
const sums = [];
for (const artifact of artifacts) {
  const isFile = statSync(artifact).isFile();
  const size = isFile ? ` (${(statSync(artifact).size / 1024 / 1024).toFixed(2)} MiB)` : "";
  console.log(`  ${show(artifact)}${size}`);
  if (isFile) sums.push(`${sha256(artifact)}  ${artifact.split("/").pop()}`);
}

const sumsPath = join(bundleDir, `SHA256SUMS-${version}.txt`);
writeFileSync(sumsPath, `${sums.join("\n")}\n`);
console.log(`  ${show(sumsPath)}`);

const tag = `v${version}`;
console.log(`
Next, when the diff looks right:

  git add package.json package-lock.json src-tauri/tauri.conf.json \\
          src-tauri/Cargo.toml src-tauri/Cargo.lock CHANGELOG.md dist
  git commit -m "Release ${tag}"
  git tag ${tag}
  git push && git push --tags

The tag runs the repository-level .github/workflows/release.yml, which builds all three platforms
into a draft release. The bundles above are this machine's, unsigned and
${process.platform === "darwin" ? "Apple Silicon only" : "for this platform only"}.
`);
