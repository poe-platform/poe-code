import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { setImmediate as turn } from "node:timers/promises";
import { cases } from "./cases.mjs";
import { Shell, ShellLimitError, MemoryFileSystem, CommandRegistry, createStandardCommands, readBytes } from "virtual-bash";

const [caseId, reportPath, mutant = "none"] = process.argv.slice(2);
const spec = cases.find(entry => entry.id === caseId);
assert.ok(spec, `unknown case ${caseId}`);
const events = [];
const cleanup = [];
const shells = [];
const tracked = [];
const output = [];
const errors = [];
const closeError = new Error("independent-return-failure");
const primaryError = new Error("independent-primary-failure");
const binary = Uint8Array.of(0x00, 0xff);
const outcome = promise => {
  const state = { settled: false };
  state.promise = Promise.resolve(promise).then(value => { Object.assign(state, { settled: true, ok: true, value }); events.push(`fulfilled:${JSON.stringify(value)}`); return state; }, reason => { Object.assign(state, { settled: true, ok: false, reason }); events.push(`rejected:${String(reason)}`); return state; });
  tracked.push(state.promise);
  return state;
};
function gate(label) {
  let resolve;
  let reject;
  let settled = false;
  const promise = new Promise((accept, fail) => { resolve = value => { if (!settled) { settled = true; events.push(`${label}:release`); accept(value); } }; reject = reason => { if (!settled) { settled = true; events.push(`${label}:reject`); fail(reason); } }; });
  cleanup.push(() => resolve({ done: true }));
  return { promise, resolve, reject };
}
async function checkpoint() { await turn(); await turn(); }
function source({ chunks = [binary], mode = "resolve", nextGate, returnGate, nextFailure } = {}) {
  const state = { reads: 0, returns: 0, acquired: 0, concurrent: 0, maxConcurrent: 0 };
  const enteredNext = gate("next-entered");
  const enteredReturn = gate("return-entered");
  const iterable = {
    [Symbol.asyncIterator]() { state.acquired++; return this; },
    next() {
      const index = state.reads++;
      state.maxConcurrent = Math.max(state.maxConcurrent, ++state.concurrent);
      events.push(`next:${index}`);
      enteredNext.resolve();
      const next = nextFailure ? Promise.reject(nextFailure.value) : nextGate ? nextGate.promise : Promise.resolve(index < chunks.length ? { done: false, value: chunks[index] } : { done: true });
      return next.finally(() => { state.concurrent--; });
    },
    return() {
      state.returns++;
      events.push("return");
      enteredReturn.resolve();
      if (mode === "sync") throw closeError;
      if (mode === "reject") return Promise.reject(closeError);
      if (mode === "zero") return Promise.reject(0);
      if (returnGate) {
        if (mutant === "bad-swallow") return returnGate.promise.catch(() => ({ done: true }));
        if (mutant === "late-unhandled") void returnGate.promise.then(value => value);
        return returnGate.promise;
      }
      return Promise.resolve({ done: true });
    },
  };
  return { iterable, state, enteredNext, enteredReturn };
}
const sink = { async write(bytes) { output.push(Buffer.from(bytes).toString("hex")); } };
const stderr = { async write(bytes) { errors.push(Buffer.from(bytes).toString("utf8")); } };
const drain = async context => { for await (const chunk of readBytes(context.stdin, context.signal)) await context.stdout.write(chunk); return { exitCode: 0 }; };
const one = async context => { for await (const chunk of readBytes(context.stdin, context.signal)) { await context.stdout.write(chunk); break; } return { exitCode: 0 }; };
function shell(extra = [], fs = new MemoryFileSystem()) {
  const commands = new CommandRegistry([...createStandardCommands(), { name: "drain", execute: drain }, { name: "one", execute: one }, { name: "status17", execute: () => ({ exitCode: 17 }) }, ...extra]);
  const instance = new Shell({ fs, commands });
  shells.push(instance);
  return instance;
}
function rejected(actual, expected) { assert.equal(actual.ok, false, "expected rejection, not fulfilled result"); assert.equal(actual.reason, expected, "exact rejection identity"); }
function counts(input, reads, returns) { assert.equal(input.state.reads, reads, "exact input read count"); assert.equal(input.state.returns, returns, "exact owning return count"); assert.ok(input.state.maxConcurrent <= 1, "serialized source reads"); }
let observedInput;
async function run() {
  if (spec.kind === "directHead") {
    const input = observedInput = source({ mode: spec.mode });
    const command = createStandardCommands().find(entry => entry.name === "head");
    const result = await command.execute({ command: "head", args: ["-c", "2"], stdin: input.iterable, stdout: sink, stderr, cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal });
    events.push(`command-status:${result.exitCode}`);
    assert.equal(result.exitCode, 1);
    assert.equal(output.join(""), "00ff");
    assert.ok(errors.join("").includes(spec.mode === "zero" ? "0" : closeError.message));
    counts(input, 1, 1);
  } else if (spec.kind === "directEof") {
    const input = observedInput = source({ mode: "sync", chunks: [new Uint8Array(), binary] });
    for await (const chunk of readBytes(input.iterable)) await sink.write(chunk);
    assert.equal(output.join(""), "00ff");
    counts(input, 3, 0);
  } else if (spec.kind === "directDeferred") {
    const returning = gate("direct-return");
    const input = observedInput = source({ returnGate: returning });
    const result = outcome(one({ stdin: input.iterable, stdout: sink, signal: new AbortController().signal }));
    await input.enteredReturn.promise;
    await checkpoint();
    assert.equal(result.settled, false);
    returning.reject(closeError);
    rejected(await result.promise, closeError);
    counts(input, 1, 1);
  } else if (spec.kind === "normal" || spec.kind === "normalDeferred") {
    const returning = spec.kind === "normalDeferred" ? gate("normal-return") : undefined;
    const input = observedInput = source({ mode: spec.mode, returnGate: returning, chunks: [binary, Uint8Array.of(0x80)] });
    const operation = spec.operation ?? "one";
    const result = outcome(shell().exec(operation, { stdin: input.iterable, stdout: sink }));
    if (returning) {
      await input.enteredReturn.promise;
      await checkpoint();
      assert.equal(result.settled, false, "ordinary awaited close remains pending");
      assert.equal(output.join(""), "00ff");
      returning.reject(closeError);
    }
    const actual = await result.promise;
    events.push(`observed-result:${JSON.stringify(actual.value ?? null)}`);
    counts(input, operation === "drain" ? 3 : operation === "status17" ? 0 : 1, operation === "drain" ? 0 : 1);
    assert.equal(output.join(""), operation === "drain" ? "00ff80" : operation === "status17" ? "" : "00ff");
    if (operation === "drain") { assert.equal(actual.ok, true); assert.equal(actual.value.exitCode, 0); assert.equal(actual.value.stderr, ""); }
    else rejected(actual, spec.mode === "zero" ? 0 : closeError);
  } else if (spec.kind === "primary") {
    const reason = spec.mode === "zero" ? 0 : primaryError;
    const input = observedInput = source({ mode: "reject", nextFailure: { value: reason } });
    const actual = await outcome(shell().exec("drain", { stdin: input.iterable, stderr })).promise;
    assert.equal(errors.join(""), `shell: line 1: ${closeError.message}\n`);
    counts(input, 1, 1);
    assert.equal(actual.ok, true, "ordinary primary read failure fulfills");
    assert.equal(actual.value.exitCode, 1);
    assert.equal(actual.value.stdout, "");
    assert.equal(output.join(""), "");
  } else if (spec.kind === "sink") {
    const input = observedInput = source({ mode: "sync" });
    const actual = await outcome(shell().exec("one", { stdin: input.iterable, stderr, stdout: { async write(bytes) { await sink.write(bytes); throw primaryError; } } })).promise;
    counts(input, 1, 1);
    assert.equal(output.join(""), "00ff");
    assert.equal(errors.join(""), `shell: line 1: ${primaryError.message}\n`);
    rejected(actual, closeError);
  } else if (spec.kind === "directPrimary") {
    const reason = spec.mode === "zero" ? 0 : primaryError;
    const input = observedInput = source({ mode: "reject", nextFailure: { value: reason } });
    rejected(await outcome(drain({ stdin: input.iterable, stdout: sink, signal: new AbortController().signal })).promise, reason);
    counts(input, 1, 1);
  } else if (spec.kind === "selected") {
    const selected = new ShellLimitError("maxCommands");
    const input = observedInput = source({ mode: "reject" });
    rejected(await outcome(shell([{ name: "fatal", execute: () => { throw selected; } }]).exec("fatal", { stdin: input.iterable })).promise, selected);
    counts(input, 0, 1);
  } else if (spec.kind === "abort") {
    const pending = gate("opaque-next");
    const returning = gate("opaque-return");
    const input = observedInput = source({ nextGate: pending, returnGate: returning });
    const controller = new AbortController();
    const reason = spec.mode === "zero" ? 0 : primaryError;
    const result = outcome(shell().exec("drain", { stdin: input.iterable, signal: controller.signal }));
    await input.enteredNext.promise;
    controller.abort(reason);
    rejected(await result.promise, reason);
    await input.enteredReturn.promise;
    counts(input, 1, 1);
    pending.reject(new Error("independent-late-next"));
    returning.reject(new Error("independent-late-return"));
    await checkpoint();
  } else if (spec.kind === "interruptReturn") {
    const returning = gate("unregistered-return");
    const input = observedInput = source({ returnGate: returning });
    const instance = shell();
    const controller = new AbortController();
    const result = outcome(instance.exec("one", { stdin: input.iterable, stdout: sink, signal: controller.signal }));
    await input.enteredReturn.promise;
    await checkpoint();
    assert.equal(result.settled, false);
    if (spec.mode === "abort") controller.abort(0);
    else await instance.dispose();
    const actual = await result.promise;
    if (spec.mode === "abort") rejected(actual, 0);
    else { assert.equal(actual.ok, false); assert.equal(actual.reason.message, "Shell is disposed"); }
    events.push("public-settled-before-return-release");
    returning.reject(closeError);
    await checkpoint();
    counts(input, 1, 1);
  } else if (spec.kind === "generator") {
    const next = gate("generator-next");
    const started = gate("generator-started");
    const finalizing = gate("generator-finalizing");
    const retired = gate("generator-retired");
    const finish = gate("generator-finish");
    let returns = 0;
    let reads = 0;
    async function* generate() {
      try { started.resolve(); await next.promise; yield binary; }
      finally { finalizing.resolve(); await finish.promise; retired.resolve(); }
    }
    const generator = generate();
    const iterable = { [Symbol.asyncIterator]() { return this; }, next() { reads++; return generator.next(); }, return() { returns++; events.push("generator-return-request"); return generator.return(); } };
    const controller = new AbortController();
    const instance = shell();
    const result = outcome(instance.exec("drain", { stdin: iterable, signal: controller.signal }));
    await started.promise;
    if (spec.mode === "abort") controller.abort(0);
    else await instance.dispose();
    const actual = await result.promise;
    if (spec.mode === "abort") rejected(actual, 0);
    else { assert.equal(actual.ok, false); assert.equal(actual.reason.message, "Shell is disposed"); }
    assert.equal(events.includes("generator-finalizing:release"), false);
    events.push("public-settled-before-generator-retired");
    next.resolve();
    await finalizing.promise;
    assert.equal(events.includes("generator-retired:release"), false);
    finish.resolve();
    await retired.promise;
    await checkpoint();
    assert.equal(returns, 1);
    assert.equal(reads, 1);
  } else if (spec.kind === "sequential") {
    const input = observedInput = source({ chunks: [binary, Uint8Array.of(0x80), Uint8Array.of(0x41)] });
    const instance = shell([{ name: "nested", execute: context => context.invoke("one", [], { stdin: context.stdin, stdinIsDefault: context.stdinIsDefault }) }, { name: "checkopen", execute: () => { assert.equal(input.state.returns, 0); return { exitCode: 0 }; } }]);
    const actual = await instance.exec("nested; checkopen; one; checkopen; drain", { stdin: input.iterable });
    assert.equal(actual.exitCode, 0);
    assert.equal(Buffer.from(actual.stdoutBytes).toString("hex"), "00ff8041");
    assert.equal(actual.stderr, "");
    counts(input, 4, 0);
  } else if (spec.kind === "siblings") {
    const pending = gate("cancelled-sibling-next");
    const returning = gate("cancelled-sibling-return");
    const siblingNext = gate("healthy-sibling-next");
    const first = observedInput = source({ nextGate: pending, returnGate: returning });
    const second = source({ nextGate: siblingNext });
    const instance = shell();
    const controller = new AbortController();
    const cancelled = outcome(instance.exec("one", { stdin: first.iterable, signal: controller.signal }));
    const healthy = outcome(instance.exec("one", { stdin: second.iterable }));
    await Promise.all([first.enteredNext.promise, second.enteredNext.promise]);
    controller.abort(0);
    rejected(await cancelled.promise, 0);
    assert.equal(healthy.settled, false);
    assert.equal(second.state.returns, 0);
    siblingNext.resolve({ done: false, value: binary });
    const result = await healthy.promise;
    assert.equal(result.ok, true);
    assert.equal(Buffer.from(result.value.stdoutBytes).toString("hex"), "00ff");
    counts(first, 1, 1);
    counts(second, 1, 1);
    pending.reject(primaryError);
    returning.reject(closeError);
    await checkpoint();
  } else if (spec.kind === "registered") {
    const entered = gate("registered-entered");
    const release = gate("registered-release");
    const acquired = gate("registered-acquired");
    const controller = new AbortController();
    const fs = new MemoryFileSystem();
    const input = observedInput = source();
    let resource;
    let completion;
    let retireCalls = 0;
    let closeCalls = 0;
    let admissionClosed = false;
    const resourceSource = source({ returnGate: release });
    if (spec.resource === "vfs") fs.readStream = (_path, options) => { assert.ok(options.signal instanceof AbortSignal); assert.equal(admissionClosed, false); return resourceSource.iterable; };
    const close = () => {
      closeCalls++;
      if (!completion) {
        admissionClosed = true;
        retireCalls++;
        entered.resolve();
        completion = Promise.resolve().then(() => spec.resource === "vfs" ? resource.return() : release.promise);
      }
      return completion;
    };
    const execute = async context => {
      assert.equal(typeof context.registerCleanup, "function");
      context.registerCleanup(close);
      resource = spec.resource === "vfs" ? context.fs.readStream("/owned", { signal: context.signal })[Symbol.asyncIterator]() : {};
      acquired.resolve();
      try { if (spec.resource === "vfs") { const chunk = await resource.next(); await context.stdout.write(chunk.value); } return { exitCode: spec.mode === "failure" ? 17 : 0 }; }
      finally { await close(); }
    };
    const instance = shell([{ name: "owned", execute }], fs);
    const result = outcome(instance.exec("owned", { stdin: input.iterable, signal: controller.signal, stdout: sink }));
    await acquired.promise;
    await entered.promise;
    if (spec.resource === "vfs") await resourceSource.enteredReturn.promise;
    await checkpoint();
    assert.equal(result.settled, false);
    let disposal;
    if (spec.mode === "dispose") { disposal = outcome(instance.dispose()); const repeated = instance.dispose(); assert.equal(repeated, instance.dispose()); await checkpoint(); assert.equal(disposal.settled, false); assert.equal(result.settled, false); }
    if (spec.mode === "abort") { controller.abort(0); await checkpoint(); assert.equal(result.settled, false); }
    if (spec.mode === "failure") release.reject(closeError);
    else release.resolve({ done: true });
    const actual = await result.promise;
    if (spec.mode === "normal") { assert.equal(actual.ok, true); assert.equal(actual.value.exitCode, 0); }
    else if (spec.mode === "failure") rejected(actual, closeError);
    else if (spec.mode === "abort") rejected(actual, 0);
    else { assert.equal(actual.ok, false); assert.equal(actual.reason.message, "Shell is disposed"); assert.equal((await disposal.promise).ok, true); }
    assert.equal(retireCalls, 1);
    assert.ok(closeCalls >= 2);
    if (spec.resource === "vfs") { counts(resourceSource, 1, 1); assert.equal(output.join(""), "00ff"); }
    counts(input, 0, 1);
    events.push(`registered-retirement:${retireCalls};close-calls:${closeCalls}`);
  } else throw new Error(`unimplemented ${spec.kind}`);
}

let failure;
try { await run(); } catch (error) { failure = { name: error?.name, message: String(error?.message ?? error), stack: error?.stack }; }
finally {
  for (const release of cleanup) release();
  await Promise.all(shells.map(instance => instance.dispose().catch(error => events.push(`cleanup-dispose:${String(error)}`))));
  await Promise.all(tracked);
  await checkpoint();
}
writeFileSync(reportPath, JSON.stringify({ id: caseId, mutant, pass: !failure, failure, events, input: observedInput?.state, output, stderr: errors, strictUnhandled: process.execArgv.includes("--unhandled-rejections=strict"), cleanup: "all controlled gates released; all tracked executions and disposals settled; no children or servers created" }, null, 2) + "\n", { flag: "wx" });
process.exitCode = failure ? 1 : 0;
