import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const owned = join(root, "tests/commands/archive-stress");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
const gitText = (...args) => git(...args).toString().trim();
async function inventory(directory, base = directory, requireRegular = false) {
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const item = await lstat(path);
    if (requireRegular) assert.ok(!item.isSymbolicLink(), `frozen alias: ${path}`);
    const followed = item.isSymbolicLink() ? await stat(path) : item;
    if (followed.isDirectory()) entries.push(...(await inventory(path, base, requireRegular)).files);
    else {
      assert.ok(followed.isFile(), `unexpected non-file: ${path}`);
      if (requireRegular) assert.equal(followed.nlink, 1, `frozen hardlink: ${path}`);
      entries.push({ path: relative(base, path), bytes: followed.size, sha256: hash(await readFile(path)) });
    }
  }
  return { sha256: hash(JSON.stringify(entries)), files: entries };
}
async function movingSnapshot() {
  return { time: new Date().toISOString(), head: gitText("rev-parse", "HEAD"), status: gitText("status", "--porcelain=v1", "--untracked-files=all"), archive: await inventory(join(root, "src/commands/archive")) };
}
async function copyRegular(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const [original, copied] = await Promise.all([stat(source), lstat(destination)]);
  assert.ok(copied.isFile() && copied.nlink === 1 && (original.dev !== copied.dev || original.ino !== copied.ino));
  assert.equal(hash(await readFile(source)), hash(await readFile(destination)));
}

