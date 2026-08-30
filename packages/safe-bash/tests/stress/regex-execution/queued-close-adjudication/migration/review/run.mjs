import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../../../..");
const base = "tests/stress/regex-execution/queued-close-adjudication";
const canonical = "tests/commands/regex-execution/followup/messageerror.test.ts";
const proposalCommit = "6dbd7d06f9c1901602b415773bb33ba1522a1c6e";
const reviewCommit = "c6bcfe0d7734be0207d67b28a0ece0f12ed8becb";
const sourceCommit = "01aa1bffe0568cc6787d5ff8e0331e024a787385";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
const blob = (commit, path) => git("show", `${commit}:${path}`);
const read = path => readFileSync(resolve(root, path));
const save = (name, value) => writeFileSync(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const oldCanonical = blob(proposalCommit, canonical).toString();
const proposal = blob(proposalCommit, `${base}/PROPOSED-TEST-DELTA.md`).toString();
const blocks = [...proposal.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(match => match[1]);
assert.equal(blocks.length, 2);
assert.equal(hash(oldCanonical), "29b38d1603829e8f914410463b0537752aa585444a990e204b96948b92d14214");
assert.equal(hash(proposal), "ff5d5e3e639b3f5f375920ec85168ce8dbeca7d9000da48a3b531a613aa4962a");
assert.equal(blob(sourceCommit, canonical).toString(), oldCanonical);
const oldBlock = /    const closing = second\.close\(\)\.then\(\(\) => \{ closed = true; \}\);[\s\S]*?    await closing;/g;
assert.equal([...oldCanonical.matchAll(oldBlock)].length, 1);
const anchor = 'for (const prior of ["protocol", "abort", "timeout", "worker-error", "dispose"] as const) {';
assert.equal(oldCanonical.split(anchor).length, 2);
const expected = oldCanonical.replace(oldBlock, () => blocks[0]).replace(anchor, () => `${blocks[1]}\n\n${anchor}`);
const prior = JSON.parse(blob(reviewCommit, `${base}/review/evidence.json`));
const frozenPaths = git("ls-tree", "-r", "--name-only", reviewCommit, base).toString().trim().split("\n");
const previousFreeze = JSON.parse(blob(proposalCommit, `${base}/evidence/freeze.json`));
const preservation = [
  ...frozenPaths.map(path => ({ commit: reviewCommit, path })),
  ...previousFreeze.historical.map(entry => ({ commit: entry.revision, path: entry.path })),
  ...["client.ts", "protocol.ts", "worker.ts"].map(name => ({ commit: sourceCommit, path: `src/commands/regex-execution/${name}` })),
  { commit: sourceCommit, path: "src/contracts/command.ts" },
  { commit: sourceCommit, path: "src/contracts/command.md" },
].map(entry => ({ ...entry, sha256: hash(blob(entry.commit, entry.path)), liveSha256: hash(read(entry.path)) }));
for (const entry of preservation) assert.equal(entry.liveSha256, entry.sha256, entry.path);

if (process.argv[2] === "--freeze-only") {
  save("freeze.json", {
    started: new Date().toISOString(), proposalCommit, reviewCommit, sourceCommit,
    head: git("rev-parse", "HEAD").toString().trim(), status: git("status", "--short").toString(),
    stagedPaths: git("diff", "--cached", "--name-only").toString(),
    canonicalPrechangeSha256: hash(oldCanonical), expectedCanonicalSha256: hash(expected),
    proposalSha256: hash(proposal), preservation,
    priorProbeSha256: prior.identities["probe.mjs"], priorCompiled: prior.identities,
    node: process.version, typescript: ts.version, tsx: JSON.parse(read("node_modules/tsx/package.json")).version,
    runtimeAcceptance: "Await explicit root/user Sagan frozen handoff; fixture commit is not runtime acceptance.",
  });
  console.log("Frozen proposal, canonical prechange, source, prior harness and historical identities.");
} else {
  const freeze = JSON.parse(readFileSync(resolve(directory, "freeze.json")));
  assert.deepEqual(preservation, freeze.preservation);
  const commit = git("rev-parse", "--verify", `${process.argv[2]}^{commit}`).toString().trim();
  const actual = blob(commit, canonical);
  assert.equal(actual.toString(), expected, "entire canonical fixture must equal exact approved replacement plus separate OPEN test");
  assert.equal(blob(`${commit}^`, canonical).toString(), oldCanonical);
  assert.deepEqual(read(canonical), actual, "live canonical fixture matches immutable migration commit");
  const changed = git("diff-tree", "--no-commit-id", "--name-only", "-r", commit).toString().trim().split("\n");
  assert.ok(changed.includes(canonical));
  assert.ok(changed.every(path => path === canonical || (path.startsWith(`${base}/migration/`) && !path.startsWith(`${base}/migration/review/`))), "migration commit must not change source, history, or reviewer files");
  writeFileSync(resolve(directory, "canonical.diff"), git("diff", `${commit}^`, commit, "--", canonical), { flag: "wx" });
  save("agreement.json", { commit, parent: git("rev-parse", `${commit}^`).toString().trim(), changed,
    canonicalPrechangeSha256: hash(oldCanonical), proposalSha256: hash(proposal),
    expectedCanonicalSha256: hash(expected), actualCanonicalSha256: hash(actual), exactAgreement: true,
    unrelatedTestsAndSurroundingCleanupUnchanged: true, runtimeAcceptance: freeze.runtimeAcceptance });
  const scratch = resolve(directory, ".replay");
  assert.equal(existsSync(scratch), false);
  const put = (path, bytes) => { const target = resolve(scratch, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: "wx" }); };
  const identities = {};
  const results = [];
  async function run(label, args, expectedTests) {
    const command = [process.execPath, "--unhandled-rejections=strict", "--max-old-space-size=96", ...args];
    const child = spawn(command[0], command.slice(1), { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "--unhandled-rejections=strict" } });
    const state = { label, command, pid: child.pid, started: new Date().toISOString(), stdout: "", stderr: "", events: [], safetyTermination: false };
    let bytes = 0;
    const stop = reason => { state.safetyTermination = true; state.killReason = reason; child.kill("SIGKILL"); };
    const timer = setTimeout(() => stop("exact-child 10-second watchdog"), 10000);
    for (const [stream, key] of [[child.stdout, "stdout"], [child.stderr, "stderr"]]) {
      stream.on("data", chunk => { bytes += chunk.length; if (bytes > 65536) stop("64-KiB combined output cap"); else state[key] += chunk; });
      stream.on("close", () => state.events.push(`${key}-close`));
    }
    child.on("error", error => { state.spawnError = String(error); });
    child.on("exit", (code, signal) => state.events.push({ exit: code, signal }));
    const result = await new Promise(resolveResult => child.on("close", (code, signal) => resolveResult({ code, signal })));
    clearTimeout(timer);
    let pidAbsent = false;
    try { process.kill(child.pid, 0); } catch (error) { if (error.code === "ESRCH") pidAbsent = true; else throw error; }
    const evidence = { ...state, ...result, pidAbsent, ipcConnected: child.connected, finished: new Date().toISOString() };
    results.push(evidence);
    save(`${label}.json`, evidence);
    assert.equal(result.code, 0, state.stdout + state.stderr);
    assert.equal(result.signal, null);
    assert.equal(state.spawnError, undefined);
    assert.equal(state.safetyTermination, false);
    assert.equal(pidAbsent, true);
    assert.equal(child.connected, false);
    assert.ok(state.events.includes("stdout-close") && state.events.includes("stderr-close"));
    assert.ok(state.events.some(event => event.exit === 0));
    assert.match(state.stdout, new RegExp(`# tests ${expectedTests}\\n`));
    assert.match(state.stdout, new RegExp(`# pass ${expectedTests}\\n`));
    assert.match(state.stdout, /# fail 0\n/);
    console.log(`${label}: ${expectedTests}/${expectedTests}; exact child ${child.pid} absent`);
    return evidence;
  }
  try {
    put(`canonical/${canonical}`, actual);
    put("canonical/package.json", blob(sourceCommit, "package.json"));
    for (const name of ["client", "protocol"]) {
      const path = `src/commands/regex-execution/${name}.ts`;
      const source = blob(sourceCommit, path);
      const compiled = read(`${base}/review/.generated/${name}.js`);
      assert.equal(hash(source), prior.identities[path]);
      assert.equal(hash(compiled), prior.identities[`.generated/${name}.js`]);
      assert.equal(compiled.toString(), ts.transpileModule(source.toString(), { fileName: `${name}.ts`, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
      identities[path] = hash(source);
      identities[`.generated/${name}.js`] = hash(compiled);
      put(`canonical/${path}`, source);
      put(`.generated/${name}.js`, compiled);
    }
    const probe = blob(reviewCommit, `${base}/review/probe.mjs`);
    assert.equal(hash(probe), prior.identities["probe.mjs"]);
    identities["probe.mjs"] = hash(probe);
    put("probe.mjs", probe);
    save("replay-identities.json", { sourceCommit, reviewCommit, identities, probeSemanticBodyUnchanged: true, compiledBytesReused: true, nativeWorkers: 0 });
    const names = "^idle messageerror (retires promptly, holds capacity and close awaits cleanup|holds capacity until retirement for an open queued session)$";
    await run("canonical-two", ["--import", "tsx", "--test", "--experimental-test-isolation=none", "--test-concurrency=1", "--test-reporter=tap", `--test-name-pattern=${names}`, resolve(scratch, "canonical", canonical)], 2);
    const independent = await run("independent-six", [resolve(scratch, "probe.mjs")], 6);
    assert.match(independent.stdout, /"finishedFixtures":8,"fakeTransports":8,"nativeWorkers":0,"remainingFakeWorkers":0/);
  } finally {
    const preserved = preservation.map(entry => ({ ...entry, finalSha256: hash(read(entry.path)) }));
    const canonicalUnchanged = hash(read(canonical)) === hash(actual);
    rmSync(scratch, { recursive: true, force: true });
    save("finish.json", { finished: new Date().toISOString(), preserved, canonicalUnchanged,
      exactScratchRemoved: !existsSync(scratch), children: results.map(({ label, pid, code, signal, pidAbsent, safetyTermination }) => ({ label, pid, code, signal, pidAbsent, safetyTermination })),
      strictUnhandledRejections: true, independentGroups: 6, independentVariants: 8,
      riskyProbesRun: 0, originalFiveReruns: 0, fullSuiteRuns: 0, authorBroadCohortReruns: 0,
      runtimeAcceptance: freeze.runtimeAcceptance });
    assert.ok(preserved.every(entry => entry.sha256 === entry.finalSha256));
    assert.equal(canonicalUnchanged, true);
  }
}
