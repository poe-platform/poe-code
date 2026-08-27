import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { account, requireReconciled } from "./account.mjs";
import { supervise } from "./supervise.mjs";
import { repository } from "./inspect.mjs";
import { isolatedHistory } from "./history.mjs";

const harness = dirname(fileURLToPath(import.meta.url));
const environment = { PATH: "/usr/bin:/bin", HOME: "/tmp", LC_ALL: "C" };
function temporary(context) { const root = mkdtempSync("/tmp/full-gate-selftest-"); context.after(() => rmSync(root, { recursive: true, force: true })); return root; }

test("prep: reject full execution without explicit handoff", () => {
  const result = spawnSync(process.execPath, [join(harness, "run.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 1); assert.match(result.stderr, /explicit --handoff/);
});

test("prep: independent accounting reconciles preserved 9920 dirty-snapshot TAP", () => {
  const parsed = account(readFileSync(join(repository, "benchmarks/reports/current-integration/clean-test.stdout.log"), "utf8"));
  requireReconciled(parsed); assert.equal(parsed.summary.tests, 9920);
  assert.deepEqual(parsed.counts, { pass: 9686, fail: 164, skipped: 70, todo: 0, cancelled: 0 });
  assert.ok(parsed.nonpassing.every(entry => entry.status !== "pass"));
});

test("prep: truncated test output cannot reconcile as a successful gate", () => {
  const parsed = account("TAP version 13\nok 1 - completed\n"); assert.equal(parsed.reconciled, false);
});

test("prep: skip and characterization remain distinct from accepted feature behavior", () => {
  const parsed = account("ok 1 - needs engine # SKIP Set SAFEJS_LOCAL_ROOT\n  ---\n  type: 'test'\n  ...\nok 2 - KNOWN UPSTREAM LIMITATION: observation\n  ---\n  type: 'test'\n  ...\n# tests 2\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n");
  requireReconciled(parsed); assert.equal(parsed.skips[0].category, "unavailable-private-engine"); assert.equal(parsed.characterizations.length, 1);
});

test("prep: GNU availability skips and noncompliant characterizations are explicitly classified", () => {
  const parsed = account("ok 1 - native vector # SKIP GNU base32 not installed; static vectors still run\nok 2 - NONCOMPLIANT characterization: host remapper\n# tests 2\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n");
  requireReconciled(parsed); assert.equal(parsed.skips[0].category, "optional-native-oracle-or-profile"); assert.equal(parsed.characterizations.length, 1);
});

test("prep: supervisor captures a bounded successful child", async context => {
  const root = temporary(context);
  const result = await supervise(process.execPath, ["-e", "console.log('owned child');"], { cwd: root, env: environment, timeoutMs: 3000, stdout: join(root, "stdout"), stderr: join(root, "stderr") });
  assert.equal(result.status, 0); assert.equal(result.clean, true); assert.equal(readFileSync(join(root, "stdout"), "utf8"), "owned child\n"); assert.equal(result.survivors.length, 0);
});

test("prep: timeout cleans its descendant but leaves another task-owned group alone", async context => {
  const root = temporary(context), outsider = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
  const exited = once(outsider, "exit");
  try {
    const source = "const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log(child.pid);setInterval(()=>{},1000);";
    const result = await supervise(process.execPath, ["-e", source], { cwd: root, env: environment, timeoutMs: 700, stdout: join(root, "stdout"), stderr: join(root, "stderr") });
    assert.equal(result.timedOut, true); assert.equal(result.clean, false); assert.equal(result.survivors.length, 0);
    assert.ok(result.observed.length >= 2); assert.equal(result.observed.some(row => row.pid === outsider.pid || row.pid === process.pid), false);
    assert.doesNotThrow(() => process.kill(outsider.pid, 0));
  } finally { outsider.kill("SIGKILL"); await exited; }
});

test("prep: module guard rejects live product fallback without executing it", context => {
  const root = temporary(context), target = pathToFileURL(join(repository, "src/index.ts")).href;
  const result = spawnSync(process.execPath, ["--import", join(harness, "import-guard.mjs"), "--input-type=module", "-e", `await import(${JSON.stringify(target)});`], { cwd: root, env: { ...environment, FULL_GATE_ROOT: root, FULL_GATE_IMPORTS: join(root, "imports"), FULL_GATE_TOOL_ROOTS: "[]" }, encoding: "utf8", timeout: 3000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /FROZEN_IMPORT_OUTSIDE/);
});

test("prep: guard accepts isolated TypeScript and preserves nested native TAP", async context => {
  const root = temporary(context), source = join(root, "fixture.ts");
  writeFileSync(source, "import test from 'node:test';import assert from 'node:assert/strict';test('literal',()=>{const value:number=3;assert.equal(value,3)});\n");
  const result = await supervise(process.execPath, ["--import", join(repository, "node_modules/tsx/dist/loader.mjs"), "--test", source], {
    cwd: root, env: { ...environment, FULL_GATE_ROOT: root, FULL_GATE_IMPORTS: join(root, "imports"), FULL_GATE_TOOL_ROOTS: JSON.stringify([join(repository, "node_modules")]), NODE_OPTIONS: "--import=" + pathToFileURL(join(harness, "import-guard.mjs")).href },
    timeoutMs: 5000, stdout: join(root, "stdout"), stderr: join(root, "stderr") });
  assert.equal(result.status, 0, readFileSync(join(root, "stderr"), "utf8") + readFileSync(join(root, "stdout"), "utf8"));
  assert.match(readFileSync(join(root, "stdout"), "utf8"), /# pass 1\b/); assert.equal(result.clean, true);
});

test("prep: output quota terminates the exact noisy child without pass status", async context => {
  const root = temporary(context);
  const result = await supervise(process.execPath, ["-e", "setInterval(()=>process.stdout.write('X'.repeat(4096)),10)"], {
    cwd: root, env: environment, timeoutMs: 3000, maxOutputBytes: 512, stdout: join(root, "stdout"), stderr: join(root, "stderr") });
  assert.equal(result.outputExceeded, true); assert.equal(result.clean, false); assert.equal(result.survivors.length, 0);
  assert.ok(readFileSync(join(root, "stdout")).length <= 512);
});

test("prep: loopback listener observation and cleanup do not require external service", async context => {
  const root = temporary(context);
  const result = await supervise(process.execPath, ["-e", "const server=require('node:net').createServer();server.listen(0,'127.0.0.1');setTimeout(()=>server.close(),1500);"], {
    cwd: root, env: environment, timeoutMs: 4000, observeSockets: true, stdout: join(root, "stdout"), stderr: join(root, "stderr") });
  assert.equal(result.status, 0); assert.equal(result.clean, true); assert.equal(result.survivors.length, 0);
  assert.ok(result.listeners.some(address => address.startsWith("127.0.0.1:")));
});

test("prep: isolated history retains frozen ancestors without later commits or live fallback", async context => {
  const root = temporary(context), origin = join(root, "origin"), destination = join(root, "destination");
  mkdirSync(origin); mkdirSync(destination);
  const env = { ...environment, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@invalid" };
  const git = (args, input) => execFileSync("git", args, { cwd: origin, env, input, encoding: "utf8", timeout: 3000 }).trim();
  git(["init", "--quiet", "--template="]);
  const blob = git(["hash-object", "-w", "--stdin"], "frozen\n"), tree = git(["mktree"], `100644 blob ${blob}\tfixture\n`);
  const ancestor = git(["commit-tree", tree, "-m", "ancestor"]), frozen = git(["commit-tree", tree, "-p", ancestor, "-m", "frozen"]);
  const later = git(["commit-tree", tree, "-p", frozen, "-m", "later"]);
  writeFileSync(join(destination, "fixture"), "frozen\n");
  const evidence = await isolatedHistory(origin, destination, frozen, join(root, "history.pack"), env);
  assert.equal(evidence.revision, frozen);
  const read = args => execFileSync("git", args, { cwd: destination, env, encoding: "utf8", timeout: 3000 }).trim();
  assert.equal(read(["show", `${ancestor}:fixture`]), "frozen");
  assert.equal(read(["status", "--porcelain"]), "");
  const unavailable = spawnSync("git", ["cat-file", "-e", later], { cwd: destination, env, timeout: 3000 });
  assert.notEqual(unavailable.status, 0); assert.equal(existsSync(join(destination, ".git/objects/info/alternates")), false);
});
