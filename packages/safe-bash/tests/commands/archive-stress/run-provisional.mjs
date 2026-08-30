import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const owned = join(root, "tests/commands/archive-stress");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else {
      assert.ok(entry.isFile(), `frozen input must be a regular file: ${path}`);
      files.push(path);
    }
  }
  return files.sort();
}
async function manifest(paths, base = root) {
  const entries = [];
  for (const path of paths) entries.push({ path: relative(base, path), sha256: hash(await readFile(path)) });
  return { sha256: hash(JSON.stringify(entries)), files: entries };
}
async function snapshot() {
  return {
    time: new Date().toISOString(), head: git("rev-parse", "HEAD"),
    gitStatus: git("status", "--porcelain=v1", "--untracked-files=all"),
    archive: await manifest(await filesBelow(join(root, "src/commands/archive"))),
    contracts: await manifest(await filesBelow(join(root, "src/contracts"))),
    package: JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
    packageLockSha256: hash(await readFile(join(root, "package-lock.json"))),
  };
}

await mkdir(join(owned, ".runs"), { recursive: true });
const runDirectory = await mkdtemp(join(owned, ".runs/provisional-"));
const frozen = join(runDirectory, "frozen");
const before = await snapshot();
for (const record of [...before.archive.files, ...before.contracts.files]) {
  const original = join(root, record.path);
  const destination = join(frozen, record.path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(original, destination);
  const [originalStat, copyStat] = await Promise.all([lstat(original), lstat(destination)]);
  assert.ok(copyStat.isFile() && copyStat.nlink === 1 && (copyStat.dev !== originalStat.dev || copyStat.ino !== originalStat.ino));
  assert.equal(hash(await readFile(destination)), record.sha256, `input changed during copy: ${record.path}`);
}
await writeFile(join(frozen, "package.json"), '{"type":"module"}\n');
const dependencies = {};
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
for (const name of ["tsx", "typescript", "@types/node", "esbuild", `@esbuild/${process.platform}-${process.arch}`]) {
  const metadata = JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8"));
  const locked = lock.packages[`node_modules/${name}`];
  assert.ok(locked, `no lock entry for ${name}`);
  assert.equal(metadata.version, locked.version, `installed ${name} differs from lock`);
  dependencies[name] = { installed: metadata.version, locked: locked.version, integrity: locked.integrity ?? null };
}
const frozenBefore = await manifest(await filesBelow(join(frozen, "src")), frozen);
const harnessPaths = (await readdir(owned)).filter(name => /\.(ts|mjs|json|md)$/u.test(name)).map(name => join(owned, name));
const harnessBefore = await manifest(harnessPaths);
const commands = [
  [process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "tests/commands/archive-stress/acceptance.test.ts", "tests/commands/archive-stress/native.test.ts"], "tests.tap", 120000],
  [process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tests/commands/archive-stress/tsconfig.json"], "typecheck.log", 60000],
];
const results = [];
for (const [executable, args, log, timeout] of commands) {
  const result = spawnSync(executable, args, {
    cwd: root, timeout, maxBuffer: 8 * 1024 * 1024, killSignal: "SIGKILL",
    env: { ...process.env, ARCHIVE_ACCEPTANCE_SOURCE: join(frozen, "src/commands/archive/index.ts"), ARCHIVE_ACCEPTANCE_EVIDENCE: runDirectory },
  });
  await writeFile(join(runDirectory, log), Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]));
  results.push({ executable, args, log, status: result.status, signal: result.signal, error: result.error?.message ?? null });
  process.stdout.write(`${log}: status=${result.status}\n`);
}
const after = await snapshot();
const frozenAfter = await manifest(await filesBelow(join(frozen, "src")), frozen);
const harnessAfter = await manifest(harnessPaths);
const report = {
  classification: "PROVISIONAL initial independent corpus; no production handoff; not final acceptance",
  limitations: ["Only archive and contracts are frozen regular copies, not aliases or hardlinks", "MemoryFS, Shell and byte-command runtime dependencies remain live and were not source-inspected or frozen", "Scoped typecheck follows live transitive imports; it is not whole-repository validation", "Dependency installed versions match lock; lock integrity strings recorded, not a fresh package content attestation", "No registry/jq audit, upstream access, network, installation, branch, staging or commit"],
  node: process.version, platform: process.platform, arch: process.arch, dependencies,
  runDirectory, before, after, frozenBefore, frozenAfter, harnessBefore, harnessAfter, results,
  stableArchive: before.archive.sha256 === after.archive.sha256,
  stableContracts: before.contracts.sha256 === after.contracts.sha256,
  stableFrozen: frozenBefore.sha256 === frozenAfter.sha256,
  stableHarness: harnessBefore.sha256 === harnessAfter.sha256,
};
await writeFile(join(runDirectory, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Evidence: ${join(runDirectory, "evidence.json")}\n`);
process.exitCode = results.some(result => result.status !== 0) || !report.stableFrozen || !report.stableHarness ? 1 : 0;
