import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "/Users/kjopek/Workspace/safe-bash";
const owned = "tests/commands/diff-patch-stress/gnu-followup-checkpoint";
assert.equal(process.cwd(), repository, "orchestration must start in the correct root");
assert.equal(resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."), repository);
const marker = "/tmp/safe-bash-diff-source-checkpoint.ready";
assert(existsSync(marker), "NONFINAL: source writer has not closed; no snapshot may be captured");
const evidence = mkdtempSync("/tmp/safe-bash-diff-gnu-final-");
const startedAt = new Date().toISOString();
const digest = value => createHash("sha256").update(value).digest("hex");
const aggregate = value => digest(JSON.stringify(value));
const save = (name, value) => writeFileSync(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const roots = ["src", "tests", "benchmarks", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "AGENTS.md", "README.md"];
const exclusions = ["node_modules at any level (separately fingerprinted root dependency tree)", "benchmarks/reports (historical comparator output)", "native temporary directories matching .native-*, .hunk-native-* or patch-gnu-native-*", "root .git (selected state/proof captured externally), dist, docs and other paths outside declared roots"];
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
    else if (stat.isFile()) entries[path] = { sha256: digest(readFileSync(absolute)), size: stat.size, mode: stat.mode & 0o777 };
    else throw new Error(`Unsupported snapshot input ${path}`);
  }
  for (const path of [...selected].sort()) visit(path);
  return entries;
}
function contamination(inputs) {
  return Object.keys(inputs).filter(path => /^(?:src|tests)\//u.test(path) && /\.(?:js|jsx|cjs|mjs)(?:\.map)?$/u.test(path) && [path.replace(/\.(?:js|jsx|cjs|mjs)(?:\.map)?$/u, ".ts"), path.replace(/\.(?:js|jsx|cjs|mjs)(?:\.map)?$/u, ".tsx")].some(sibling => sibling in inputs));
}
function git(args) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const markerContents = readFileSync(marker, "utf8");
const attempts = [];
let snapshot;
let inputs;
let workingState;
for (let attempt = 1; attempt <= 6; attempt++) {
  const candidate = join(evidence, `snapshot-${attempt}`);
  mkdirSync(candidate);
  const headBefore = git(["rev-parse", "HEAD"]).trim();
  const statusBefore = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const before = inventory(repository);
  assert.deepEqual(contamination(before), [], "compiled JS siblings would contaminate the tested graph");
  for (const [path, info] of Object.entries(before)) {
    assert(!info.link, `input symlink needs explicit provenance review: ${path}`);
    mkdirSync(dirname(join(candidate, path)), { recursive: true });
    copyFileSync(join(repository, path), join(candidate, path));
    chmodSync(join(candidate, path), info.mode);
  }
  const copied = inventory(candidate);
  const after = inventory(repository);
  const headAfter = git(["rev-parse", "HEAD"]).trim();
  const statusAfter = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const stable = aggregate(before) === aggregate(after) && aggregate(before) === aggregate(copied) && headBefore === headAfter && statusBefore === statusAfter;
  attempts.push({ attempt, candidate, before: aggregate(before), after: aggregate(after), copied: aggregate(copied), headBefore, headAfter, stable });
  save(`copy-attempt-${attempt}.json`, { before, after, copied, statusBefore, statusAfter });
  if (stable) { snapshot = candidate; inputs = copied; workingState = { head: headAfter, status: statusAfter, diffSha256: digest(git(["diff", "--binary", "HEAD", "--", ...roots])), indexEntries: git(["ls-files", "--stage"]) }; break; }
}
assert(snapshot, "working tree did not stabilize across six full capture attempts");
assert.equal(readFileSync(marker, "utf8"), markerContents, "ready marker changed while freezing");
const dependencyRoot = join(repository, "node_modules");
assert.equal(realpathSync(dependencyRoot), dependencyRoot, "dependencies must resolve in the correct root");
const dependenciesBefore = inventory(dependencyRoot, ["."], false);
symlinkSync(dependencyRoot, join(snapshot, "node_modules"), "dir");
assert.equal(realpathSync(join(snapshot, "node_modules")), dependencyRoot);
const environment = { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC", TMPDIR: evidence };
const clearedEnvironment = [];
for (const name of Object.keys(environment)) {
  if (/^(?:NODE_OPTIONS|NODE_PATH|TSX_|TS_NODE_|DIFF_PATCH_|PARSER_EVIDENCE$|CANDIDATE_EVIDENCE$)/u.test(name)) { clearedEnvironment.push(name); delete environment[name]; }
}
const runs = [];
function run(name, executable, args, timeout = 600_000) {
  const stdoutPath = join(evidence, `${name}.stdout`);
  const stderrPath = join(evidence, `${name}.stderr`);
  const stdout = openSync(stdoutPath, "wx");
  const stderr = openSync(stderrPath, "wx");
  const start = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd: snapshot, env: environment, stdio: ["ignore", stdout, stderr], timeout, killSignal: "SIGKILL" });
  closeSync(stdout); closeSync(stderr);
  const record = { name, command: [executable, ...args], cwd: snapshot, startedAt: start, finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message,
    stdout: { path: stdoutPath, sha256: digest(readFileSync(stdoutPath)) }, stderr: { path: stderrPath, sha256: digest(readFileSync(stderrPath)) } };
  runs.push(record);
  console.log(JSON.stringify({ name, exitCode: record.exitCode, signal: record.signal }));
  return record;
}
const pathAudit = Object.keys(inputs).filter(path => /\.(?:ts|mjs|cjs|js)$/u.test(path)).flatMap(path => readFileSync(join(snapshot, path), "utf8").split("\n").flatMap((line, index) => /\/Users\/|\/tmp\/safe-bash/u.test(line) ? [{ path, line: index + 1, text: line }] : []));
save("path-audit.json", pathAudit);
for (const name of ["diff-emission-cleanup-proof.json", "diff-emission-cleanup-verification.json"]) if (existsSync(join(repository, ".git", name))) copyFileSync(join(repository, ".git", name), join(evidence, name));
save("identity.json", { startedAt, evidence, snapshot, marker, markerContents, markerSha256: digest(markerContents), roots, exclusions, attempts, workingState,
  node: { version: process.version, executable: process.execPath, sha256: digest(readFileSync(process.execPath)), platform: platform(), arch: arch(), release: release() },
  dependencyRoot, dependencyAggregate: aggregate(dependenciesBefore), dependencyCount: Object.keys(dependenciesBefore).length,
  packages: Object.fromEntries(["typescript", "tsx", "@types/node"].map(name => [name, JSON.parse(readFileSync(join(dependencyRoot, name, "package.json"), "utf8")).version])),
  inputAggregate: aggregate(inputs), inputCount: Object.keys(inputs).length, compiledSiblings: contamination(inputs), clearedEnvironment });
