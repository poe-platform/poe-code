import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, "../../../..");
assert.equal(realpathSync(root), "/Users/kjopek/Workspace/safe-bash");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const tests = ["tests/commands/archive-stress/limits-effects.test.ts", "tests/commands/archive-stress/hardlink-identity.test.ts"];
const inputs = ["src/commands/archive", "src/contracts", "src/fs/memory", ...tests,
  "tests/commands/archive-stress/helpers.ts", "tests/commands/archive-stress/fixtures.ts", "package.json", "package-lock.json", "tsconfig.json", "node_modules"];
function files(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).sort().flatMap(name => files(join(path, name)));
}
function manifest(base, paths) {
  const records = paths.flatMap(path => files(join(base, path))).map(path => ({ path: relative(base, path), bytes: statSync(path).size, sha256: hash(readFileSync(path)) }));
  return { sha256: hash(JSON.stringify(records)), files: records };
}
function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const run = mkdtempSync(join(owned, "run-"));
const frozen = mkdtempSync(join(owned, ".runtime-"));
const report = {
  classification: "BOUNDED independent eight-case acceptance-gap cohort; ROOTREVIEW, not combined acceptance",
  started: new Date().toISOString(), node: process.version, versions: process.versions,
  platform: process.platform, arch: process.arch, nodeExecutable: realpathSync(process.execPath),
  nodeSha256: hash(readFileSync(process.execPath)),
  runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  headBefore: git(["rev-parse", "HEAD"]), statusBefore: git(["status", "--short"]),
  authorHandoff: "be29e3822736472a26450182bb3987709238e0db", run, frozen,
  limitations: ["Scoped archive + contracts + MemoryFS closure, not root aggregate, shell, adapters or whole repository validation",
    "No native subprocess extraction; prior six hardlink review checks and 128 author checks are not new passes",
    "Dependencies copied from existing installation; versions/resolved/integrity metadata checked against lock, not registry content re-attestation",
    "All product, helper, fixture and npm dependency imports use regular frozen files; Node builtins/host OS remain host runtime with executable hash checked",
    "Read-ahead criterion is a fixed 16384 source-byte / 32-pull bound at a seven-byte blocked write for 512-byte source chunks, not an RSS bound or universal host cancellation guarantee"],
  results: [],
};
try {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const installedLock = JSON.parse(readFileSync(join(root, "node_modules/.package-lock.json"), "utf8"));
  report.dependencies = Object.entries(installedLock.packages).map(([path, metadata]) => {
    const locked = lock.packages[path];
    assert.ok(locked, `unlocked installed dependency: ${path}`);
    for (const key of ["version", "resolved", "integrity"]) assert.equal(metadata[key], locked[key], `${path} ${key}`);
    assert.equal(JSON.parse(readFileSync(join(root, path, "package.json"), "utf8")).version, locked.version);
    return { path, version: locked.version, resolved: locked.resolved, integrity: locked.integrity };
  });
  report.before = manifest(root, inputs);
  for (const entry of report.before.files) {
    const original = join(root, entry.path);
    const destination = join(frozen, entry.path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(original, destination);
    chmodSync(destination, statSync(original).mode & 0o777);
    const copied = lstatSync(destination);
    const live = statSync(original);
    assert.ok(copied.isFile() && copied.nlink === 1 && (copied.dev !== live.dev || copied.ino !== live.ino), entry.path);
    assert.equal(hash(readFileSync(destination)), entry.sha256, `changed during copy: ${entry.path}`);
  }
  report.frozenBefore = manifest(frozen, inputs);
  assert.equal(report.frozenBefore.sha256, report.before.sha256);
  const { default: typescript } = await import(pathToFileURL(join(frozen, "node_modules/typescript/lib/typescript.js")).href);
  const closureImports = [];
  for (const entry of report.frozenBefore.files.filter(entry => entry.path.endsWith(".ts") && !entry.path.startsWith("node_modules/"))) {
    const contents = readFileSync(join(frozen, entry.path), "utf8");
    for (const imported of typescript.preProcessFile(contents, true, true).importedFiles) {
      const specifier = imported.fileName;
      if (specifier.startsWith("node:")) continue;
      assert.ok(specifier.startsWith("."), `unexpected runtime dependency ${specifier}`);
      const destination = resolve(dirname(join(frozen, entry.path)), specifier.replace(/\.js$/u, ".ts"));
      assert.ok(destination.startsWith(`${frozen}/`) && lstatSync(destination).isFile(), `${entry.path}: ${specifier}`);
      closureImports.push({ from: entry.path, specifier, to: relative(frozen, destination) });
    }
  }
  report.closureImports = closureImports;
  report.dynamicImport = "helpers.ts archiveUrl resolves relative to frozen import.meta.url; ARCHIVE_ACCEPTANCE_SOURCE deleted";
  const config = { extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: tests, exclude: ["node_modules"] };
  writeFileSync(join(frozen, "bounds.tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);
  report.scopedConfig = config;
  mkdirSync(join(frozen, ".tmp"));
  const env = { ...process.env, TSX_DISABLE_CACHE: "1", TMPDIR: join(frozen, ".tmp") };
  for (const key of ["ARCHIVE_ACCEPTANCE_SOURCE", "ARCHIVE_ACCEPTANCE_EVIDENCE", "NODE_OPTIONS", "NODE_PATH", "NODE_COMPILE_CACHE", "ESBUILD_BINARY_PATH", "TSX_TSCONFIG_PATH"]) delete env[key];
  report.environment = { deleted: ["ARCHIVE_ACCEPTANCE_SOURCE", "ARCHIVE_ACCEPTANCE_EVIDENCE", "NODE_OPTIONS", "NODE_PATH", "NODE_COMPILE_CACHE", "ESBUILD_BINARY_PATH", "TSX_TSCONFIG_PATH"], TSX_DISABLE_CACHE: "1", TMPDIR: env.TMPDIR };
  const commands = [
    { log: "tests.tap", args: ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", ...tests], timeout: 45000 },
    { log: "typecheck.log", args: ["node_modules/typescript/bin/tsc", "-p", "bounds.tsconfig.json"], timeout: 30000 },
  ];
  for (const command of commands) {
    const started = new Date().toISOString();
    const result = spawnSync(process.execPath, command.args, { cwd: frozen, env, timeout: command.timeout, maxBuffer: 2 * 1024 * 1024, killSignal: "SIGKILL" });
    const output = Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]);
    writeFileSync(join(run, command.log), output);
    report.results.push({ executable: process.execPath, cwd: frozen, ...command, started, ended: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, outputSha256: hash(output), outputBytes: output.length });
    console.log(`${command.log}: ${result.status}`);
  }
  report.frozenAfter = manifest(frozen, inputs);
  report.liveAfter = manifest(root, inputs);
  report.frozenStable = report.frozenBefore.sha256 === report.frozenAfter.sha256;
  report.liveInputsStable = report.before.sha256 === report.liveAfter.sha256;
  report.nodeStable = report.nodeSha256 === hash(readFileSync(process.execPath));
  assert.ok(report.frozenStable && report.nodeStable);
} catch (error) {
  report.setupOrValidationError = error instanceof Error ? error.stack : String(error);
  console.error(report.setupOrValidationError);
} finally {
  report.headAfter = git(["rev-parse", "HEAD"]);
  report.statusAfter = git(["status", "--short"]);
  report.ended = new Date().toISOString();
  assert.ok(frozen.startsWith(`${owned}/.runtime-`));
  rmSync(frozen, { recursive: true, force: true });
  report.snapshotRemoved = true;
  writeFileSync(join(run, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Evidence: ${join(run, "evidence.json")}`);
}
process.exitCode = report.setupOrValidationError || report.results.length !== 2 || report.results.some(result => result.status !== 0) ? 1 : 0;