await mkdir(join(owned, ".runs"), { recursive: true });
const runDirectory = await mkdtemp(join(owned, ".runs/integration-"));
const frozen = join(runDirectory, "frozen");
await mkdir(frozen);
const movingBefore = await movingSnapshot();
const baseCommit = movingBefore.head;
git("merge-base", "--is-ancestor", "4a737f9", baseCommit);
const seed = join(runDirectory, "committed-input.tar");
await writeFile(seed, git("archive", baseCommit, "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "tests/commands/archive"));
const extracted = spawnSync("/usr/bin/tar", ["-xf", seed, "-C", frozen], { timeout: 20000, maxBuffer: 1024 * 1024 });
assert.equal(extracted.status, 0, extracted.stderr?.toString());
const sourceBefore = await inventory(join(frozen, "src"), join(frozen, "src"), true);
const archiveBefore = await inventory(join(frozen, "src/commands/archive"));
assert.equal(archiveBefore.sha256, movingBefore.archive.sha256, "archive source differs from selected committed input");

const dependenciesBefore = await inventory(join(root, "node_modules"));
await cp(join(root, "node_modules"), join(frozen, "node_modules"), { recursive: true, dereference: true });
const frozenDependenciesBefore = await inventory(join(frozen, "node_modules"), join(frozen, "node_modules"), true);
assert.equal(frozenDependenciesBefore.sha256, dependenciesBefore.sha256);
const dependencyVersions = {};
const lock = JSON.parse(await readFile(join(frozen, "package-lock.json"), "utf8"));
for (const name of ["tsx", "typescript", "@types/node", "esbuild", `@esbuild/${process.platform}-${process.arch}`]) {
  const installed = JSON.parse(await readFile(join(frozen, "node_modules", name, "package.json"), "utf8"));
  const expected = lock.packages[`node_modules/${name}`];
  assert.equal(installed.version, expected.version);
  dependencyVersions[name] = { version: installed.version, lockIntegrity: expected.integrity };
}
const oraclePath = "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar";
const pinnedOracleHash = "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66";
assert.equal(hash(await readFile(join(root, oraclePath))), pinnedOracleHash);
await copyRegular(join(root, oraclePath), join(frozen, oraclePath));
const version = spawnSync(join(frozen, oraclePath), ["--version"], { timeout: 4000, maxBuffer: 8192 });
assert.equal(version.status, 0);
assert.match(version.stdout.toString(), /^tar \(GNU tar\) 1\.35\n/u);
const harnessFiles = (await readdir(owned)).filter(name => /\.(ts|mjs|json|md)$/u.test(name));
for (const name of harnessFiles) await copyRegular(join(owned, name), join(frozen, "tests/commands/archive-stress", name));
const authorFiles = ["boundaries", "core", "lifecycle", "native", "options", "safety"].map(name => `tests/commands/archive/${name}.test.ts`);
const results = [];
function run(log, args, timeout = 120000) {
  const result = spawnSync(process.execPath, args, {
    cwd: frozen, timeout, maxBuffer: 12 * 1024 * 1024, killSignal: "SIGKILL", detached: true,
    env: { ...process.env, ARCHIVE_ACCEPTANCE_SOURCE: join(frozen, "src/commands/archive/index.ts"), ARCHIVE_ACCEPTANCE_EVIDENCE: runDirectory, TSX_DISABLE_CACHE: "1", NODE_PATH: "" },
  });
  let cleanup = "group already absent";
  if (result.pid) {
    try { process.kill(-result.pid, "SIGKILL"); cleanup = "owned process group signalled after command"; }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  const output = Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]);
  const counts = {};
  for (const label of ["tests", "pass", "fail", "skipped", "cancelled"]) {
    const match = new RegExp(`^# ${label} (\\d+)$`, "mu").exec(output.toString());
    if (match) counts[label] = Number(match[1]);
  }
  results.push({ log, executable: process.execPath, args, status: result.status, signal: result.signal, error: result.error?.message ?? null, counts, cleanup });
  process.stdout.write(`${log}: ${JSON.stringify(results.at(-1))}\n`);
  return writeFile(join(runDirectory, log), output);
}
const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-timeout=20000", "--test-concurrency=1"];
const baselineFixtures = await inventory(join(frozen, "tests/commands/archive"));
await run("baseline-author-128.tap", [...testArgs, ...authorFiles]);
const baselineFixturesAfter = await inventory(join(frozen, "tests/commands/archive"));
assert.equal(baselineFixtures.sha256, baselineFixturesAfter.sha256, "baseline fixtures changed during tests");

const fixturePaths = ["tests/commands/archive/helpers.ts", "tests/commands/archive/built-package.mjs", "tests/commands/archive/aggregate-integration.test.ts"];
for (const path of fixturePaths) await copyRegular(join(root, path), join(frozen, path));
const candidateFixturesBefore = await inventory(join(frozen, "tests"), join(frozen, "tests"), true);
await run("candidate-author-128.tap", [...testArgs, ...authorFiles]);
await run("candidate-native-5.tap", [...testArgs, "tests/commands/archive/native.test.ts"]);
await run("candidate-default-wiring-1.tap", [...testArgs, "tests/commands/archive/aggregate-integration.test.ts"]);
await run("candidate-independent-19.tap", [...testArgs, "tests/commands/archive-stress/acceptance.test.ts", "tests/commands/archive-stress/native.test.ts"]);
await run("scoped-typecheck.log", ["node_modules/typescript/bin/tsc", "-p", "tests/commands/archive-stress/tsconfig.integration.json"], 60000);
await run("built-fixture-syntax.log", ["--check", "tests/commands/archive/built-package.mjs"], 10000);
const candidateFixturesAfter = await inventory(join(frozen, "tests"), join(frozen, "tests"), true);
const sourceAfter = await inventory(join(frozen, "src"), join(frozen, "src"), true);
const frozenDependenciesAfter = await inventory(join(frozen, "node_modules"), join(frozen, "node_modules"), true);
const dependenciesAfter = await inventory(join(root, "node_modules"));
const movingAfter = await movingSnapshot();
const cleanup = [];
for (const scope of ["archive", "archive-stress"]) {
  const directory = join(frozen, "tests/commands", scope);
  for (const name of await readdir(directory)) if (name.startsWith(".native-")) {
    cleanup.push(join(directory, name));
    await rm(join(directory, name), { recursive: true, force: true });
  }
}
const stable = {
  source: sourceBefore.sha256 === sourceAfter.sha256,
  fixtures: candidateFixturesBefore.sha256 === candidateFixturesAfter.sha256,
  frozenDependencies: frozenDependenciesBefore.sha256 === frozenDependenciesAfter.sha256,
  movingDependencies: dependenciesBefore.sha256 === dependenciesAfter.sha256,
  movingArchive: movingBefore.archive.sha256 === movingAfter.archive.sha256,
  oracle: hash(await readFile(join(frozen, oraclePath))) === pinnedOracleHash,
};
const evidence = {
  classification: "Explicit handoff received; TEST INTEGRATION ONLY; not production behavior acceptance",
  attributedHistory: { authorCommit: "be29e38", authorEvidence: "0eaffb77", authorTests: 128, authorBuiltChecks: 4, curieHistoricalFrozen: { pass: 365, fail: 111, duplicateFixtureFailures: 106, unavailableOracleFailures: 5 }, originalIndependent: [{ pass: 15, tests: 18 }, { pass: 17, tests: 19 }] },
  baseCommit, rootIntegration: "4a737f9", frozen, movingBefore, movingAfter,
  isolation: "Committed complete src/tests/package snapshot plus explicit owned fixture overlays; full installed node_modules copied as regular files and byte-hashed. Moving dirty unrelated source NOT included. Node/system dylibs/native OS remain host dependencies.",
  node: { version: process.version, executable: process.execPath, sha256: hash(await readFile(process.execPath)), platform: process.platform, arch: process.arch },
  packageVersion: JSON.parse(await readFile(join(frozen, "package.json"), "utf8")).version,
  packageLockSha256: hash(await readFile(join(frozen, "package-lock.json"))), dependencyVersions,
  oracle: { path: join(frozen, oraclePath), sha256: pinnedOracleHash, version: version.stdout.toString().trim(), configuration: "Author helper hardcodes this relative path; no oracle environment variable or downloader required" },
  sourceBefore, sourceAfter, archiveBefore, baselineFixtures, baselineFixturesAfter,
  candidateFixturesBefore, candidateFixturesAfter, dependenciesBefore, dependenciesAfter,
  frozenDependenciesBefore, frozenDependenciesAfter, fixturePaths, results, stable, cleanup,
};
await writeFile(join(runDirectory, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`Evidence: ${join(runDirectory, "evidence.json")}\n`);
process.exitCode = results.some(result => result.log !== "baseline-author-128.tap" && (result.status !== 0 || (result.counts.skipped ?? 0) !== 0)) || Object.values(stable).some(value => !value) ? 1 : 0;
