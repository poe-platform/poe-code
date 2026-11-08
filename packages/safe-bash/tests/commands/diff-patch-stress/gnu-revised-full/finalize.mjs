import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { digest } from "./delta-v1.mjs";

const repository = "/Users/kjopek/Workspace/safe-bash";
assert.equal(process.cwd(), repository);
const evidence = process.argv[2];
assert(evidence?.startsWith("/tmp/safe-bash-diff-revised-full-"));
const read = name => JSON.parse(readFileSync(join(evidence, name)));
const save = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
const aggregate = value => digest(JSON.stringify(value));
const manifest = read("manifest.json");
const snapshot = realpathSync(manifest.snapshot);
const proof = read("proof.json");
const dependencies = read("dependencies.json");
const originalInputs = read("inputs-original.json");
const revisedInputs = read("inputs-revised.json");
const original237 = read("original237.json");
const original70 = read("original70.json");
assert.equal(proof.accepted, true);
assert.equal(digest(readFileSync(join(evidence, "proof.json"))), manifest.proofSha256);
assert.equal(digest(readFileSync(new URL("./delta-v1.mjs", import.meta.url))), manifest.deltaFileSha256);
const configPath = "tests/commands/diff-patch-stress/gnu-revised-full/tsconfig.generated.json";
const configBytes = readFileSync(join(snapshot, configPath));
const config = JSON.parse(configBytes);
assert.equal(config.compilerOptions.noEmit, true);
assert.equal(config.files.length, 70);
const expected = { ...revisedInputs, [configPath]: { sha256: digest(configBytes), size: configBytes.length, mode: lstatSync(join(snapshot, configPath)).mode & 0o777 } };
function inventory(root, selected, exclude = true) {
  const entries = {};
  function visit(path) {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (exclude && (name === "node_modules" || /^(?:\.native-|\.hunk-native-|patch-gnu-native-)/u.test(name) || join(path, name) === "benchmarks/reports" || join(path, name) === "tests/commands/diff-patch-stress/gnu-revised-full-review/.work")) continue;
        visit(join(path, name));
      }
    } else if (stat.isSymbolicLink()) entries[path] = { link: readlinkSync(absolute) };
    else { assert(stat.isFile()); entries[path] = { sha256: digest(readFileSync(absolute)), size: stat.size, mode: stat.mode & 0o777 }; }
  }
  for (const path of [...selected].sort()) visit(path);
  return entries;
}
const roots = ["src", "tests", "benchmarks", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "AGENTS.md", "README.md"];
function unchanged() {
  const inputs = inventory(snapshot, roots);
  assert.deepEqual(inputs, expected);
  const dependencyAfter = inventory(join(snapshot, "node_modules"), ["."], false);
  assert.deepEqual(dependencyAfter, dependencies);
  for (const [path, hash] of Object.entries(original237)) {
    assert.equal(originalInputs[path].sha256, hash);
    assert.equal(digest(readFileSync(join(repository, path))), hash);
    const delta = manifest.cases.find(record => record.file === path);
    assert.equal(inputs[path].sha256, delta?.revisedFileSha256 ?? hash);
  }
  for (const [path, hash] of Object.entries(original70)) assert.equal(digest(readFileSync(join(repository, path))), hash);
  const additional = Object.keys(inventory(snapshot, ["."])).filter(path => !(path in expected) && !path.startsWith("dist/"));
  assert.deepEqual(additional, []);
  return { inputs, dependencies: dependencyAfter, source: inventory(snapshot, ["src"]), dist: inventory(snapshot, ["dist"]) };
}
const before = unchanged();
const env = { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC", TMPDIR: evidence };
for (const name of Object.keys(env)) if (/^(?:NODE_OPTIONS|NODE_PATH|TSX_|TS_NODE_|DIFF_PATCH_|PARSER_EVIDENCE$|CANDIDATE_EVIDENCE$|CHECKPOINT_|ESBUILD_BINARY_PATH$)/u.test(name)) delete env[name];
env.CHECKPOINT_SNAPSHOT = snapshot;
env.CHECKPOINT_IMPORT_LOG = join(evidence, "imports");
const args = ["--unhandled-rejections=strict", "--import", "./tests/commands/diff-patch-stress/gnu-rmdir-checkpoint/guard.mjs", "--import", "tsx", "--input-type=module", "-e", `import {oracleIdentity} from './tests/commands/diff-patch-stress/gnu-target/oracle.ts';const pins=['gnu','apple-calibration'].flatMap(profile=>['diff','patch'].map(tool=>({profile,tool,...oracleIdentity(tool,profile)})));console.log(JSON.stringify(pins));`];
const startedAt = new Date().toISOString();
const pinResult = spawnSync(process.execPath, args, { cwd: snapshot, env, encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 65536 });
writeFileSync(join(evidence, "corrected-pins.stdout"), pinResult.stdout);
writeFileSync(join(evidence, "corrected-pins.stderr"), pinResult.stderr);
save("run-corrected-pins.json", { command: [process.execPath, ...args], cwd: snapshot, startedAt, finishedAt: new Date().toISOString(), exitCode: pinResult.status, signal: pinResult.signal, error: pinResult.error?.message ?? null });
assert.ifError(pinResult.error);
assert.equal(pinResult.status, 0, pinResult.stderr);
assert.deepEqual(JSON.parse(pinResult.stdout), proof.pins);
const after = unchanged();
assert.deepEqual(after, before);
const suites = read("suites.json");
const totals = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(key => [key, suites.reduce((sum, suite) => sum + suite[key], 0)]));
assert.equal(suites.length, 17);
assert.deepEqual(totals, { tests: 3758, pass: 3758, fail: 0, skipped: 0, cancelled: 0, todo: 0 });
const census = {};
for (const suite of suites) {
  const records = read(`census-${suite.suite}.json`);
  assert.deepEqual(records.before, records.after);
  assert.equal(records.after.length, suite.tests);
  census[suite.suite] = records;
}
const importFiles = readdirSync(join(evidence, "imports"));
const modules = [...new Set(importFiles.flatMap(file => readFileSync(join(evidence, "imports", file), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line).path)))].sort();
assert(modules.includes("src/commands/diff-patch/index.ts") && modules.includes("dist/index.js"));
const boundaryRecords = read("boundaries.json");
const sourceBefore = boundaryRecords[0].source;
assert.equal(aggregate(before.source), sourceBefore);
assert.equal(aggregate(after.source), sourceBefore);
const processes = spawnSync("ps", ["-axo", "pid,ppid,args"], { cwd: repository, encoding: "utf8" });
assert.equal(processes.status, 0);
const active = processes.stdout.split("\n").filter(line => line.includes(snapshot));
assert.deepEqual(active, []);
const typecheck = read("run-scoped-typecheck.json");
const build = read("run-snapshot-build.json");
const publicProbe = read("run-plain-node-public-probe.json");
assert.equal(typecheck.exitCode, 0);
assert.equal(publicProbe.exitCode, 0);
save("census.json", census);
save("inputs-after.json", after.inputs);
save("dependencies-after.json", after.dependencies);
save("source-before-after.json", { aggregateBefore: sourceBefore, aggregateAfter: aggregate(after.source), source: after.source, consumerSha256: after.source["src/commands/diff-patch/patch-gnu-paths.ts"].sha256 });
save("build-outputs.json", after.dist);
save("import-audit.json", { modules, count: modules.length, guard: "unchanged canonical snapshot load hook; no outside file import" });
const result = { role: "expectation editor/author, NOT independent reviewer", evidence, snapshot, original3758: manifest.original3758, original30: manifest.original30, revised3758: totals, original3758Executed: false, original30Executed: false, revisedFullExecutions: 1, original237Unchanged: true, original70Unchanged: true, revised70FilenamesUnchanged: true, prePostCensusIdentical: true, groups: suites.map(suite => ({ name: suite.suite, tests: suite.tests, pass: suite.pass, fail: suite.fail })), exactProof: { cases: proof.exact.length, controls: proof.controls.length, diffRegenerations: proof.generation.length, sha256: manifest.proofSha256 }, delta: { cases: manifest.cases.length, files: manifest.changedFiles.length, sha256: manifest.deltaFileSha256 }, scopedTypecheck: { exitCode: typecheck.exitCode, noEmit: true, files: 70 }, snapshotBuild: { exitCode: build.exitCode, diagnostics: readFileSync(join(evidence, "snapshot-build.stdout"), "utf8"), accepted: build.exitCode === 0 }, publicFixture: { exitCode: publicProbe.exitCode, plainNode: true, absoluteVfsFixture: true, emittedByFailedBuild: build.exitCode !== 0 }, correctedPostPins: { exitCode: pinResult.status, sameAsFreshProof: true, originalFailedPinsLogRetained: true }, sourceBefore, sourceAfter: aggregate(after.source), dependencyBefore: aggregate(dependencies), dependencyAfter: aggregate(after.dependencies), consumerSha256: after.source["src/commands/diff-patch/patch-gnu-paths.ts"].sha256, importCount: modules.length, snapshotInputsAndDependenciesUnchanged: true, activeSnapshotProcesses: active, unsupportedRemote: "S3/WebDAV ENOTSUP is refusal, not support", overlayOutsideContract: { pass: 0, fail: 3, rerun: false }, revised96: { pass: 96, fail: 0, separate: true, rerun: false }, appleCalibrations: "separately pinned, unchanged original assertions; not GNU proof", revisedCohortPassed: true, allValidationGatesPassed: build.exitCode === 0, independentReviewPending: true, finishedAt: new Date().toISOString() };
save("final-result.json", result);
console.log(JSON.stringify({ evidence, revised3758: totals, scopedTypecheck: typecheck.exitCode, snapshotBuild: build.exitCode, publicFixture: publicProbe.exitCode, postPins: pinResult.status, activeSnapshotProcesses: active }));
