import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as filesystem from "node:fs";
import { release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const directory = dirname(fileURLToPath(import.meta.url));
export const root = resolve(directory, "../../../..");
export const oracleDirectory = resolve(directory, "../.oracle/coreutils-9.7");
export const benchmarkStat = "/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/stat";
export const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" };
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const metadata = JSON.parse(readFileSync(resolve(directory, "../oracle-evidence.json")));
const table = JSON.parse(readFileSync(resolve(root, "tests/commands/table-text-stress/first-discrepancy.json")));
const original = JSON.parse(readFileSync(resolve(directory, "original.json")));
export const testPaths = original.snapshots.map(row => row.path);

export function assets(primary = oracleDirectory, secondary = benchmarkStat) {
  const entries = [
    { path: `${primary}.tar.xz`, sha256: metadata.archiveSha256 },
    ...Object.entries(metadata.nativeSources).map(([name, sha256]) => ({ path: resolve(primary, name), sha256 })),
    { path: resolve(primary, "src/comm.c"), sha256: "3517b5f9e88bbb67ce93e3075811d0856647104ca83c40001f7fa2dcf07c7336" },
    { path: resolve(primary, "doc/coreutils.texi"), sha256: table.manualSha256 },
    ...Object.entries(metadata.binaries).map(([command, sha256]) => ({ path: resolve(primary, "src", command), sha256, version: `${command} (GNU coreutils) 9.7` })),
    ...Object.entries(table.identities).map(([command, identity]) => ({ path: resolve(primary, "src", command), sha256: identity.sha256, version: identity.version })),
    { path: resolve(primary, "src/touch"), sha256: "47fc9af399d94e27bc94c19eba754502b38dfb80fbad3d09c5f6b237698dbf68", version: "touch (GNU coreutils) 9.7" },
    { path: secondary, sha256: "bf6f8514f2a220a3c3743154e0530baeec864b9d1f20315cd9cb5832d28c9860", version: "stat (GNU coreutils) 9.7" },
  ];
  assert.equal(metadata.archiveSha256, table.archiveSha256);
  return entries;
}

export function verifySetup({ primary = oracleDirectory, secondary = benchmarkStat, platform = process.platform, arch = process.arch } = {}) {
  const report = { profile: "GNU-coreutils-9.7-Darwin-arm64-pinned-local-builds", platform, arch, kernel: release(), node: process.version, environment, assets: [], issues: [] };
  for (const path of ["tests/commands/metadata-stress/oracle-evidence.json", "tests/commands/table-text-stress/first-discrepancy.json"]) {
    const actual = hash(readFileSync(resolve(root, path)));
    const expected = original.files.find(entry => entry.path === path).currentSha256;
    if (actual !== expected) report.issues.push({ kind: "oracle-record-mismatch", path, expected, actual });
  }
  if (platform !== "darwin" || arch !== "arm64") report.issues.push({ kind: "wrong-profile", expected: "darwin arm64", actual: `${platform} ${arch}` });
  if (Number(process.versions.node.split(".")[0]) < 22) report.issues.push({ kind: "node-prerequisite", expected: ">=22", actual: process.version });
  for (const asset of assets(primary, secondary)) {
    const record = { ...asset };
    try {
      record.actualSha256 = hash(readFileSync(asset.path));
      if (record.actualSha256 !== asset.sha256) report.issues.push({ kind: "identity-mismatch", path: asset.path, expected: asset.sha256, actual: record.actualSha256 });
    } catch (error) {
      report.issues.push({ kind: "unavailable", path: asset.path, code: error.code });
    }
    report.assets.push(record);
  }
  if (report.issues.length === 0) {
    for (const asset of report.assets.filter(entry => entry.version)) {
      const result = spawnSync(asset.path, ["--version"], { cwd: root, env: environment, encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 });
      asset.execution = { status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
      if (result.error || result.status !== 0 || result.signal || result.stdout.split("\n")[0] !== asset.version || result.stderr !== "") report.issues.push({ kind: "execution-profile", path: asset.path, execution: asset.execution });
    }
  }
  report.status = report.issues.length ? "setup-unavailable" : "setup-qualified";
  return report;
}

export function saveEvidence(name, value) {
  assert.match(name, /^[a-z0-9-]+\.json$/u);
  const path = resolve(directory, "evidence", name);
  assert.equal(existsSync(path), false, `refusing to overwrite evidence: ${path}`);
  const text = JSON.stringify(value, null, 2);
  const result = spawnSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${path}\n${text.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`, encoding: "utf8", maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return path;
}

export function selectManifestPaths(historicalPaths, profile, { sourceRoot = root, io = filesystem } = {}) {
  if (profile === undefined) return [...historicalPaths];
  assert.equal(profile.kind, "committed-current-source", "Unknown metadata source profile");
  assert.match(profile.sourceCommit, /^[a-f0-9]{40}$/u, "Metadata profile requires an actual resolved commit");
  assert.ok(Array.isArray(profile.sources) && profile.sources.length > 0, "Current source inventory is required");
  assert.equal(hash(JSON.stringify(profile.sources)), profile.sourceTreeSha256, "Current source inventory digest differs");
  sourceRoot = io.realpathSync(sourceRoot);
  const configurations = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
  const current = [];
  const regular = path => {
    const filename = resolve(sourceRoot, path), stat = io.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && io.realpathSync(filename) === filename, `Metadata input must be a regular file: ${path}`);
    return io.readFileSync(filename);
  };
  const walk = path => {
    const directory = resolve(sourceRoot, path);
    assert.ok(io.lstatSync(directory).isDirectory() && !io.lstatSync(directory).isSymbolicLink(), "Current source directory must not redirect");
    for (const name of io.readdirSync(directory)) {
      const child = `${path}/${name}`;
      if (io.lstatSync(resolve(sourceRoot, child)).isDirectory()) walk(child);
      else { regular(child); current.push(child); }
    }
  };
  walk("src");
  current.push(...configurations);
  const declared = profile.sources.map(entry => entry.path);
  assert.equal(new Set(declared).size, declared.length, "Duplicate current source inventory path");
  assert.deepEqual([...declared].sort(), current.sort(), "Current source census differs from committed inventory");
  for (const entry of profile.sources) assert.equal(hash(regular(entry.path)), entry.sha256, `Committed source bytes changed: ${entry.path}`);
  const preserved = historicalPaths.filter(path => !path.startsWith("src/") && !configurations.includes(path));
  for (const path of preserved) regular(path);
  return [...new Set([...preserved, ...declared])];
}

function manifest(profile) {
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, env: environment, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--short", "--untracked-files=no"], { cwd: root, env: environment, encoding: "utf8" });
  const source = [];
  const walk = path => {
    for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else source.push(child);
    }
  };
  walk("src");
  const paths = [...new Set([...selectManifestPaths(original.files.map(entry => entry.path), profile), ...source,
    "node_modules/tsx/package.json",
    "tests/commands/table-text-stress/cases.ts",
    "tests/commands/metadata-stress/canonical-env/runner.mjs",
    "tests/commands/metadata-stress/canonical-env/author-provenance.ts",
    "tests/commands/metadata-stress/canonical-env/author-snapshot.json",
  ])];
  return { head: profile?.sourceCommit ?? (git.status === 0 ? git.stdout.trim() : null), profile: profile?.kind ?? "historical", trackedStatus: status.status === 0 ? status.stdout : null, files: Object.fromEntries(paths.map(path => [path, hash(readFileSync(resolve(root, path)))])) };
}

export function runRelease({ sourceProfile } = {}) {
  const setup = verifySetup();
  if (setup.status !== "setup-qualified") return { status: "setup-unavailable", exitCode: 78, executedTests: 0, setup };
  const before = manifest(sourceProfile);
  const startedAt = new Date().toISOString();
  const argv = ["--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", ...testPaths];
  const result = spawnSync(process.execPath, argv, { cwd: root, env: environment, timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  const stdout = result.stdout?.toString() ?? "";
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => [name, Number(stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? NaN)]));
  const nativeRows = original.failures.filter(row => row.classification === "native-prerequisite").map(row => ({ path: row.path, name: row.name, passed: stdout.split("\n").some(line => /^ok \d+ - /u.test(line) && line.replace(/^ok \d+ - /u, "") === row.name) }));
  const after = manifest(sourceProfile);
  const unchanged = JSON.stringify(before.files) === JSON.stringify(after.files);
  const qualified = result.status === 0 && !result.error && !result.signal && counts.tests === 318 && counts.pass === 318 && counts.fail === 0 && counts.skipped === 0 && counts.cancelled === 0 && counts.todo === 0 && nativeRows.length === 22 && nativeRows.every(row => row.passed) && unchanged;
  return { status: qualified ? "qualified-scoped-pass" : "scoped-verification-failed", exitCode: qualified ? 0 : 1, startedAt, finishedAt: new Date().toISOString(), setup, before, after, unchanged, argv: [process.execPath, ...argv], counts, nativeRows, originalFailureCounts: original.originalCounts, result: { status: result.status, signal: result.signal, error: result.error?.message, stdout, stderr: result.stderr?.toString() } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, output, ...extra] = process.argv.slice(2);
  assert.ok(["check", "release"].includes(mode), "usage: node runner.mjs check|release [new-evidence-name.json]");
  assert.equal(extra.length, 0);
  const report = mode === "check" ? verifySetup() : runRelease();
  if (output) console.log(`evidence: ${saveEvidence(output, report)}`);
  console.log(JSON.stringify(mode === "check" ? report : { status: report.status, executedTests: report.executedTests ?? report.counts.tests, counts: report.counts, nativeRowsPassed: report.nativeRows?.filter(row => row.passed).length, issues: report.setup.issues }, null, 2));
  process.exitCode = report.exitCode ?? (report.status === "setup-qualified" ? 0 : 78);
}
