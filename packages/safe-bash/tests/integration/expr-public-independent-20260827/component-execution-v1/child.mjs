import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { observe } from "./observer.mjs";
import { fixtures, runPublicCases } from "./consumer-component.mjs";

const id = process.argv[2];
const binding = JSON.parse(readFileSync(new URL("./binding.json", import.meta.url)));
const receipt = { id, node: process.version, executable: process.execPath, status: "running", details: [] };
const positive = result => {
  assert.equal(result.exitCode, 0);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from("1\n"));
  assert.equal(Buffer.from(result.stderrBytes).length, 0);
};
const failed = result => {
  assert.equal(result.exitCode, 3);
  assert.equal(Buffer.from(result.stdoutBytes).length, 0);
  assert.match(Buffer.from(result.stderrBytes).toString(), /^expr: [^\r\n]+\n$/u);
};
let root;
function shell(regex = {}) { return new root.Shell({ fs: root.createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(root.agentCommands({ regex })); }
async function ordinary() {
  observe.setMode("ordinary");
  const instance = shell(), start = observe.begin();
  try { positive(await instance.exec("expr abc : a")); assert.ok(observe.records.slice(start).every(record => record.closed)); }
  finally { await instance.dispose(); }
  await observe.end(start);
}
function invocation(definition) {
  const controller = new AbortController(), cleanups = [], output = [], errors = [];
  const context = { command: "expr", args: ["abc", ":", "a"], cwd: "/", env: { LC_ALL: "C" }, fs: root.createMemoryFileSystem(), signal: controller.signal,
    stdout: { async write(bytes) { output.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { errors.push(Buffer.from(bytes)); } },
    registerCleanup(cleanup) { observe.mark("direct-cleanup-registration"); cleanups.push(cleanup); } };
  Object.defineProperty(context, "stdin", { get() { assert.fail("unexpected stdin"); } });
  const execution = Promise.resolve(definition.execute(context)); void execution.catch(() => {});
  const result = async () => ({ ...await execution, stdoutBytes: Buffer.concat(output), stderrBytes: Buffer.concat(errors) });
  const close = async () => { for (const cleanup of cleanups) { const first = cleanup(), second = cleanup(); assert.equal(first, second); await Promise.all([first, second]); } };
  return { controller, cleanups, execution, result, close };
}
async function heldControl(release) {
  observe.setMode("hold-real-replies");
  const start = observe.begin(), instance = invocation(root.createExprCommand({ regex: { maxWorkers: 2, requestTimeoutMs: 1000 } }));
  try {
    await observe.wait(() => observe.records.length === start + 1 && observe.records[start].held.length === 1);
    assert.equal(observe.records[start].closed, false);
    if (release) observe.records[start].worker.release();
    const result = await instance.result();
    if (release) positive(result); else failed(result);
    assert.equal(observe.records[start].closed, true);
    receipt.details.push({ control: release ? "genuine-reply-released" : "genuine-reply-withheld-product-timeout", exitCode: result.exitCode });
  } finally { instance.controller.abort(new Error("control cleanup")); await instance.close(); observe.setMode("ordinary"); }
  await observe.end(start);
}
async function startup() {
  observe.setMode("silent-ready");
  const start = observe.begin(), instance = shell({ startupTimeoutMs: 50, requestTimeoutMs: 1000, maxWorkers: 1 });
  try {
    const result = await instance.exec("expr abc : a");
    observe.mark("R25-EXEC-ONLY-SETTLED-BEFORE-DISPOSE");
    failed(result);
    const workers = observe.records.slice(start); assert.equal(workers.length, 1);
    assert.equal(workers[0].online, true); assert.equal(workers[0].ready, 0); assert.equal(workers[0].requests, 0);
    assert.equal(workers[0].closed, true); assert.ok(workers[0].terminations > 0);
    receipt.details.push({ exitCode: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderr: Buffer.from(result.stderrBytes).toString(), retiredBeforeExecOnly: true });
  } finally { observe.mark("R25-DISPOSE-CALLED"); await instance.dispose(); observe.mark("R25-DISPOSE-SETTLED"); observe.setMode("ordinary"); }
  await observe.end(start);
}
async function cancelDirect() {
  observe.setMode("hold-real-replies");
  const start = observe.begin(), definition = root.createExprCommand({ regex: { maxWorkers: 2 } });
  const first = invocation(definition), sibling = invocation(definition);
  let siblingSettled = false; void sibling.execution.finally(() => { siblingSettled = true; }).catch(() => {});
  const reason = Object.assign(new Error("independent-direct-EACCES"), { code: "EACCES" });
  try {
    await observe.wait(() => observe.records.length === start + 2 && observe.records.slice(start).every(record => record.requests === 1 && record.held.length === 1));
    observe.mark("R26-direct-both-admitted-genuine-replies-held");
    assert.equal(siblingSettled, false); first.controller.abort(reason);
    await assert.rejects(first.execution, error => error === reason);
    observe.mark("R26-direct-EXEC-SETTLED");
    assert.equal(observe.records[start].closed, true); assert.equal(observe.records[start + 1].closed, false);
    assert.equal(sibling.controller.signal.aborted, false); assert.equal(siblingSettled, false);
    await first.close(); observe.mark("R26-direct-overlapping-cleanup-settled");
    observe.records[start + 1].worker.release(); positive(await sibling.result()); await sibling.close();
    assert.equal(observe.records[start + 1].closed, true); observe.mark("R26-direct-sibling-SETTLED");
    receipt.details.push({ boundary: "direct", identicalReason: true, siblingLiveAtAbort: true, siblingExact: "1LF/status0/emptyStderr", overlappingCleanup: true });
  } finally { first.controller.abort(reason); sibling.controller.abort(new Error("direct final cleanup")); await Promise.all([first.close(), sibling.close()]); observe.setMode("ordinary"); }
  await observe.end(start);
}
async function cancelShell() {
  observe.setMode("hold-real-replies");
  const start = observe.begin(), first = shell({ maxWorkers: 2 }), sibling = shell({ maxWorkers: 2 });
  const firstController = new AbortController(), siblingController = new AbortController();
  const execution = first.exec("expr abc : a", { signal: firstController.signal }); void execution.catch(() => {});
  const siblingExecution = sibling.exec("expr abc : a", { signal: siblingController.signal }); void siblingExecution.catch(() => {});
  let siblingSettled = false; void siblingExecution.finally(() => { siblingSettled = true; }).catch(() => {});
  const reason = Object.assign(new Error("independent-shell-EACCES"), { code: "EACCES" });
  try {
    await observe.wait(() => observe.records.length === start + 2 && observe.records.slice(start).every(record => record.requests === 1 && record.held.length === 1));
    observe.mark("R26-shell-both-admitted-genuine-replies-held");
    firstController.abort(reason);
    const disposal = first.dispose().then(() => { observe.mark("R26-shell-DISPOSE-SETTLED"); assert.equal(observe.records[start].closed, true); });
    await assert.rejects(execution, error => error === reason);
    observe.mark("R26-shell-EXEC-SETTLED"); assert.equal(observe.records[start].closed, true);
    await disposal;
    assert.equal(observe.records[start + 1].closed, false); assert.equal(siblingController.signal.aborted, false); assert.equal(siblingSettled, false);
    observe.records[start + 1].worker.release(); positive(await siblingExecution);
    observe.mark("R26-shell-sibling-EXEC-SETTLED"); assert.equal(observe.records[start + 1].closed, true);
    receipt.details.push({ boundary: "Shell/agentCommands", identicalReasonObserved: true, retiredBeforeExecAndDispose: true, siblingLiveThroughFirstDispose: true, siblingExact: "1LF/status0/emptyStderr" });
  } finally { firstController.abort(reason); siblingController.abort(new Error("shell final cleanup")); await Promise.all([first.dispose(), sibling.dispose()]); observe.setMode("ordinary"); }
  await observe.end(start);
}
try {
  if (id === "subpath-negative") {
    await assert.rejects(import("virtual-bash/commands/expr"), error => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED");
  } else {
    root = await import("virtual-bash");
    if (id === "root-negative") { assert.equal(typeof root.createExprCommand, "undefined"); assert.equal(typeof root.Shell, "function"); assert.equal(typeof root.createAgentCommands, "function"); }
    else if (id === "source-poison") assert.fail("source poison did not execute");
    else if (id === "ordinary" || id === "worker-restored" || id === "subpath-restored") { await import("virtual-bash/commands/expr"); await ordinary(); }
    else if (id === "held-release") await heldControl(true);
    else if (id === "held-withhold") await heldControl(false);
    else if (id === "R25") await startup();
    else if (id === "R26") { await cancelDirect(); await cancelShell(); }
    else if (id === "worker-negative") {
      const start = observe.begin(), instance = shell();
      try { const result = await instance.exec("expr abc : a"); observe.mark("worker-negative-EXEC-ONLY"); failed(result); assert.equal(observe.records.length, start + 1); assert.equal(observe.records[start].closed, true); receipt.details.push({ exitCode: result.exitCode, stderr: Buffer.from(result.stderrBytes).toString() }); }
      finally { await instance.dispose(); await Promise.all(observe.records.slice(start).map(record => record.stderrDone)); }
    } else {
      const fixture = fixtures.runtimeCases.find(value => value.id === id); assert.ok(fixture);
      fixtures.runtimeCases.splice(0, fixtures.runtimeCases.length, fixture);
      const result = await runPublicCases({ root, subpath: await import("virtual-bash/commands/expr"), binding, observe });
      assert.deepEqual(result.results.map(value => value.id), [id]);
      if (id === "R23") assert.deepEqual(observe.records.map(record => [record.resourceLimits.maxOldGenerationSizeMb, record.resourceLimits.stackSizeMb]), [[128, 4], [48, 3], [64, 3], [64, 3]]);
      if (id === "R24") assert.equal(observe.records.length, 0);
      receipt.details.push(result);
    }
  }
  receipt.status = "pass";
} catch (error) { receipt.status = "fail"; receipt.error = { message: error.message, code: error.code, stack: error.stack }; process.exitCode = 1; }
finally { receipt.observer = observe.serializable(); console.log(JSON.stringify(receipt)); }
