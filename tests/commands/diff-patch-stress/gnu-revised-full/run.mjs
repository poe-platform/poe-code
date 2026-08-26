import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDelta, changes, digest } from "./delta-v1.mjs";

const repository = "/Users/kjopek/Workspace/safe-bash";
assert.equal(process.cwd(), repository);
assert.equal(dirname(fileURLToPath(import.meta.url)), join(repository, "tests/commands/diff-patch-stress/gnu-revised-full"));
const owned = "tests/commands/diff-patch-stress/gnu-revised-full";
const prior = "tests/commands/diff-patch-stress/gnu-rmdir-checkpoint";
const historical = "tests/commands/diff-patch-stress/gnu-followup-checkpoint";
const frozen = "/tmp/safe-bash-diff-rmdir-final-PRIFIp";
const startedAt = new Date().toISOString();
const evidence = mkdtempSync("/tmp/safe-bash-diff-revised-full-");
const save = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
const aggregate = value => digest(JSON.stringify(value));
console.log(JSON.stringify({ evidence, phase: "capture", original3758Rerun: false, original30Rerun: false }));

function git(args) {
  const result = spawnSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
const baselineBytes = git(["show", "c623665:tests/commands/diff-patch-stress/gnu-revised-acceptance/original-manifest.json"]);
const baseline = JSON.parse(baselineBytes);
const original237 = Object.fromEntries(Object.entries(baseline.originalFiles).filter(([path]) => path.startsWith("tests/")));
const original70 = Object.fromEntries(baseline.original3758.testFiles.map(path => [path, digest(git(["show", `4d4f5ca:${path}`]))]));
const archived = JSON.parse(readFileSync(join(frozen, "result.json")));
assert.equal(Object.keys(original237).length, 237);
assert.equal(Object.keys(original70).length, 70);
assert.deepEqual(archived.totals, { tests: 3758, pass: 3750, fail: 8, skipped: 0, cancelled: 0, todo: 0 });
assert.deepEqual(archived.failures.map(row => row.name).sort(), changes.flatMap(change => change.names).sort());
const groups = JSON.parse(readFileSync(join(frozen, "test-census.json"))).original;
assert.equal(Object.keys(groups).length, 17);
assert.deepEqual(Object.values(groups).flat().sort(), Object.keys(original70).sort());
const roots = ["src", "tests", "benchmarks", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "AGENTS.md", "README.md"];
function inventory(root, selected = roots, exclude = true) {
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
    else {
      assert(stat.isFile(), path);
      entries[path] = { sha256: digest(readFileSync(absolute)), size: stat.size, mode: stat.mode & 0o777 };
    }
  }
  for (const path of [...selected].sort()) visit(path);
  return entries;
}
function originals(inputs) {
  for (const [path, hash] of Object.entries(original237)) assert.equal(inputs[path]?.sha256, hash, `c623665 original237: ${path}`);
  for (const [path, hash] of Object.entries(original70)) assert.equal(inputs[path]?.sha256, hash, `4d4f5ca original70: ${path}`);
  const discovered = Object.keys(inputs).filter(path => /^tests\/commands\/(?:diff-patch|diff-patch-stress)\//u.test(path) && path.endsWith(".test.ts")).sort();
  assert.deepEqual(discovered, Object.keys(original70).sort());
  const shadows = Object.keys(inputs).filter(path => /^(?:src|tests)\//u.test(path) && /\.(?:js|jsx|cjs|mjs)(?:\.map)?$/u.test(path) && [".ts", ".tsx"].some(extension => path.replace(/\.(?:js|jsx|cjs|mjs)(?:\.map)?$/u, extension) in inputs));
  assert.deepEqual(shadows, []);
}
function copy(from, to, entries, links = false) {
  for (const [path, info] of Object.entries(entries)) {
    const destination = join(to, path);
    mkdirSync(dirname(destination), { recursive: true });
    if (info.link !== undefined) {
      assert(links && !isAbsolute(info.link), path);
      const target = relative(from, realpathSync(join(from, path)));
      assert(target !== ".." && !target.startsWith("../") && !isAbsolute(target), path);
      symlinkSync(info.link, destination);
    } else {
      copyFileSync(join(from, path), destination);
      chmodSync(destination, info.mode);
    }
  }
}
let snapshot;
let inputs;
let dependencies;
for (let attempt = 1; attempt <= 6; attempt++) {
  const candidate = join(evidence, `snapshot-${attempt}`);
  mkdirSync(candidate);
  const before = inventory(repository);
  originals(before);
  const dependencyBefore = inventory(join(repository, "node_modules"), ["."], false);
  copy(repository, candidate, before);
  copy(join(repository, "node_modules"), join(candidate, "node_modules"), dependencyBefore, true);
  const copied = inventory(candidate);
  const dependencyCopied = inventory(join(candidate, "node_modules"), ["."], false);
  const after = inventory(repository);
  const dependencyAfter = inventory(join(repository, "node_modules"), ["."], false);
  const stable = aggregate(before) === aggregate(copied) && aggregate(before) === aggregate(after) && aggregate(dependencyBefore) === aggregate(dependencyCopied) && aggregate(dependencyBefore) === aggregate(dependencyAfter);
  save(`capture-${attempt}.json`, { before, copied, after, dependencyBefore, dependencyCopied, dependencyAfter, stable });
  if (stable) { snapshot = realpathSync(candidate); inputs = copied; dependencies = dependencyCopied; break; }
}
assert(snapshot, "moving inputs: no tests executed");
const consumerPath = "src/commands/diff-patch/patch-gnu-paths.ts";
const frozenInputs = JSON.parse(readFileSync(join(frozen, "inputs.json")));
const consumerFiles = Object.keys(inputs).filter(path => path.startsWith("src/commands/diff-patch/"));
for (const path of consumerFiles) assert.equal(inputs[path].sha256, frozenInputs[path].sha256, `consumer source changed: ${path}`);
assert.equal(inputs[consumerPath]?.sha256, "3a06d5b33d3c0df12ff83b0bbf4396d90906d6fd61e3ca1bd5537f508c4282af");
save("inputs-original.json", inputs);
save("dependencies.json", dependencies);
save("original237.json", original237);
save("original70.json", original70);
save("census-files.json", groups);
save("working-state.json", { head: git(["rev-parse", "HEAD"]).toString().trim(), status: git(["status", "--porcelain=v1", "--untracked-files=all"]).toString(), index: git(["ls-files", "--stage"]).toString(), diffSha256: digest(git(["diff", "--binary", "HEAD", "--", ...roots])) });
const packageMetadata = JSON.parse(readFileSync(join(snapshot, "package.json")));
assert.deepEqual(packageMetadata.dependencies ?? {}, {});
save("runtime.json", { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch, tooling: Object.fromEntries(["typescript", "tsx", "@types/node"].map(name => [name, JSON.parse(readFileSync(join(snapshot, "node_modules", name, "package.json"))).version])), runtimeDependencies: packageMetadata.dependencies ?? {} });
const env = { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC", TMPDIR: evidence };
for (const name of Object.keys(env)) if (/^(?:NODE_OPTIONS|NODE_PATH|TSX_|TS_NODE_|DIFF_PATCH_|PARSER_EVIDENCE$|CANDIDATE_EVIDENCE$|CHECKPOINT_|ESBUILD_BINARY_PATH$)/u.test(name)) delete env[name];
const importLogs = join(evidence, "imports");
mkdirSync(importLogs);
env.CHECKPOINT_SNAPSHOT = snapshot;
env.CHECKPOINT_IMPORT_LOG = importLogs;
const preload = ["--unhandled-rejections=strict", "--import", `./${prior}/guard.mjs`];
const runs = [];
const boundaries = [];
let expectedInputs = inputs;
const binaryPaths = [process.execPath, "/usr/bin/git", "/usr/bin/diff", "/usr/bin/patch", "/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff", "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch"];
const binaries = () => Object.fromEntries(binaryPaths.map(path => [path, { realpath: realpathSync(path), sha256: digest(readFileSync(path)) }]));
const binaryBefore = binaries();
function boundary(name) {
  const current = inventory(snapshot);
  const currentDependencies = inventory(join(snapshot, "node_modules"), ["."], false);
  const record = { name, at: new Date().toISOString(), inputs: aggregate(current), dependencies: aggregate(currentDependencies), source: aggregate(inventory(snapshot, ["src"])), binaries: binaries() };
  boundaries.push(record);
  save("boundaries.json", boundaries);
  assert.deepEqual(current, expectedInputs, `snapshot changed: ${name}`);
  assert.deepEqual(currentDependencies, dependencies, `dependencies changed: ${name}`);
  assert.deepEqual(record.binaries, binaryBefore, `binaries changed: ${name}`);
}
function run(name, args) {
  boundary(`${name}:before`);
  const stdoutPath = join(evidence, `${name}.stdout`);
  const stderrPath = join(evidence, `${name}.stderr`);
  const stdout = openSync(stdoutPath, "w");
  const stderr = openSync(stderrPath, "w");
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [...preload, ...args], { cwd: snapshot, env, timeout: 180000, killSignal: "SIGKILL", stdio: ["ignore", stdout, stderr] });
  closeSync(stdout); closeSync(stderr);
  const record = { name, command: [process.execPath, ...preload, ...args], cwd: snapshot, startedAt, finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: { path: stdoutPath, sha256: digest(readFileSync(stdoutPath)) }, stderr: { path: stderrPath, sha256: digest(readFileSync(stderrPath)) } };
  runs.push(record);
  save(`run-${name}.json`, record);
  boundary(`${name}:after`);
  console.log(JSON.stringify({ name, exitCode: record.exitCode }));
  return record;
}
const proofRun = run("proof", ["--import", "tsx", `${owned}/proof.mjs`, join(evidence, "proof.json")]);
assert.equal(proofRun.exitCode, 0, `proof failed; retained ${evidence}`);
const proofBytes = readFileSync(join(evidence, "proof.json"));
const proof = JSON.parse(proofBytes);
assert.equal(proof.accepted, true);
if (process.argv.includes("--proof-only")) {
  save("proof-only.json", { evidence, snapshot, runs, original3758Rerun: false, original30Rerun: false });
  console.log(JSON.stringify({ evidence, proofOnly: true }));
} else {
  const delta = applyDelta(snapshot, original237, proof);
  assert.equal(delta.length, 8);
  expectedInputs = inventory(snapshot);
  const changed = Object.keys(inputs).filter(path => inputs[path].sha256 !== expectedInputs[path]?.sha256);
  assert.deepEqual(changed.sort(), changes.map(change => change.file).sort());
  const originalsAfterDelta = Object.fromEntries(Object.entries(original237).map(([path, hash]) => [path, { original: hash, snapshot: expectedInputs[path].sha256 }]));
  const manifest = { version: 1, role: "expectation editor/author; independent review pending", evidence, snapshot, originalCheckpoint: "371df76 with cd80ea1 correction", consumerCommit: "4009efeef1ab909b4a5c8ffa7dbebc335dd9325c", originalManifestSha256: digest(baselineBytes), deltaFileSha256: digest(readFileSync(new URL("./delta-v1.mjs", import.meta.url))), proofSha256: digest(proofBytes), original3758: { rerun: false, ...archived.totals, archived: frozen }, original30: { rerun: false, pass: 14, fail: 16, report: "tests/commands/diff-patch-stress/original-thirty-replay/REPORT.md" }, cases: delta, changedFiles: changed, original237: originalsAfterDelta, original70, groups };
  save("manifest.json", manifest);
  save("inputs-revised.json", expectedInputs);
  const suites = [];
  for (const [name, files] of Object.entries(groups)) {
    const eventsPath = join(evidence, `${name}.events.jsonl`);
    const result = run(name, ["--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", "--test-reporter-destination=stdout", `--test-reporter=./${historical}/reporter.mjs`, `--test-reporter-destination=${eventsPath}`, ...files]);
    const stdout = readFileSync(result.stdout.path, "utf8");
    const counts = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(key => [key, Number([...stdout.matchAll(new RegExp(`^# ${key} (\\d+)$`, "gmu"))].at(-1)?.[1] ?? -1)]));
    const events = readFileSync(eventsPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const oldEvents = readFileSync(join(frozen, `${name}.events.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const census = events => events.filter(event => ["test:pass", "test:fail"].includes(event.type)).map(event => ({ name: event.data.name, file: relative(snapshot, event.data.file ?? ""), nesting: event.data.nesting })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const currentCensus = census(events);
    const oldCensus = oldEvents.filter(event => ["test:pass", "test:fail"].includes(event.type)).map(event => ({ name: event.data.name, file: relative(archived.snapshot, event.data.file ?? ""), nesting: event.data.nesting })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    save(`census-${name}.json`, { before: oldCensus, after: currentCensus });
    assert.deepEqual(currentCensus, oldCensus, `test-name census changed: ${name}`);
    const suite = { suite: name, files, ...counts, exitCode: result.exitCode, failures: events.filter(event => event.type === "test:fail").map(event => event.data), censusSha256: aggregate(currentCensus) };
    suites.push(suite);
    save("suites.json", suites);
    assert.equal(counts.tests, archived.suites.find(suite => suite.suite === name).tests);
    assert.equal(counts.skipped + counts.cancelled + counts.todo, 0);
    assert.equal(result.exitCode, 0, `UNEXPECTED FULL-COHORT FAILURE; stop and diagnose retained logs: ${evidence}`);
    assert.equal(counts.fail, 0);
  }
  const totals = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(key => [key, suites.reduce((sum, suite) => sum + suite[key], 0)]));
  assert.deepEqual(totals, { tests: 3758, pass: 3758, fail: 0, skipped: 0, cancelled: 0, todo: 0 });
  const scopedConfig = join(snapshot, owned, "tsconfig.generated.json");
  writeFileSync(scopedConfig, JSON.stringify({ extends: "../../../../tsconfig.json", compilerOptions: { noEmit: true }, files: Object.keys(original70).map(path => relative(dirname(scopedConfig), join(snapshot, path))), include: [], exclude: [] }, null, 2));
  expectedInputs = inventory(snapshot);
  const typecheck = run("scoped-typecheck", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", scopedConfig, "--pretty", "false"]);
  const build = run("snapshot-build", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--outDir", join(snapshot, "dist"), "--pretty", "false"]);
  const fixture = run("fixture-probe", ["--import", "tsx", `${historical}/fixture-probe.mjs`]);
  const publicProbe = run("plain-node-public-probe", [`${historical}/public-probe.mjs`, fixture.stdout.path]);
  const pinsAfter = run("pins-after", ["--import", "tsx", "--input-type=module", "-e", `import {oracleIdentity} from './tests/commands/diff-patch-stress/gnu-target/oracle.ts';console.log(JSON.stringify(['gnu','apple-calibration'].flatMap(profile=>['diff','patch'].map(tool=>({profile,tool,...oracleIdentity(tool,profile)})))));`]);
  assert.deepEqual(JSON.parse(readFileSync(pinsAfter.stdout.path)), proof.pins);
  const finalInputs = inventory(snapshot);
  const finalDependencies = inventory(join(snapshot, "node_modules"), ["."], false);
  assert.deepEqual(finalInputs, expectedInputs);
  assert.deepEqual(finalDependencies, dependencies);
  const liveAfter = inventory(repository);
  originals(liveAfter);
  save("live-after.json", liveAfter);
  const imports = [...new Set(readdirSync(importLogs).flatMap(file => readFileSync(join(importLogs, file), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line).path)))].sort();
  assert(imports.includes("src/commands/diff-patch/index.ts"));
  assert(imports.includes("dist/index.js"));
  save("import-audit.json", { modules: imports, count: imports.length, boundary: "unchanged checkpoint guard: canonical snapshot file imports only" });
  save("inputs-after.json", finalInputs);
  save("dependencies-after.json", finalDependencies);
  const outputs = inventory(snapshot, ["dist"]);
  save("build-outputs.json", outputs);
  const unexpectedOutputs = Object.keys(inventory(snapshot, ["."])).filter(path => !(path in expectedInputs) && !path.startsWith("dist/"));
  assert.deepEqual(unexpectedOutputs, []);
  const result = { role: "expectation editor/author, independent review pending", startedAt, finishedAt: new Date().toISOString(), evidence, snapshot, original3758: manifest.original3758, original30: manifest.original30, revised3758: totals, suites, runs, exactNativeProof: { cases: proof.exact.length, controls: proof.controls.length, diffRegenerations: proof.generation.length, sha256: digest(proofBytes) }, delta: { cases: delta.length, files: changed.length, sha256: manifest.deltaFileSha256 }, sourceBefore: boundaries[0].source, sourceAfter: boundaries.at(-1).source, sourceWorkingTreeAfter: aggregate(inventory(repository, ["src"])), consumerSha256: inputs[consumerPath].sha256, dependenciesBefore: aggregate(dependencies), dependenciesAfter: aggregate(finalDependencies), original237Unchanged: true, original70Unchanged: true, prePostCensusIdentical: true, snapshotImmutableExceptDeclaredExpectationsAndCompilerConfig: true, unexpectedOutputs, appleCalibrationSeparate: true, runtimeDependenciesAdded: false, unsupportedRemote: "S3/WebDAV ENOTSUP is safe refusal, not support", overlayOutsideContract: { pass: 0, fail: 3, rerun: false }, revised96: { pass: 96, fail: 0, rerun: false, separate: true }, accepted: [typecheck, build, fixture, publicProbe, pinsAfter].every(run => run.exitCode === 0) };
  save("result.json", result);
  console.log(JSON.stringify({ evidence, revised3758: totals, accepted: result.accepted }));
  if (!result.accepted) process.exitCode = 1;
}
