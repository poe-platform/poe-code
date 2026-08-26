import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const owned = "tests/stress/remote-cancellation";
const revision = "90ddc748f21e2164ea3f20e47f32bbdad6a5b20c";
const formatterRevision = "751c18d5ffaee371f8ba567bafb4c721e9b98988";
const frozenRevision = "4e26ce0d386b9f3fcd25c3d540b5d43361b056d3";
const outputPath = process.env.RECHECK_EVIDENCE ?? `${owned}/recheck90ddc74-verification.json`;
assert.match(outputPath, /^tests\/stress\/remote-cancellation\/recheck90ddc74-[\w.-]+\.json$/);
assert.equal(existsSync(outputPath), false, "evidence is immutable; select a fresh owned path");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();
const blob = (commit, path) => execFileSync("git", ["show", `${commit}:${path}`], { maxBuffer: 8 * 1024 * 1024 });
const sha = contents => createHash("sha256").update(contents).digest("hex");
const tree = (commit, ...paths) => git("ls-tree", "-r", "--name-only", commit, ...paths).split("\n");
const snapshot = paths => Object.fromEntries(paths.map(path => [path, existsSync(path) ? sha(readFileSync(path)) : null]));
git("merge-base", "--is-ancestor", "3731587fa287333ca59c7a81569b367cec66f61d", revision);
const frozenPaths = tree(frozenRevision, owned).filter(path => path !== `${owned}/run.mjs`);
const historicalPaths = tree("45e516e", owned).filter(path => path.includes("/handoff") || path.endsWith("/HANDOFF_3731587.md"));
const formatterPaths = ["run.mjs", "format.mjs", "format.test.mjs", "recheck90ddc74-loader.mjs", "recheck90ddc74-register.mjs"].map(path => `${owned}/${path}`);
const harnessPaths = [...formatterPaths, `${owned}/recheck90ddc74-verify.mjs`];
const sourcePaths = tree(revision, "src", "tests/fs/webdav/mock.ts").filter(path => path.endsWith(".ts"));
const sourceExpected = Object.fromEntries(sourcePaths.map(path => [path, { sha256: sha(blob(revision, path)), blob: git("rev-parse", `${revision}:${path}`) }]));
const frozenExpected = Object.fromEntries(frozenPaths.map(path => [path, sha(blob(frozenRevision, path))]));
const historicalExpected = Object.fromEntries(historicalPaths.map(path => [path, sha(blob("45e516e", path))]));
const formatterExpected = Object.fromEntries(formatterPaths.map(path => [path, sha(blob(formatterRevision, path))]));
const toolPaths = ["node_modules/typescript/package.json", "node_modules/typescript/lib/typescript.js", "node_modules/tsx/package.json", "node_modules/tsx/dist/loader.mjs"];
const takeSnapshot = () => ({ at: new Date().toISOString(), head: git("rev-parse", "HEAD"),
  status: git("status", "--short", "--untracked-files=all"), sources: snapshot(sourcePaths),
  frozen: snapshot(frozenPaths), historical: snapshot(historicalPaths), harness: snapshot(harnessPaths), tools: snapshot(toolPaths) });
const before = takeSnapshot();
assert.deepEqual(before.frozen, frozenExpected);
assert.deepEqual(before.historical, historicalExpected);
assert.deepEqual(snapshot(formatterPaths), formatterExpected);
const caseNames = [...readFileSync(`${owned}/remote-cancellation.test.ts`, "utf8").matchAll(/^audit\("([^"]+)"/gm)].map(match => match[1]);
assert.equal(caseNames.length, 24);

const processTable = () => execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8" }).trim().split("\n").map(line => {
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
  assert.ok(match, line);
  return { pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), command: match[4] };
});

