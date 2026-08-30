import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { applyDelta, changes, digest } from "../gnu-revised-full/delta-v1.mjs";

const repository = "/Users/kjopek/Workspace/safe-bash";
assert.equal(process.cwd(), repository);
const owned = "tests/commands/diff-patch-stress/gnu-revised-full-review";
const editor = "tests/commands/diff-patch-stress/gnu-revised-full";
const historical = "tests/commands/diff-patch-stress/gnu-followup-checkpoint";
const prior = "tests/commands/diff-patch-stress/gnu-rmdir-checkpoint";
const marker = readFileSync("/tmp/safe-bash-diff-revised-full-editor.closed", "utf8");
assert(marker.includes("ROOT RELEASE") && marker.includes("5ddce1b"));
const audit = JSON.parse(readFileSync(join(owned, "delta-audit.json")));
assert.equal(audit.markerSha256, digest(marker));
for (const [path, hash] of Object.entries(audit.editorHashes)) assert.equal(digest(readFileSync(path)), hash);
mkdirSync(join(owned, ".work"), { recursive: true });
const launch = mkdtempSync(join(repository, owned, ".work/launch-"));
const capture = spawnSync(process.execPath, [`${editor}/run.mjs`, "--proof-only"], { cwd: repository, encoding: "utf8", timeout: 180000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 });
writeFileSync(join(launch, "capture.stdout"), capture.stdout ?? "");
writeFileSync(join(launch, "capture.stderr"), capture.stderr ?? "");
assert.equal(capture.status, 0, `author-supplied snapshot/proof runner failed: ${launch}\n${capture.stderr}`);
const captureRecord = capture.stdout.trim().split("\n").map(line => JSON.parse(line)).find(record => record.proofOnly);
assert(captureRecord);
const evidence = captureRecord.evidence;
const frozen = JSON.parse(readFileSync(join(evidence, "proof-only.json")));
const snapshot = realpathSync(frozen.snapshot);
const resultRoot = join(evidence, "independent-review");
mkdirSync(resultRoot);
const save = (name, value) => writeFileSync(join(resultRoot, name), JSON.stringify(value, null, 2) + "\n");
save("release.json", { marker, markerSha256: digest(marker), editorHashes: audit.editorHashes, capture: { status: capture.status, launch, args: [`${editor}/run.mjs`, "--proof-only"] } });
console.log(JSON.stringify({ evidence, snapshot, role: "independent paired reviewer", captureLaunch: launch }));
const roots = ["src", "tests", "benchmarks", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "AGENTS.md", "README.md"];
function inventory(root, selected = roots, exclude = true) {
  const result = {};
  function visit(path) {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) for (const name of readdirSync(absolute).sort()) {
      const child = join(path, name);
      if (exclude && (name === "node_modules" || /^(?:\.native-|\.hunk-native-|patch-gnu-native-)/u.test(name) || child === "benchmarks/reports" || child === `${owned}/.work`)) continue;
      visit(child);
    }
    else result[path] = stat.isSymbolicLink() ? { link: readlinkSync(absolute) } : { sha256: digest(readFileSync(absolute)), size: stat.size, mode: stat.mode & 0o777 };
  }
  for (const path of [...selected].sort()) visit(path);
  return result;
}
const aggregate = value => digest(JSON.stringify(value));
const originalInputs = JSON.parse(readFileSync(join(evidence, "inputs-original.json")));
const dependencies = JSON.parse(readFileSync(join(evidence, "dependencies.json")));
const original237 = JSON.parse(readFileSync(join(evidence, "original237.json")));
const original70 = JSON.parse(readFileSync(join(evidence, "original70.json")));
const groups = JSON.parse(readFileSync(join(evidence, "census-files.json")));
assert.equal(Object.keys(original237).length, 237);
assert.equal(Object.keys(original70).length, 70);
assert.equal(Object.keys(groups).length, 17);
assert.deepEqual(Object.values(groups).flat().sort(), Object.keys(original70).sort());
const originalBytes = Object.fromEntries(changes.map(change => [change.file, readFileSync(join(snapshot, change.file))]));
let expectedInputs = originalInputs;
const binaries = JSON.parse(readFileSync(join(evidence, "boundaries.json")))[0].binaries;
const boundaries = [];
function boundary(name) {
  const current = inventory(snapshot);
  const currentDependencies = inventory(join(snapshot, "node_modules"), ["."], false);
  assert.deepEqual(current, expectedInputs, name);
  assert.deepEqual(currentDependencies, dependencies, `${name} dependencies`);
  const shadows = Object.keys(current).filter(path => /^(?:src|tests)\//u.test(path) && /\.(?:js|jsx|cjs|mjs)(?:\.map)?$/u.test(path) && [".ts", ".tsx"].some(extension => path.replace(/\.(?:js|jsx|cjs|mjs)(?:\.map)?$/u, extension) in current));
  assert.deepEqual(shadows, []);
  for (const [path, info] of Object.entries(binaries)) assert.equal(digest(readFileSync(path)), info.sha256, `${name} binary ${path}`);
  const record = { name, at: new Date().toISOString(), inputs: aggregate(current), source: aggregate(inventory(snapshot, ["src"])), dependencies: aggregate(currentDependencies), compiledSiblings: shadows, binariesStable: true };
  boundaries.push(record);
  save("boundaries.json", boundaries);
  return record;
}
const env = { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC", TMPDIR: resultRoot };
for (const name of Object.keys(env)) if (/^(?:NODE_OPTIONS|NODE_PATH|TSX_|TS_NODE_|DIFF_PATCH_|PARSER_EVIDENCE$|CANDIDATE_EVIDENCE$|CHECKPOINT_|ESBUILD_BINARY_PATH$)/u.test(name)) delete env[name];
env.CHECKPOINT_SNAPSHOT = snapshot;
env.CHECKPOINT_IMPORT_LOG = join(resultRoot, "imports");
mkdirSync(env.CHECKPOINT_IMPORT_LOG);
const runs = [];
function run(name, args) {
  boundary(`${name}:before`);
  const stdoutPath = join(resultRoot, `${name}.stdout`);
  const stderrPath = join(resultRoot, `${name}.stderr`);
  const stdout = openSync(stdoutPath, "wx");
  const stderr = openSync(stderrPath, "wx");
  const command = ["--unhandled-rejections=strict", "--import", `./${prior}/guard.mjs`, ...args];
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, command, { cwd: snapshot, env, timeout: 180000, killSignal: "SIGKILL", stdio: ["ignore", stdout, stderr] });
  closeSync(stdout); closeSync(stderr);
  const record = { name, command: [process.execPath, ...command], cwd: snapshot, startedAt, finishedAt: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: { path: stdoutPath, sha256: digest(readFileSync(stdoutPath)) }, stderr: { path: stderrPath, sha256: digest(readFileSync(stderrPath)) } };
  runs.push(record);
  save("runs.json", runs);
  boundary(`${name}:after`);
  console.log(JSON.stringify({ name, status: result.status }));
  return record;
}
const historicalResult = JSON.parse(readFileSync("/tmp/safe-bash-diff-rmdir-final-PRIFIp/result.json"));
const parseEvents = path => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
function census(events, root) {
  return events.filter(event => ["test:pass", "test:fail"].includes(event.type)).map(event => ({ name: event.data.name, file: relative(root, event.data.file ?? ""), nesting: event.data.nesting })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
function cohort(profile) {
  const suites = [];
  for (const [name, files] of Object.entries(groups)) {
    const eventPath = join(resultRoot, `${profile}-${name}.events.jsonl`);
    const execution = run(`${profile}-${name}`, ["--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", "--test-reporter-destination=stdout", `--test-reporter=./${historical}/reporter.mjs`, `--test-reporter-destination=${eventPath}`, ...files]);
    assert.equal(execution.signal, null);
    assert.equal(execution.error, null);
    const tap = readFileSync(execution.stdout.path, "utf8");
    const counts = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(key => {
      const matches = [...tap.matchAll(new RegExp(`^# ${key} (\\d+)$`, "gmu"))];
      assert.equal(matches.length, 1, `${profile}/${name}: unique raw TAP total ${key}`);
      return [key, Number(matches[0][1])];
    }));
    const events = parseEvents(eventPath);
    const rawPass = events.filter(event => event.type === "test:pass");
    const rawFail = events.filter(event => event.type === "test:fail");
    assert.equal(rawPass.length, counts.pass);
    assert.equal(rawFail.length, counts.fail);
    assert.equal(rawPass.length + rawFail.length, counts.tests);
    assert.equal(counts.skipped + counts.cancelled + counts.todo, 0);
    assert.equal(counts.tests, historicalResult.suites.find(suite => suite.suite === name).tests);
    const historicalEvents = parseEvents(`/tmp/safe-bash-diff-rmdir-final-PRIFIp/${name}.events.jsonl`);
    const names = census(events, snapshot);
    assert.deepEqual(names, census(historicalEvents, historicalResult.snapshot));
    assert.equal(execution.status, counts.fail > 0 ? 1 : 0);
    const result = { name, files, ...counts, rawExitCode: execution.status, failures: rawFail.map(event => ({ name: event.data.name, file: relative(snapshot, event.data.file), details: event.data.details })), censusSha256: aggregate(names), eventSha256: digest(readFileSync(eventPath)), execution };
    suites.push(result);
    save(`${profile}-suites.json`, suites);
  }
  const totals = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(key => [key, suites.reduce((sum, suite) => sum + suite[key], 0)]));
  const result = { totals, suites, rawAggregateExitCode: suites.some(suite => suite.rawExitCode !== 0) ? 1 : 0 };
  save(`${profile}.json`, result);
  return result;
}
const startedAt = new Date().toISOString();
boundary("paired-start");
const original = cohort("original");
assert.deepEqual(original.totals, { tests: 3758, pass: 3750, fail: 8, skipped: 0, cancelled: 0, todo: 0 });
assert.deepEqual(original.suites.flatMap(suite => suite.failures.map(failure => failure.name)).sort(), audit.changedNamedTests);
const independentProof = { exact: JSON.parse(readFileSync(join(owned, "native-preparation.json"))).observations.filter(item => item.dialect === "gnu").slice(0, 8).map(item => ({ name: item.fixture.name, ...item })) };
const delta = applyDelta(snapshot, original237, independentProof);
expectedInputs = inventory(snapshot);
const changed = Object.keys(originalInputs).filter(path => JSON.stringify(originalInputs[path]) !== JSON.stringify(expectedInputs[path]));
assert.deepEqual(changed.sort(), changes.map(change => change.file).sort());
save("applied-delta.json", delta);
save("inputs-revised.json", expectedInputs);
const revised = cohort("revised");
assert.deepEqual(revised.totals, { tests: 3758, pass: 3758, fail: 0, skipped: 0, cancelled: 0, todo: 0 });
assert.deepEqual(original.suites.map(suite => suite.censusSha256), revised.suites.map(suite => suite.censusSha256));
const config = join(snapshot, owned, "scoped.generated.json");
writeFileSync(config, JSON.stringify({ extends: "../../../../tsconfig.json", compilerOptions: { noEmit: true }, files: Object.keys(original70).map(path => relative(dirname(config), join(snapshot, path))), include: [], exclude: [] }));
expectedInputs = inventory(snapshot);
const scoped = run("scoped-noEmit", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", config, "--pretty", "false"]);
const whole = run("whole-noEmit", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.json", "--pretty", "false"]);
const build = run("snapshot-build", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--outDir", join(snapshot, "dist"), "--pretty", "false"]);
const fixture = run("fixture-probe", ["--import", "tsx", `${historical}/fixture-probe.mjs`]);
const publicProbe = run("plain-node-public-probe", [`${historical}/public-probe.mjs`, fixture.stdout.path]);
const independent = run("independent-native-product", [`${owned}/probe.mjs`, join(resultRoot, "native-product.json"), "--product"]);
for (const [path, bytes] of Object.entries(originalBytes)) writeFileSync(join(snapshot, path), bytes);
expectedInputs = inventory(snapshot);
for (const [path, hash] of Object.entries(original237)) { assert.equal(expectedInputs[path].sha256, hash); assert.equal(digest(readFileSync(join(repository, path))), hash); }
for (const [path, hash] of Object.entries(original70)) assert.equal(expectedInputs[path].sha256, hash);
const finalBoundary = boundary("paired-final-originals-restored");
const outputs = inventory(snapshot, ["dist"]);
const unexpected = Object.keys(inventory(snapshot, ["."])).filter(path => !(path in expectedInputs) && !path.startsWith("dist/"));
assert.deepEqual(unexpected, []);
for (const [path, hash] of Object.entries(audit.editorHashes)) assert.equal(digest(readFileSync(join(repository, path))), hash);
const importRecords = readdirSync(env.CHECKPOINT_IMPORT_LOG).flatMap(file => parseEvents(join(env.CHECKPOINT_IMPORT_LOG, file)));
const imports = [...new Set(importRecords.map(record => record.path))].sort();
assert(imports.includes("src/commands/diff-patch/index.ts") && imports.includes("dist/index.js"));
save("imports.json", { count: imports.length, modules: imports });
save("build-outputs.json", outputs);
save("inputs-final.json", expectedInputs);
const summary = { author: "independent reviewer72352, distinct from editor93986", editorCommit: audit.editorCommit, startedAt, finishedAt: new Date().toISOString(), evidence, snapshot, original: original.totals, originalRawExitCode: original.rawAggregateExitCode, revised: revised.totals, revisedRawExitCode: revised.rawAggregateExitCode, original30: { pass: 14, fail: 16, historical: true, rerun: false }, exactFiles: 70, suites: 17, sourceBefore: boundaries[0].source, sourceAfter: finalBoundary.source, dependenciesBefore: boundaries[0].dependencies, dependenciesAfter: finalBoundary.dependencies, inputOriginalAggregate: aggregate(originalInputs), original237Preserved: true, original70Preserved: true, inputsRestoredExceptDeclaredScopedConfig: true, sourceWorkingTreeAfter: aggregate(inventory(repository, ["src"])), scopedNoEmit: scoped.status, wholeNoEmit: whole.status, snapshotBuild: build.status, publicFixture: publicProbe.status, independentNativeProduct: independent.status, buildOutputAggregate: aggregate(outputs), imports: imports.length, deltaAuditSha256: digest(readFileSync(join(owned, "delta-audit.json"))), runs, allValidationPassed: [scoped, whole, build, fixture, publicProbe, independent].every(result => result.status === 0) };
save("summary.json", summary);
writeFileSync(join(owned, "RESULT.json"), JSON.stringify(summary, null, 2) + "\n");
const archivedFiles = {};
function archive(name, path) {
  const bytes = readFileSync(path);
  const compressed = gzipSync(bytes);
  assert.deepEqual(gunzipSync(compressed), bytes);
  archivedFiles[name] = { bytes: bytes.length, sha256: digest(bytes), gzipBase64: compressed.toString("base64") };
}
for (const file of readdirSync(resultRoot)) if (lstatSync(join(resultRoot, file)).isFile()) archive(`review/${file}`, join(resultRoot, file));
for (const file of ["inputs-original.json", "dependencies.json", "original237.json", "original70.json", "census-files.json", "working-state.json", "runtime.json", "proof-only.json", "boundaries.json"]) archive(`capture/${file}`, join(evidence, file));
for (const path of Object.keys(originalInputs).filter(path => path.startsWith("src/") || ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].includes(path))) archive(`frozen/${path}`, join(snapshot, path));
for (const path of Object.keys(original237)) archive(`original/${path}`, join(snapshot, path));
writeFileSync(join(owned, "evidence-archive.json"), JSON.stringify({ encoding: "gzip/base64; every member roundtripped and SHA-256 checked", files: archivedFiles }, null, 2) + "\n");
console.log(JSON.stringify(summary));
if (!summary.allValidationPassed) process.exitCode = 1;
