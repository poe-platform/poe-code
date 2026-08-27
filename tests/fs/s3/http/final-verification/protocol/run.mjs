import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../../../..");
assert.equal(process.cwd(), repository, "run from repository root");
const baseline = "0d29f4d5e90cebc6976a51ddbeba883288126aa0";
const overlay = "f65038e0d3e62b7fe4c05b47c1ab9d3ee364abbb";
const review = "42056669f2373f2d34a96bce39aecb940f183ebc";
const independent = "tests/fs/s3/http-independent";
const ownedRelative = relative(repository, owned);
const started = new Date().toISOString();
const evidence = join(owned, "evidence", started.replace(/[:.]/g, "-"));
mkdirSync(join(owned, ".tmp"), { recursive: true });
const temporary = mkdtempSync(join(owned, ".tmp", "protocol-"));
const environment = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, npm_config_cache: join(temporary, "npm-cache"), npm_config_update_notifier: "false" };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const manifest = (root, prefix) => Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
  const path = join(prefix, entry.name);
  return entry.isDirectory() ? Object.entries(manifest(root, path)) : [[path, hash(readFileSync(join(root, path)))]];
}));
const emitted = {};
function record(name, value) {
  const content = JSON.stringify(value, null, 2) + "\n";
  const filename = join(evidence, name + ".json");
  assert.equal(existsSync(filename), false, "immutable evidence destination");
  execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${filename}\n${content.trimEnd().split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  emitted[relative(owned, filename)] = hash(readFileSync(filename));
}
const commands = [];
function run(label, args, cwd = repository, expected = 0) {
  const result = spawnSync(process.execPath, args, { cwd, env: environment, encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  const row = { label, executable: process.execPath, args, cwd, timeoutMs: 180000, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  commands.push(row);
  record(label, row);
  assert.equal(result.error, undefined, label);
  assert.equal(result.signal, null, label);
  assert.equal(result.status, expected, label);
  console.log(`${label}: exit ${result.status}`);
  return row;
}
function counters(stdout) {
  return Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => {
    const found = new RegExp(`^# ${name} (\\d+)$`, "m").exec(stdout);
    assert.ok(found, `missing TAP counter ${name}`);
    return [name, Number(found[1])];
  }));
}
function checkTests(stdout, tests, failures) {
  const actual = counters(stdout);
  assert.deepEqual(actual, { tests, pass: tests - failures, fail: failures, cancelled: 0, skipped: 0, todo: 0 });
  assert.doesNotMatch(stdout, /unhandledRejection|uncaughtException|testTimeoutFailure|asynchronous activity after the test/i);
  return actual;
}
function snapshot(path, name) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  record(name, value);
  return value;
}
function prepare(label, revision) {
  const output = run(label, [join(independent, "prepare.mjs"), ...revision ? [revision] : []]);
  const location = JSON.parse(output.stdout).directory;
  assert.ok(location.startsWith(temporary + "/"));
  const setup = snapshot(join(location, "prepare.json"), label + "-details");
  assert.equal(setup.revision, baseline);
  assert.equal(setup.overlay, revision);
  for (const phase of setup.phases) {
    assert.equal(phase.status, 0);
    assert.equal(phase.signal, null);
    assert.equal(phase.error, undefined);
  }
  checkTests(setup.phases.find(phase => phase.label === "unchanged-author-unit").stdout, 69, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(setup.source, "package.json"))).dependencies ?? {}, {});
  return setup;
}
const originalInputs = {};
const currentSources = manifest(repository, "src");
const profile = {
  started, baseline, overlay, review, repository, temporary, evidence,
  head: git(["rev-parse", "HEAD"]).toString().trim(),
  status: git(["status", "--short"]).toString(), index: git(["diff", "--cached", "--name-status"]).toString(),
  node: process.version, nodePath: process.execPath, nodeSha256: hash(readFileSync(process.execPath)), versions: process.versions,
  host: { platform: platform(), arch: arch(), release: release(), cpus: cpus().map(cpu => cpu.model) },
  environment: { TMPDIR: temporary, npm_config_cache: environment.npm_config_cache, NODE_OPTIONS: process.env.NODE_OPTIONS ?? null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  tools: Object.fromEntries(["typescript", "tsx", "@types/node"].map(name => {
    const filename = join(repository, "node_modules", name, "package.json");
    return [name, { version: JSON.parse(readFileSync(filename)).version, manifestSha256: hash(readFileSync(filename)) }];
  })),
  compilerSha256: hash(readFileSync(join(repository, "node_modules/typescript/lib/_tsc.js"))),
  currentSources,
  verificationInputs: Object.fromEntries(["run.mjs", "neighbors.test.ts"].map(name => [name, hash(readFileSync(join(owned, name)))])),
};
try {
  for (const path of git(["ls-tree", "-r", "--name-only", review, independent]).toString().trim().split("\n")) {
    const committed = hash(git(["show", `${review}:${path}`]));
    const current = hash(readFileSync(join(repository, path)));
    assert.equal(current, committed, `read-only original review changed: ${path}`);
    originalInputs[path] = current;
  }
  record("inputs", { profile, originalInputs });
  const fixed = prepare("fixed-prepare", overlay);
  const differences = Object.keys({ ...currentSources, ...fixed.sourceHashes }).sort().filter(path => currentSources[path] !== fixed.sourceHashes[path]).map(path => ({ path, current: currentSources[path] ?? null, frozen: fixed.sourceHashes[path] ?? null }));
  record("source-acceptance", { baseline, overlay, differences, httpMatchesCurrent: differences.every(row => !row.path.startsWith("src/fs/s3/http/")), frozenSourceHashes: fixed.sourceHashes, packageManifest: JSON.parse(readFileSync(join(fixed.source, "package.json"))), configHashes: Object.fromEntries(["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].map(path => [path, hash(readFileSync(join(fixed.source, path)))])), builtFiles: manifest(fixed.source, "dist"), packedFiles: manifest(fixed.consumer, "node_modules/virtual-bash") });
  run("fixed-validate", [join(independent, "validate.mjs"), fixed.directory]);
  const validation = snapshot(join(fixed.directory, "validation.json"), "fixed-validation-details");
  const fixedCounts = checkTests(validation.phases[0].stdout, 129, 0);
  for (const phase of validation.phases) { assert.equal(phase.status, 0); assert.equal(phase.error, undefined); }
  run("fixed-mutants", [join(independent, "mutants.mjs"), fixed.directory]);
  const mutations = snapshot(join(fixed.directory, "mutants.json"), "fixed-mutants-details");
  assert.equal(mutations.length, 5);
  for (const mutation of mutations) {
    assert.equal(mutation.status, 1); assert.equal(mutation.signal, null); assert.equal(mutation.error, undefined);
    const counts = counters(mutation.stdout);
    assert.equal(counts.fail, mutation.failed); assert.equal(counts.cancelled, 0); assert.equal(counts.todo, 0);
    assert.equal(counts.skipped, 0);
    const emptyFileRows = mutation.stdout.split("\n").filter(line => /^ok \d+ - tests\/fs\/s3\/http-independent\/(protocol|lifecycle)\.test\.ts$/.test(line));
    assert.equal(emptyFileRows.length, 1, "Node 22 reports the other, unmatched file as a passing file wrapper");
    assert.equal(counts.pass, emptyFileRows.length);
    assert.equal(counts.tests - emptyFileRows.length, mutation.failed);
    assert.doesNotMatch(mutation.stdout + mutation.stderr, /unhandledRejection|uncaughtException|testTimeoutFailure|asynchronous activity after the test/i);
  }
  const mutationDirectory = readdirSync(fixed.directory).find(name => name.startsWith("mutation-source-"));
  assert.ok(mutationDirectory);
  assert.deepEqual(manifest(join(fixed.directory, mutationDirectory), "src"), fixed.sourceHashes);
  record("mutation-restoration", { sourceRestoredAfterEveryMutant: "unchanged mutants.mjs finally block patches and asserts original file SHA256 after each mutation; any failure prevents successful script exit", allFiveExitedSuccessfully: true, finalWholeMutantSourceHashes: manifest(join(fixed.directory, mutationDirectory), "src"), originalPreparedSourceUnchanged: manifest(fixed.source, "src"), counts: mutations.map(mutation => ({ name: mutation.name, ...counters(mutation.stdout) })) });
  const neighborPath = join(ownedRelative, "neighbors.test.ts");
  mkdirSync(dirname(join(fixed.source, neighborPath)), { recursive: true });
  copyFileSync(join(owned, "neighbors.test.ts"), join(fixed.source, neighborPath));
  const neighbors = run("fixed-neighbors", ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", neighborPath], fixed.source);
  const neighborCounts = checkTests(neighbors.stdout, 46, 0);
  run("neighbor-strict-types", [join(repository, "node_modules/typescript/bin/tsc"), "--noEmit", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node", "--typeRoots", join(repository, "node_modules/@types"), neighborPath], fixed.source);
  const old = prepare("baseline-prepare");
  const originalTests = [...Object.keys(old.authorHashes).filter(path => path.endsWith(".test.ts")), join(independent, "protocol.test.ts"), join(independent, "lifecycle.test.ts")];
  const oldRun = run("baseline-unchanged129", ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", ...originalTests], old.source, 1);
  const baselineCounts = checkTests(oldRun.stdout, 129, 4);
  const failedNames = oldRun.stdout.split("\n").filter(line => /^not ok /.test(line));
  assert.equal(failedNames.length, 4);
  assert.equal(failedNames.filter(line => line.includes("endpoint origin validation")).length, 2);
  assert.equal(failedNames.filter(line => line.includes("invalid XML comment is rejected")).length, 2);
  for (const [path, expected] of Object.entries(originalInputs)) assert.equal(hash(readFileSync(join(repository, path))), expected, `original input changed during run: ${path}`);
  assert.deepEqual(manifest(fixed.source, "src"), fixed.sourceHashes);
  assert.deepEqual(manifest(old.source, "src"), old.sourceHashes);
  const result = { started, finished: new Date().toISOString(), fixedCounts, baselineCounts, failedNames, neighborCounts, killedMutants: mutations.length, currentSourceDifferences: differences.length, frozenHttpMatchesCurrent: differences.every(row => !row.path.startsWith("src/fs/s3/http/")), sourceRestored: true, originalInputsUnchanged: true, serviceExecutions: 0, downloads: 0, activeChildren: 0, cleanup: { directory: temporary, removed: false }, commandLabels: commands.map(row => row.label) };
  rmSync(temporary, { recursive: true });
  result.cleanup.removed = !existsSync(temporary);
  assert.equal(result.cleanup.removed, true);
  record("summary", result);
  record("sha256", emitted);
  console.log(JSON.stringify({ evidence, ...result }, null, 2));
} catch (error) {
  record("failure", { message: error.message, stack: error.stack, retainedTemporary: temporary, commandLabels: commands.map(row => row.label) });
  console.error(`Evidence retained: ${evidence}\nTask-owned temporary retained: ${temporary}`);
  throw error;
}
