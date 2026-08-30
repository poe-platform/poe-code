import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "/Users/kjopek/Workspace/safe-bash";
const owned = "tests/commands/diff-patch-stress/gnu-rmdir-checkpoint";
const historical = "tests/commands/diff-patch-stress/gnu-followup-checkpoint";
const revised = "tests/commands/diff-patch-stress/gnu-revised-acceptance";
const marker = "/tmp/safe-bash-diff-rmdir-consumer.closed";
assert.equal(process.cwd(), repository);
assert.equal(resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."), repository);
const digest = value => createHash("sha256").update(value).digest("hex");
const aggregate = value => digest(JSON.stringify(value));
function git(args, encoding = "utf8") {
  const result = spawnSync("git", args, { cwd: repository, encoding, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
const roots = ["src", "tests", "benchmarks", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "AGENTS.md", "README.md"];
function inventory(root, selected = roots, exclude = true) {
  const entries = {};
  function visit(path) {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (exclude && (name === "node_modules" || /^(?:\.native-|\.hunk-native-|patch-gnu-native-)/u.test(name) || join(path, name) === "benchmarks/reports")) continue;
        visit(join(path, name));
      }
    } else if (stat.isSymbolicLink()) entries[path] = { link: readlinkSync(absolute) };
    else {
      assert(stat.isFile(), `unsupported input: ${path}`);
      entries[path] = { sha256: digest(readFileSync(absolute)), size: stat.size, mode: stat.mode & 0o777 };
    }
  }
  for (const path of [...selected].sort()) visit(path);
  return entries;
}
function contamination(inputs) {
  return Object.keys(inputs).filter(path => /^(?:src|tests)\//u.test(path) && /\.(?:js|jsx|cjs|mjs)(?:\.map)?$/u.test(path) && [".ts", ".tsx"].some(extension => path.replace(/\.(?:js|jsx|cjs|mjs)(?:\.map)?$/u, extension) in inputs));
}
const manifestPath = `${revised}/original-manifest.json`;
const frozenManifest = git(["show", `c623665:${manifestPath}`], null);
const baseline = JSON.parse(frozenManifest);
const originalFiles = Object.fromEntries(Object.entries(baseline.originalFiles).filter(([path]) => path.startsWith("tests/")));
assert.equal(Object.keys(originalFiles).length, 237);
assert.equal(baseline.original3758.testFiles.length, 70);
const original70 = Object.fromEntries(baseline.original3758.testFiles.map(path => [path, digest(git(["show", `4d4f5ca:${path}`], null))]));
const revisedFiles = Object.fromEntries(git(["ls-tree", "-r", "--name-only", "c623665", "--", revised]).trim().split("\n").map(path => [path, digest(git(["show", `c623665:${path}`], null))]));
const old = JSON.parse(git(["show", `4d4f5ca:${historical}/CHECKPOINT.json`]));
function originals(root, inputs) {
  assert.equal(digest(readFileSync(join(root, manifestPath))), digest(frozenManifest), "c623665 manifest changed");
  for (const [path, expected] of Object.entries(originalFiles)) assert.equal(inputs[path]?.sha256, expected, `original237 changed: ${path}`);
  for (const [path, expected] of Object.entries(original70)) assert.equal(inputs[path]?.sha256, expected, `4d4f5ca original70 changed: ${path}`);
  for (const [path, expected] of Object.entries(revisedFiles)) assert.equal(inputs[path]?.sha256, expected, `c623665 revised input changed: ${path}`);
  const discovered = Object.keys(inputs).filter(path => /^tests\/commands\/(?:diff-patch|diff-patch-stress)\//u.test(path) && path.endsWith(".test.ts")).sort();
  assert.deepEqual(discovered, baseline.original3758.testFiles, "original3758 discovery must remain exactly the same70");
  return { original237: Object.keys(originalFiles).length, original70: discovered.length, revisedFiles: Object.keys(revisedFiles).length, manifestSha256: digest(frozenManifest), original70Sha256: aggregate(original70), revisedFilesSha256: aggregate(revisedFiles) };
}
if (process.argv.includes("--prepare")) {
  const inputs = inventory(repository);
  assert.deepEqual(contamination(inputs), []);
  console.log(JSON.stringify({ phase: "preparation-only", ...originals(repository, inputs), markerPresent: existsSync(marker), acceptanceExecuted: false }, null, 2));
} else {
  assert(existsSync(marker), "NONFINAL: ROOT source+backend readiness marker absent; no capture or acceptance permitted");
  const markerContents = readFileSync(marker, "utf8");
  assert(/backend|filesystem|memory/iu.test(markerContents) && /source|consumer/iu.test(markerContents), "marker must declare source AND backend readiness");
  const sourceCommit = git(["log", "-1", "--format=%H", "--", "src/commands/diff-patch"]).trim();
  assert(markerContents.includes(sourceCommit.slice(0, 7)), "ROOT marker must identify newest source commit");
  const consumerFiles = process.argv.slice(2);
  assert(consumerFiles.length > 0, "explicit separate consumer .acceptance.ts files are required");
  for (const path of consumerFiles) assert(/^tests\/commands\/(?:diff-patch|diff-patch-stress)\/[\w/-]+\.acceptance\.ts$/u.test(path) && !path.startsWith(`${revised}/`), `invalid separate consumer file: ${path}`);
  const evidence = mkdtempSync("/tmp/safe-bash-diff-rmdir-final-");
  const startedAt = new Date().toISOString();
  const save = (name, value) => writeFileSync(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  const attempts = [];
  const dependencyRoot = join(repository, "node_modules");
  let snapshot;
  let inputs;
  let dependencies;
  let workingState;
  function copyInventory(from, to, entries, links) {
    for (const [path, info] of Object.entries(entries)) {
      const destination = join(to, path);
      mkdirSync(dirname(destination), { recursive: true });
      if (info.link !== undefined) {
        assert(links && !isAbsolute(info.link), `unreviewed input symlink: ${path}`);
        const target = relative(from, realpathSync(join(from, path)));
        assert(target !== ".." && !target.startsWith("../") && !isAbsolute(target), `dependency link escapes root: ${path}`);
        symlinkSync(info.link, destination);
      } else {
        copyFileSync(join(from, path), destination);
        chmodSync(destination, info.mode);
      }
    }
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    const candidate = join(evidence, `snapshot-${attempt}`);
    mkdirSync(candidate);
    const headBefore = git(["rev-parse", "HEAD"]).trim();
    const statusBefore = git(["status", "--porcelain=v1", "--untracked-files=all"]);
    const before = inventory(repository);
    originals(repository, before);
    assert.deepEqual(contamination(before), []);
    const dependencyBefore = inventory(dependencyRoot, ["."], false);
    copyInventory(repository, candidate, before, false);
    copyInventory(dependencyRoot, join(candidate, "node_modules"), dependencyBefore, true);
    const copied = inventory(candidate);
    const dependencyCopied = inventory(join(candidate, "node_modules"), ["."], false);
    const after = inventory(repository);
    const dependencyAfter = inventory(dependencyRoot, ["."], false);
    const headAfter = git(["rev-parse", "HEAD"]).trim();
    const statusAfter = git(["status", "--porcelain=v1", "--untracked-files=all"]);
    const stable = aggregate(before) === aggregate(after) && aggregate(before) === aggregate(copied) && aggregate(dependencyBefore) === aggregate(dependencyAfter) && aggregate(dependencyBefore) === aggregate(dependencyCopied) && headBefore === headAfter && statusBefore === statusAfter;
    attempts.push({ attempt, candidate, before: aggregate(before), after: aggregate(after), copied: aggregate(copied), dependencyBefore: aggregate(dependencyBefore), dependencyAfter: aggregate(dependencyAfter), dependencyCopied: aggregate(dependencyCopied), headBefore, headAfter, stable });
    save(`copy-attempt-${attempt}.json`, { before, after, copied, dependencyBefore, dependencyAfter, dependencyCopied, statusBefore, statusAfter });
    if (stable) {
      snapshot = realpathSync(candidate); inputs = copied; dependencies = dependencyCopied;
      workingState = { head: headAfter, status: statusAfter, diffSha256: digest(git(["diff", "--binary", "HEAD", "--", ...roots])), indexEntries: git(["ls-files", "--stage"]) };
      break;
    }
  }
  assert(snapshot, "moving source/dependency tree; no acceptance executed");
  assert.equal(readFileSync(marker, "utf8"), markerContents);
  const frozenOriginals = originals(snapshot, inputs);
  const environment = { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC", TMPDIR: evidence };
  const clearedEnvironment = [];
  for (const name of Object.keys(environment)) {
    if (/^(?:NODE_OPTIONS|NODE_PATH|TSX_|TS_NODE_|DIFF_PATCH_|PARSER_EVIDENCE$|CANDIDATE_EVIDENCE$|CHECKPOINT_|ESBUILD_BINARY_PATH$)/u.test(name)) { clearedEnvironment.push(name); delete environment[name]; }
  }
  const importLogs = join(evidence, "imports");
  mkdirSync(importLogs);
  environment.CHECKPOINT_SNAPSHOT = snapshot;
  environment.CHECKPOINT_IMPORT_LOG = importLogs;
  const preload = ["--unhandled-rejections=strict", "--import", `./${owned}/guard.mjs`];
  const runs = [];
  const boundaries = [];
  const binaries = Object.fromEntries([process.execPath, "/usr/bin/git", "/usr/bin/xcrun", "/usr/bin/diff", "/usr/bin/patch", "/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff", "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch"].map(path => [path, { realpath: realpathSync(path), sha256: digest(readFileSync(path)) }]));
  const resolvedGit = spawnSync("/usr/bin/xcrun", ["--find", "git"], { cwd: snapshot, env: environment, encoding: "utf8" });
  assert.equal(resolvedGit.status, 0, resolvedGit.stderr);
  const gitBinary = resolvedGit.stdout.trim();
  binaries[gitBinary] = { realpath: realpathSync(gitBinary), sha256: digest(readFileSync(gitBinary)) };
  function boundary(name) {
    const currentInputs = inventory(snapshot);
    const currentDependencies = inventory(join(snapshot, "node_modules"), ["."], false);
    const currentBinaries = Object.fromEntries(Object.keys(binaries).map(path => [path, { realpath: realpathSync(path), sha256: digest(readFileSync(path)) }]));
    const changed = [...new Set([...Object.keys(inputs), ...Object.keys(currentInputs)])].filter(path => JSON.stringify(inputs[path]) !== JSON.stringify(currentInputs[path]));
    const record = { name, at: new Date().toISOString(), inputAggregate: aggregate(currentInputs), sourceAggregate: aggregate(Object.fromEntries(Object.entries(currentInputs).filter(([path]) => path.startsWith("src/")))), dependencyAggregate: aggregate(currentDependencies), binariesStable: aggregate(currentBinaries) === aggregate(binaries), compiledSiblings: contamination(currentInputs), changed };
    boundaries.push(record);
    save(`boundary-${boundaries.length}.json`, record);
    assert.deepEqual(changed, [], `${name}: immutable inputs changed`);
    assert.equal(aggregate(currentDependencies), aggregate(dependencies), `${name}: dependencies changed`);
    assert(record.binariesStable, `${name}: runtime/tool binaries changed`);
    assert.deepEqual(record.compiledSiblings, []);
    return record;
  }
  function run(name, args, timeout = 600_000) {
    boundary(`${name}:before`);
    const stdoutPath = join(evidence, `${name}.stdout`);
    const stderrPath = join(evidence, `${name}.stderr`);
    const stdout = openSync(stdoutPath, "wx");
    const stderr = openSync(stderrPath, "wx");
    const start = new Date().toISOString();
    const result = spawnSync(process.execPath, [...preload, ...args], { cwd: snapshot, env: environment, stdio: ["ignore", stdout, stderr], timeout, killSignal: "SIGKILL" });
    closeSync(stdout); closeSync(stderr);
    const record = { name, command: [process.execPath, ...preload, ...args], cwd: snapshot, startedAt: start, finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message, stdout: { path: stdoutPath, sha256: digest(readFileSync(stdoutPath)) }, stderr: { path: stderrPath, sha256: digest(readFileSync(stderrPath)) } };
    runs.push(record);
    save(`run-${name}.json`, record);
    console.log(JSON.stringify({ name, exitCode: record.exitCode, signal: record.signal }));
    boundary(`${name}:after`);
    return record;
  }
  const pathAudit = Object.keys(inputs).filter(path => /\.(?:ts|mjs|cjs|js)$/u.test(path)).flatMap(path => readFileSync(join(snapshot, path), "utf8").split("\n").flatMap((line, index) => /\/Users\/|\/tmp\/safe-bash/u.test(line) ? [{ path, line: index + 1, text: line }] : []));
  save("path-audit.json", pathAudit);
  save("identity.json", { startedAt, evidence, snapshot, sourceCommit, marker, markerContents, markerSha256: digest(markerContents), roots, exclusions: ["node_modules separately copied and hashed", "benchmarks/reports", "native temporary directories .native-*, .hunk-native-*, patch-gnu-native-*", "root dist/.git/docs and other undeclared roots"], attempts, workingState, frozenOriginals, node: { version: process.version, executable: process.execPath, platform: platform(), arch: arch(), release: release() }, binaries, dependencyRoot, dependencyAggregate: aggregate(dependencies), dependencyCount: Object.keys(dependencies).length, packages: Object.fromEntries(["typescript", "tsx", "@types/node"].map(name => [name, JSON.parse(readFileSync(join(snapshot, "node_modules", name, "package.json"), "utf8")).version])), inputAggregate: aggregate(inputs), inputCount: Object.keys(inputs).length, clearedEnvironment });
  save("inputs.json", inputs);
  save("dependencies-before.json", dependencies);
  save("original70.json", original70);
  save("original237.json", originalFiles);
  save("revised-files.json", revisedFiles);
  console.log(JSON.stringify({ evidence, snapshot, inputCount: Object.keys(inputs).length }));
  const oracleCode = `const {oracleIdentity}=await import('./tests/commands/diff-patch-stress/gnu-target/oracle.ts'); console.log(JSON.stringify(['gnu','apple-calibration'].flatMap(profile=>['diff','patch'].map(tool=>({profile,tool,...oracleIdentity(tool,profile)}))),null,2));`;
  const oracleBefore = run("oracle-before", ["--import", "tsx", "--input-type=module", "-e", oracleCode]);
  assert.equal(oracleBefore.exitCode, 0, "mandatory GNU/Apple pins failed closed");
  const groups = {};
  for (const path of baseline.original3758.testFiles) { const suite = path.startsWith("tests/commands/diff-patch/") ? "author" : path.split("/")[3]; (groups[suite] ??= []).push(path); }
  save("test-census.json", { original: groups, revised: [`${revised}/revised.acceptance.ts`], consumer: consumerFiles });
  function cohort(name, files) {
    const eventsPath = join(evidence, `${name}.events.jsonl`);
    const record = run(name, ["--import", "tsx", "--test", "--test-concurrency=2", "--test-reporter=tap", "--test-reporter-destination=stdout", `--test-reporter=./${historical}/reporter.mjs`, `--test-reporter-destination=${eventsPath}`, ...files]);
    const output = readFileSync(record.stdout.path, "utf8");
    const counts = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(key => [key, Number([...output.matchAll(new RegExp(`^# ${key} (\\d+)$`, "gmu"))].at(-1)?.[1] ?? -1)]));
    const events = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    const failures = events.filter(event => event.type === "test:fail").map(event => event.data);
    const result = { suite: name, files, ...counts, exitCode: record.exitCode, signal: record.signal, failures, eventsSha256: existsSync(eventsPath) ? digest(readFileSync(eventsPath)) : null };
    save(`cohort-${name}.json`, result);
    console.log(JSON.stringify({ suite: name, ...counts }));
    return result;
  }
  const suites = Object.entries(groups).map(([name, files]) => cohort(name, files));
  const totals = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(name => [name, suites.reduce((sum, suite) => sum + suite[name], 0)]));
  const revisedResult = cohort("revised96", [`${revised}/revised.acceptance.ts`]);
  const consumerResult = cohort("consumer-new", consumerFiles);
  const typecheck = run("typecheck", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.json", "--pretty", "false"]);
  const build = run("build", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--pretty", "false", "--outDir", join(snapshot, "dist")]);
  const fixtureProbe = run("fixture-probe", ["--import", "tsx", `${historical}/fixture-probe.mjs`]);
  const publicProbe = run("public-probe", [`${historical}/public-probe.mjs`, fixtureProbe.stdout.path]);
  const safetyProbe = run("independent-safety", [`${owned}/safety-probe.mjs`]);
  const oracleAfter = run("oracle-after", ["--import", "tsx", "--input-type=module", "-e", oracleCode]);
  const after = inventory(snapshot);
  const dependenciesAfter = inventory(join(snapshot, "node_modules"), ["."], false);
  const outputs = Object.fromEntries(Object.entries(inventory(snapshot, ["."])).filter(([path]) => !(path in inputs)));
  const undeclaredOutputs = Object.keys(outputs).filter(path => !path.startsWith("dist/"));
  const originalAfter = originals(snapshot, after);
  const importFiles = inventory(importLogs, ["."], false);
  const imports = [...new Set(Object.keys(importFiles).flatMap(path => readFileSync(join(importLogs, path), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line).path)))].sort();
  assert(imports.includes("src/commands/diff-patch/index.ts"), "runtime import audit did not observe tested source");
  assert(imports.includes("dist/index.js"), "public-package audit did not observe built source");
  const failures = suites.flatMap(suite => suite.failures.map(failure => {
    const file = failure.file ? relative(snapshot, realpathSync(failure.file)) : null;
    const previous = old.failures.find(item => item.name === failure.name && item.file === file);
    return { suite: suite.suite, file, ...failure, relativeFile: file, historicalClassification: previous?.classification ?? null, classification: previous?.classification.startsWith("expectation-conflict") ? previous.classification : "UNEXPECTED-FAILURE-REQUIRES-INDEPENDENT-DIAGNOSIS" };
  }));
  const unexpected = failures.filter(failure => !failure.classification.startsWith("expectation-conflict"));
  const cohortIntegrity = totals.tests === 3758 && suites.every(suite => old.suites.find(item => item.suite === suite.suite)?.tests === suite.tests) && revisedResult.tests === 96 && consumerResult.tests === 61 && [...suites, revisedResult, consumerResult].every(suite => suite.skipped === 0 && suite.cancelled === 0 && suite.todo === 0);
  const immutable = aggregate(inputs) === aggregate(after) && aggregate(dependencies) === aggregate(dependenciesAfter) && undeclaredOutputs.length === 0;
  const oracleStable = oracleAfter.exitCode === 0 && oracleBefore.stdout.sha256 === oracleAfter.stdout.sha256;
  const acceptable = cohortIntegrity && immutable && oracleStable && [...suites, revisedResult, consumerResult].every(suite => suite.exitCode === 0 && suite.fail === 0) && [typecheck, build, fixtureProbe, publicProbe, safetyProbe].every(record => record.exitCode === 0);
  save("inputs-after.json", after);
  save("dependencies-after.json", dependenciesAfter);
  save("snapshot-outputs.json", outputs);
  save("import-audit.json", { moduleCount: imports.length, modules: imports, files: importFiles, enforcement: "Node registerHooks rejects file modules outside canonical snapshot; dependencies copied, no live symlink" });
  save("result.json", { startedAt, finishedAt: new Date().toISOString(), evidence, snapshot, sourceCommit, head: workingState.head, inputAggregate: aggregate(inputs), sourceAggregate: boundaries[0].sourceAggregate, dependencyAggregate: aggregate(dependencies), attempts, originalBefore: frozenOriginals, originalAfter, totals, suites, revised: revisedResult, consumer: consumerResult, failures, unexpected, runs, boundaries, cohortIntegrity, immutable, undeclaredOutputs, oracleStable, original30: { ...baseline.original30, rerun: false }, acceptable });
  console.log(JSON.stringify({ evidence, original3758: totals, revised96: revisedResult.tests, revised96Failures: revisedResult.fail, consumerTests: consumerResult.tests, consumerFailures: consumerResult.fail, unexpected: unexpected.length, cohortIntegrity, immutable, oracleStable, acceptable }));
  if (!acceptable) process.exitCode = 1;
}