async function capture(verbose) {
  const nodeOptions = `--import=tsx --import=./${owned}/recheck90ddc74-register.mjs`;
  const env = { ...process.env, NODE_OPTIONS: nodeOptions, AUDIT_REPEATS: "1" };
  delete env.AUDIT_CASE;
  delete env.AUDIT_VERBOSE;
  delete env.NODE_TEST_CONTEXT;
  if (verbose) env.AUDIT_VERBOSE = "1";
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, [`${owned}/run.mjs`], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let watchdog = false;
  let outputLimit = false;
  const observed = new Map();
  const samplingErrors = [];
  const forcedGroups = [];
  const sample = () => {
    const table = processTable();
    const descendants = new Set([child.pid]);
    let previous;
    do {
      previous = descendants.size;
      for (const row of table) if (descendants.has(row.parent)) descendants.add(row.pid);
    } while (previous !== descendants.size);
    for (const row of table) if (descendants.has(row.pid)) observed.set(row.pid, row);
    return table;
  };
  const safeSample = () => { try { return sample(); } catch (error) { samplingErrors.push(String(error)); return []; } };
  const stop = () => {
    const live = safeSample();
    const groups = new Set([child.pid, ...live.filter(row => observed.has(row.pid) && observed.get(row.pid).group === row.group).map(row => row.group)]);
    for (const group of groups) {
      try { process.kill(-group, "SIGKILL"); forcedGroups.push(group); }
      catch (error) { if (error.code !== "ESRCH") samplingErrors.push(String(error)); }
    }
  };
  const append = (stream, chunk) => {
    if (stream === "stdout") stdout += chunk;
    else stderr += chunk;
    if (stdout.length + stderr.length > 8 * 1024 * 1024 && !outputLimit) { outputLimit = true; stop(); }
  };
  child.stdout.on("data", chunk => append("stdout", chunk));
  child.stderr.on("data", chunk => append("stderr", chunk));
  const interval = setInterval(safeSample, 250);
  const timer = setTimeout(() => { watchdog = true; stop(); }, 85_000);
  const interrupted = () => { watchdog = true; stop(); };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  safeSample();
  const outcome = await new Promise(resolve => {
    child.once("error", error => resolve({ exitCode: null, signal: null, error: String(error) }));
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, error: null }));
  });
  clearInterval(interval);
  clearTimeout(timer);
  process.removeListener("SIGINT", interrupted);
  process.removeListener("SIGTERM", interrupted);
  const live = safeSample();
  const residual = live.filter(row => observed.has(row.pid) && observed.get(row.pid).group === row.group);
  if (residual.length) stop();
  return { command: `env -u AUDIT_VERBOSE -u AUDIT_CASE -u NODE_TEST_CONTEXT NODE_OPTIONS='${nodeOptions}' AUDIT_REPEATS=1${verbose ? " AUDIT_VERBOSE=1" : ""} node ${owned}/run.mjs`,
    startedAt, finishedAt: new Date().toISOString(), verbose, wrapperPid: child.pid, ...outcome, watchdog, outputLimit,
    observedProcesses: [...observed.values()], residual, forcedGroups, samplingErrors, stdout, stderr };
}