save("inputs.json", inputs);
save("dependencies-before.json", dependenciesBefore);
console.log(JSON.stringify({ evidence, snapshot, inputCount: Object.keys(inputs).length }));
const oracleCode = `const {oracleIdentity}=await import('./tests/commands/diff-patch-stress/gnu-target/oracle.ts'); console.log(JSON.stringify(['gnu','apple-calibration'].flatMap(profile=>['diff','patch'].map(tool=>({profile,tool,...oracleIdentity(tool,profile)}))),null,2));`;
const oracleBefore = run("oracle-before", process.execPath, ["--import", "tsx", "--input-type=module", "-e", oracleCode]);
assert.equal(oracleBefore.exitCode, 0, "mandatory pinned GNU/Apple oracle verification failed closed");
const tests = Object.keys(inputs).filter(path => /^tests\/commands\/(?:diff-patch|diff-patch-stress)\//u.test(path) && path.endsWith(".test.ts")).sort();
const groups = {};
for (const path of tests) { const suite = path.startsWith("tests/commands/diff-patch/") ? "author" : path.split("/")[3]; (groups[suite] ??= []).push(path); }
save("test-census.json", groups);
const suiteResults = [];
for (const [suite, files] of Object.entries(groups)) {
  const eventsPath = join(evidence, `${suite}.events.jsonl`);
  const record = run(suite, process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=2", "--test-reporter=tap", "--test-reporter-destination=stdout", `--test-reporter=./${owned}/reporter.mjs`, `--test-reporter-destination=${eventsPath}`, ...files]);
  const output = readFileSync(record.stdout.path, "utf8");
  const count = name => { const matches = [...output.matchAll(new RegExp(`^# ${name} (\\d+)$`, "gmu"))]; return matches.length ? Number(matches.at(-1)[1]) : null; };
  const events = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const failures = events.filter(event => event.type === "test:fail").map(event => event.data);
  const counts = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(name => [name, count(name)]));
  suiteResults.push({ suite, files, ...counts, exitCode: record.exitCode, signal: record.signal, failures, eventsSha256: existsSync(eventsPath) ? digest(readFileSync(eventsPath)) : null });
  console.log(JSON.stringify({ suite, ...counts }));
}
const typecheck = run("typecheck", "npm", ["run", "typecheck", "--", "--pretty", "false"]);
const build = run("build", "npm", ["run", "build", "--", "--pretty", "false", "--outDir", join(snapshot, "dist")]);
const fixtureProbe = run("fixture-probe", process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", `${owned}/fixture-probe.mjs`]);
const publicProbe = run("public-probe", process.execPath, ["--unhandled-rejections=strict", `${owned}/public-probe.mjs`, fixtureProbe.stdout.path]);
run("pruning-probe", process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", `${owned}/pruning-probe.mjs`]);
const oracleAfter = run("oracle-after", process.execPath, ["--import", "tsx", "--input-type=module", "-e", oracleCode]);
const after = inventory(snapshot);
const snapshotOutputs = Object.fromEntries(Object.entries(inventory(snapshot, ["."])).filter(([path]) => !(path in inputs)));
const undeclaredOutputs = Object.keys(snapshotOutputs).filter(path => !path.startsWith("dist/"));
const dependenciesAfter = inventory(dependencyRoot, ["."], false);
const changed = [...new Set([...Object.keys(inputs), ...Object.keys(after)])].filter(path => JSON.stringify(inputs[path]) !== JSON.stringify(after[path]));
const totals = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(name => [name, suiteResults.reduce((sum, suite) => sum + (suite[name] ?? 0), 0)]));
const immutable = changed.length === 0 && undeclaredOutputs.length === 0 && aggregate(dependenciesBefore) === aggregate(dependenciesAfter);
const oracleStable = oracleAfter.exitCode === 0 && oracleBefore.stdout.sha256 === oracleAfter.stdout.sha256;
const acceptable = immutable && oracleStable && suiteResults.every(suite => suite.exitCode === 0 && suite.tests > 0 && suite.fail === 0 && suite.skipped === 0 && suite.cancelled === 0 && suite.todo === 0) && [typecheck, build, publicProbe].every(record => record.exitCode === 0);
save("inputs-after.json", after);
save("dependencies-after.json", dependenciesAfter);
save("snapshot-outputs.json", snapshotOutputs);
save("result.json", { startedAt, finishedAt: new Date().toISOString(), evidence, snapshot, head: workingState.head, inputAggregate: aggregate(inputs), attempts, totals, suites: suiteResults, runs, immutable, changed, undeclaredOutputs, dependenciesStable: aggregate(dependenciesBefore) === aggregate(dependenciesAfter), oracleStable, compiledSiblingsAfter: contamination(after), declaredOutputs: ["snapshot dist/ from existing build", "external logs/manifests", "isolated native fixture directories and TMPDIR"], acceptable });
console.log(JSON.stringify({ evidence, ...totals, immutable, oracleStable, acceptable }));
if (!acceptable) process.exitCode = 1;
