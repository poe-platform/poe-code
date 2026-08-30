import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [candidate, output, mode = "source", mutant = "none"] = process.argv.slice(2);
const api = mode === "packed" ? await import("virtual-bash") : await import(pathToFileURL(join(candidate, "dist/index.js")).href);
const column = await import(pathToFileURL(join(candidate, "dist/commands/column/index.js")).href);
const events = [], cases = [];
process.on("unhandledRejection", (reason) => events.push(String(reason)));
const tick = () => new Promise((resolve) => setImmediate(resolve));
function gate() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`deadline: ${label}`)), 1800); })]); }
  finally { clearTimeout(timer); }
}
function observe(promise) {
  const state = { settled: false };
  state.promise = promise.then((value) => { state.settled = true; return { kind: "result", value }; }, (error) => { state.settled = true; return { kind: "rejection", error }; });
  return state;
}
const serialize = (outcome) => outcome.kind === "result" ? { kind: outcome.kind, exitCode: outcome.value.exitCode, stdoutHex: Buffer.from(outcome.value.stdoutBytes).toString("hex"), stderrHex: Buffer.from(outcome.value.stderrBytes).toString("hex") } : { kind: outcome.kind, error: String(outcome.error) };
async function check(id, name, body) {
  const row = { id, name, status: "pending", effects: {} };
  cases.push(row);
  try { await body(row); row.status = "pass"; }
  catch (error) { row.status = "fail"; row.failure = { message: String(error), stack: error.stack }; }
}
function sameFailure(outcome, reason, row) {
  assert.equal(outcome.kind, "rejection");
  const observed = mutant === "wrong-error" ? new Error("wrong error detector sentinel") : outcome.error;
  row.exactReasonIdentity = observed === reason;
  assert.equal(observed, reason, "exact error identity");
}
function nonzero(outcome) {
  assert.equal(outcome.kind, "result");
  assert.equal(outcome.value.exitCode, 1);
  assert.equal(outcome.value.stdout, "");
  assert.equal(outcome.value.stderr, "column: EFBIG: column input limit exceeded\n");
}
async function pendingBarrier(states, row) {
  await tick(); await tick();
  row.beforeRelease = states.map((state) => state.settled);
  assert(states.every((state) => !state.settled), "registered/normal barrier must remain pending before release");
}
async function raw(row, action, rejectReturn = false, grep = false) {
  const host = new api.Shell({ fs: api.createMemoryFileSystem() });
  host.use(column.columnCommands({ limits: { maxInputBytes: 1 } }));
  if (grep) host.register(api.createStandardCommands().find((definition) => definition.name === "grep"));
  const entered = gate(), release = gate(), retired = gate();
  const controller = new AbortController(), reason = { label: "exact-caller-abort" }, failure = new Error("raw return sentinel");
  const stdout = [], stderr = [];
  let returns = 0, reads = 0, disposal, returnRetired = false;
  const stdin = { [Symbol.asyncIterator]() { return {
    async next() { reads++; return { done: false, value: Buffer.from(grep ? "keep\n" : "a b\n") }; },
    async return() { returns++; entered.resolve(); try { await release.promise; return { done: true }; } finally { returnRetired = true; retired.resolve(); } },
  }; } };
  const execution = observe(host.exec(grep ? "grep -q keep" : "column -t", { stdin, signal: controller.signal, stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } } }));
  try {
    await bounded(entered.promise, "raw return requested");
    assert.equal(returns, 1);
    await pendingBarrier([execution], row);
    if (action !== "normal") {
      if (action === "abort") controller.abort(reason);
      disposal = observe(host.dispose());
      const outcome = await bounded(execution.promise, "unregistered exec settles before release");
      await bounded(disposal.promise, "unregistered dispose settles before release");
      row.afterInterruptBeforeRelease = { execSettled: execution.settled, disposeSettled: disposal.settled, returns, retired: returnRetired };
      assert.equal(returnRetired, false);
      assert.equal(outcome.kind, "rejection");
      if (action === "abort") sameFailure(outcome, reason, row);
      else assert.equal(String(outcome.error), "Error: Shell is disposed");
      row.outcome = serialize(outcome);
      release.reject(failure);
    } else {
      if (rejectReturn) release.reject(failure); else release.resolve();
      const outcome = await bounded(execution.promise, "normal exec after return release");
      row.outcome = serialize(outcome);
      if (rejectReturn) sameFailure(outcome, failure, row); else nonzero(outcome);
    }
    await bounded(retired.promise, "raw return retirement");
    await tick(); await tick();
    row.retiredAfterControlledRelease = true;
    row.returns = returns; row.reads = reads;
    assert.equal(returns, 1);
  } finally {
    release.resolve();
    await bounded(execution.promise, "raw final execution");
    await bounded(host.dispose(), "raw final disposal");
    if (disposal) await bounded(disposal.promise, "raw repeated disposal");
    row.observedStdoutHex = Buffer.concat(stdout).toString("hex");
    row.observedStderrHex = Buffer.concat(stderr).toString("hex");
    row.allOwnedGatesReleased = true;
  }
}
async function owned(row, action, rejectReturn = false, register = true) {
  const host = new api.Shell({ fs: api.createMemoryFileSystem() });
  host.use(column.columnCommands({ limits: { maxInputBytes: 1 } }));
  const entered = gate(), release = gate(), retired = gate();
  const controller = new AbortController(), reason = { code: "ENOENT", label: "exact-owned-caller" }, failure = new Error("owned return sentinel");
  const trace = [], completions = [];
  let acquired = false, admissionClosed = false, completion, returns = 0, externalReturns = 0, registrations = 0, disposal, repeatedDisposal;
  function cleanup() {
    admissionClosed = true;
    completion ??= (async () => {
      assert(acquired);
      returns++; trace.push("return-requested"); entered.resolve();
      try { await release.promise; } finally { trace.push("retired"); retired.resolve(); }
    })();
    completions.push(completion);
    return completion;
  }
  host.use(async (context, next) => {
    if (register && mutant !== "remove-registration") { context.registerCleanup(cleanup); registrations++; trace.push("registered"); }
    assert.equal(admissionClosed, false);
    acquired = true; trace.push("acquired");
    try { return await next(); }
    finally { await cleanup(); }
  });
  const stdin = { [Symbol.asyncIterator]() { return {
    async next() { assert(acquired && !admissionClosed); return { done: false, value: Buffer.from("a b\n") }; },
    async return() { externalReturns++; await cleanup(); return { done: true }; },
  }; } };
  const stdout = [], stderr = [];
  const execution = observe(host.exec("column -t", { stdin, signal: controller.signal, stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } } }));
  try {
    await bounded(entered.promise, "owned retirement requested");
    await pendingBarrier([execution], row);
    if (action !== "normal") {
      if (action === "abort") controller.abort(reason);
      disposal = observe(host.dispose()); repeatedDisposal = observe(host.dispose());
      if (register) await pendingBarrier([execution, disposal, repeatedDisposal], row);
      else {
        await bounded(execution.promise, "negative unregistered exec");
        await bounded(disposal.promise, "negative unregistered dispose");
        await bounded(repeatedDisposal.promise, "negative repeated dispose");
        row.negativeBeforeRelease = [execution.settled, disposal.settled, repeatedDisposal.settled];
        assert.deepEqual(row.negativeBeforeRelease, [true, true, true]);
      }
    }
    if (rejectReturn) release.reject(failure); else release.resolve();
    await bounded(retired.promise, "owned controlled retirement");
    const outcome = await bounded(execution.promise, "owned exec after retirement");
    row.outcome = serialize(outcome);
    if (action === "abort") sameFailure(outcome, reason, row);
    else if (action === "dispose") { assert.equal(outcome.kind, "rejection"); assert.equal(String(outcome.error), "Error: Shell is disposed"); }
    else if (rejectReturn) sameFailure(outcome, failure, row);
    else nonzero(outcome);
    if (disposal) {
      const disposed = await bounded(disposal.promise, "owned dispose");
      const repeated = await bounded(repeatedDisposal.promise, "owned repeated dispose");
      row.disposalOutcome = disposed.kind === "rejection" ? { kind: disposed.kind, error: String(disposed.error), exactCleanupReason: disposed.error === failure } : { kind: disposed.kind };
      if (rejectReturn) { sameFailure(disposed, failure, row); sameFailure(repeated, failure, row); }
      else { assert.equal(disposed.kind, "result"); assert.equal(repeated.kind, "result"); }
    }
    assert.equal(returns, 1); assert.equal(externalReturns, 1);
    assert(completions.every((promise) => promise === completion), "overlapping cleanup shares exact completion identity");
    assert.equal(registrations, register ? 1 : 0);
    assert.deepEqual(trace.slice(0, register ? 2 : 1), register ? ["registered", "acquired"] : ["acquired"]);
    row.sharedCompletionIdentity = true;
  } finally {
    release.resolve();
    await bounded(execution.promise, "owned final execution");
    const finalDisposal = await bounded(observe(host.dispose()).promise, "owned final disposal");
    if (completion) await bounded(completion.catch(() => {}), "owned final retirement");
    if (disposal) await bounded(disposal.promise, "owned final concurrent disposal");
    if (repeatedDisposal) await bounded(repeatedDisposal.promise, "owned final repeated disposal");
    row.trace = trace; row.registrations = registrations; row.returns = returns; row.externalReturns = externalReturns;
    row.cleanupCalls = completions.length; row.closedAdmission = admissionClosed;
    row.observedStdoutHex = Buffer.concat(stdout).toString("hex"); row.observedStderrHex = Buffer.concat(stderr).toString("hex");
    row.allOwnedGatesReleased = true;
    if (rejectReturn && disposal) sameFailure(finalDisposal, failure, row);
    else assert.equal(finalDisposal.kind, "result");
  }
}
const definitions = [
  ["C01", "raw normal return gate delays exec", (row) => raw(row, "normal")],
  ["C02", "raw column rejection preserves exact error", (row) => raw(row, "normal", true)],
  ["C03", "public standard grep rejection control", (row) => raw(row, "normal", true, true)],
  ["C04", "dispose interrupts opaque return; late rejection observed", (row) => raw(row, "dispose")],
  ["C05", "caller abort identity; late raw rejection observed", (row) => raw(row, "abort")],
  ["C06", "registered normal return gate delays exec", (row) => owned(row, "normal")],
  ["C07", "registered exec and repeated dispose strong barrier", (row) => owned(row, "dispose")],
  ["C08", "registered caller abort barrier and exact identity", (row) => owned(row, "abort")],
  ["C09", "registered cleanup rejection beats nonzero result", (row) => owned(row, "normal", true)],
  ["C10", "caller abort wins registered retirement rejection", (row) => owned(row, "abort", true)],
  ["C11", "same owner without registration lacks strong barrier", (row) => owned(row, "dispose", false, false)],
  ["C12", "public Shell internal column exact bytes and VFS effects", async (row) => {
    const fs = api.createMemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("a b\nc d\n"));
    const host = new api.Shell({ fs }); host.use(column.columnCommands());
    try {
      const result = await host.exec("column -t /input > /output");
      row.outcome = serialize({ kind: "result", value: result });
      row.effects.inputHex = Buffer.from(await fs.readFile("/input")).toString("hex");
      row.effects.outputHex = Buffer.from(await fs.readFile("/output")).toString("hex");
      if (mutant === "wrong-output") row.effects.outputHex = "00";
      assert.equal(result.exitCode, 0); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
      assert.equal(row.effects.inputHex, Buffer.from("a b\nc d\n").toString("hex"));
      assert.equal(row.effects.outputHex, Buffer.from("a  b\nc  d\n").toString("hex"), "exact output detector");
    } finally { await host.dispose(); }
  }],
];
const selection = { "remove-registration": "C07", "wrong-output": "C12", "wrong-error": "C02", "late-unhandled": "C04" };
for (const [id, name, body] of definitions) if (mutant === "none" || selection[mutant] === id) await check(id, name, body);
if (mutant === "late-unhandled") { void Promise.reject(new Error("late-unhandled detector sentinel")); await tick(); await tick(); }
await tick(); await tick();
const result = { candidate, mode, mutant, node: process.version, cases, counts: { total: cases.length, pass: cases.filter((row) => row.status === "pass").length, fail: cases.filter((row) => row.status === "fail").length }, unhandledRejections: events, allCasesAndGatesFinished: true };
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(result));
if (result.counts.fail || events.length) process.exitCode = 1;