function inspect(record) {
  const raw = `${record.stdout}\n${record.stderr}`;
  const diagnostic = text => JSON.parse(text.replace(/\\([\\#])/g, "$1"));
  const loaded = [...raw.matchAll(/^(?:# )?PINNED_SOURCE (.*)$/gm)].map(match => diagnostic(match[1]));
  const cases = raw.split("\n").filter(line => line.startsWith('# {"name":')).map(line => diagnostic(line.slice(2)));
  const counts = Object.fromEntries([...raw.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const childExitCodes = [...raw.matchAll(/^REPLAY \d+: exit=(\d+)$/gm)].map(match => Number(match[1]));
  Object.assign(record, { loaded, cases, counts, childExitCodes });
  assert.equal(record.exitCode, 0);
  assert.equal(record.signal, null);
  assert.equal(record.error, null);
  assert.equal(record.watchdog, false);
  assert.equal(record.outputLimit, false);
  assert.deepEqual(record.residual, []);
  assert.deepEqual(record.forcedGroups, []);
  assert.deepEqual(record.samplingErrors, []);
  assert.doesNotMatch(raw, /AUDIT FORMAT ERROR|OUTER WATCHDOG|RESIDUAL PROCESS GROUP/);
  assert.deepEqual(childExitCodes, [0]);
  assert.deepEqual(counts, { tests: 24, pass: 24, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.deepEqual(cases.map(row => row.name), caseNames);
  assert.equal(loaded.length, new Set(loaded.map(source => source.path)).size);
  for (const source of loaded) {
    assert.equal(source.revision, revision);
    assert.deepEqual({ sha256: source.sha256, blob: source.blob }, sourceExpected[source.path]);
  }
  for (const required of ["src/index.ts", "src/commands/index.ts", "src/shell/runtime.ts", "src/fs/s3/filesystem.ts", "src/fs/webdav/webdav.ts", "tests/fs/webdav/mock.ts"]) {
    assert.ok(loaded.some(source => source.path === required), `missing actual pinned module ${required}`);
  }
  for (const row of cases) {
    assert.equal(row.verdict, "PASS", row.name);
    assert.ok(row.events.every(event => typeof event === "string"));
    assert.equal(row.events.some(event => /^(?:failure:|cleanup.failure:|head.before-rescue:|head.rescue:)/.test(event)), false, row.name);
    const operations = row.events.filter(event => event.startsWith("op:"));
    assert.ok(operations.every(event => !event.includes("callerAborted=true") && !event.endsWith("signal=aborted")), row.name);
    const nativeHttp = row.name.includes("native HTTP");
    if (nativeHttp) {
      assert.ok(row.events.includes("http.final:sockets=0:tasks=0:listening=false:errors=0"), row.name);
      assert.equal(row.events.filter(event => event === "http.socket.open").length, row.events.filter(event => event === "http.socket.close").length, row.name);
    }
    const caseId = row.name.slice(0, 3);
    const settlements = row.events.filter(event => event.startsWith("settled:"));
    if (["S02", "S04", "S05", "S07", "S12", "D02", "D04", "D05", "D07", "D11", "D12"].includes(caseId)) {
      assert.ok(settlements.some(event => event.startsWith("settled:error:ECANCELED:")), row.name);
    }
    if (["S01", "S03", "S06", "D01", "D03", "D06"].includes(caseId)) {
      assert.ok(settlements.includes("settled:shell-rejection:Error: audit cancellation"), row.name);
    }
    if (["S09", "D09"].includes(caseId)) assert.ok(settlements.some(event => event.startsWith("settled:shell-rejection:ShellLimitError:")), row.name);
    if (["S08", "D08"].includes(caseId)) {
      assert.ok(settlements.includes('settled:exit=0:stdout="first\\n"'), row.name);
      assert.equal(row.events.includes("caller.abort"), false, row.name);
    }
    if (["S10", "D10"].includes(caseId)) assert.ok(settlements.some(event => event.startsWith("settled:exit=1:stderr=")), row.name);
    if (caseId === "S11") assert.ok(settlements.some(event => event.startsWith("settled:S3RenameError:ECANCELED:phase=copy:")), row.name);
    row.independentChecks = { operationsAfterAbort: 0, nativeHttpFinalClean: nativeHttp ? true : null,
      settlements, iteratorReturns: row.events.filter(event => event === "source.return").length,
      bodyCleanup: row.events.filter(event => /^(?:late.body|body.reader|body.cancel|PUT.*return|source.return)/.test(event)) };
  }
  if (!record.verbose) {
    const summaries = raw.split("\n").filter(line => line.startsWith('{"case":')).map(line => JSON.parse(line));
    assert.deepEqual(summaries.map(row => row.case), cases.map(row => row.name.slice(0, 3)));
    assert.ok(summaries.every(row => row.verdict === "PASS"));
  }
}

const results = [];
for (let repetition = 1; repetition <= 4; repetition++) {
  const record = await capture(repetition === 4);
  record.cohort = repetition === 4 ? "verbose-control" : "original24-normal";
  record.repetition = repetition === 4 ? 1 : repetition;
  try { inspect(record); record.accepted = true; }
  catch (error) {
    record.accepted = false;
    record.verifierFailure = String(error.stack ?? error);
    console.error(`IMMEDIATE RECHECK FINDING: ${record.cohort} ${record.repetition}: ${record.verifierFailure}\n${record.stdout}\n${record.stderr}`);
  }
  results.push(record);
  console.log(JSON.stringify({ cohort: record.cohort, repetition: record.repetition, wrapper: record.exitCode,
    child: record.childExitCodes, counts: record.counts, modules: record.loaded?.length, accepted: record.accepted, residual: record.residual }));
  if (!record.accepted) break;
}

const after = takeSnapshot();
const manifest = record => JSON.stringify(record.loaded?.toSorted((left, right) => left.path.localeCompare(right.path)));
const guards = {
  frozenMatchesOriginal: JSON.stringify(before.frozen) === JSON.stringify(frozenExpected) && JSON.stringify(after.frozen) === JSON.stringify(frozenExpected),
  historicalUnchanged: JSON.stringify(before.historical) === JSON.stringify(historicalExpected) && JSON.stringify(after.historical) === JSON.stringify(historicalExpected),
  harnessUnchanged: JSON.stringify(before.harness) === JSON.stringify(after.harness),
  toolsUnchanged: JSON.stringify(before.tools) === JSON.stringify(after.tools),
  runtimeManifestStable: results.length > 0 && results.every(result => manifest(result) === manifest(results[0])),
};
const loadedPaths = [...new Set(results.flatMap(result => result.loaded?.map(source => source.path) ?? []))].sort();
const evidence = { schema: 1, purpose: "Independent original24 normal-wrapper acceptance, pinned committed product; separate formatter failure evidence",
  revision, formatterRevision, frozenRevision, ancestor3731587: true, node: process.version, platform: process.platform,
  revisionMetadata: git("show", "--format=fuller", "--no-patch", revision), before, after,
  sourceIdentity: { mechanism: "Test-only fail-closed in-memory Git loader; committed root barrel and entire actually imported product graph plus HTTP mock",
    expected: sourceExpected, loadedPaths, loadedWorktreeDiffersFromCommit: loadedPaths.filter(path => before.sources[path] !== sourceExpected[path].sha256 || after.sources[path] !== sourceExpected[path].sha256),
    loadedWorktreeDrift: loadedPaths.filter(path => before.sources[path] !== after.sources[path]), allWorktreeSourceDrift: sourcePaths.filter(path => before.sources[path] !== after.sources[path]) },
  frozenExpected, historicalExpected, formatterExpected, guards, results,
  cohorts: { original4e26ce0: "20/24 in original three replays; unchanged evidence.json/REPORT.md",
    author3731587: "reported 22/24; not this recheck",
    independent3731587: "D02/D05 2/2; final supplemental 10/10 twice; preserved 45e516e artifacts",
    author90ddc74: "reported verbose 24/24 x3 and shell 726 including 19 new; not independent evidence here",
    formatterReproduction: "pre-fix child exit 0 / wrapper exit 1; no full counts acceptance",
    current: "three fresh normal original24 processes plus one separate verbose original24 control" },
  boundaries: ["No full-shell726/FS suite, supplementary373 rerun, curl/network tests, fuzz, or head-n0 investigation",
    "S3 public injected mock transport; WebDAV native Fetch to ephemeral loopback HTTP or injected response fixtures, not live cloud/provider interoperability",
    "Original assertions establish ECANCELED codes, ShellLimitError instanceof/limit, exact caller-reason identity, iterator/body cleanup and namespace/byte effects; no assertions changed",
    "No transport starts after observed abort; no global atomicity, snapshot, remote rollback or uncooperative host side-effect guarantee",
    "Known head -n 0 before upstream first nonempty write still needs caller cancel; Sagan owns that separate unresolved case",
    "Normal runner retains raw TAP plus summaries; historical 373 all-file guard now intentionally detects the separately authorized formatter change"],
};
const passing = Object.values(guards).every(Boolean) && results.length === 4 && results.every(result => result.accepted);
evidence.passing = passing;
execFileSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${outputPath}\n${JSON.stringify(evidence, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`, maxBuffer: 1024 * 1024 });
console.log(JSON.stringify({ outputPath, passing, guards, loadedWorktreeDrift: evidence.sourceIdentity.loadedWorktreeDrift }, null, 2));
process.exitCode = passing ? 0 : 1;
