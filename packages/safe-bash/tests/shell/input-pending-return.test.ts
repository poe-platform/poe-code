import assert from "node:assert/strict";
import { test } from "node:test";
import type { ByteSource } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 32 && !predicate(); turn++) await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(predicate(), true, "bounded input cleanup checkpoint not reached");
}

test("normal Shell completion joins return despite an outstanding input read", async () => {
  const { shell, commands } = setup();
  const reading = deferred();
  const pending = deferred<IteratorResult<Uint8Array>>();
  const release = deferred();
  let returned = 0;
  let settled = false;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { reading.resolve(); return pending.promise; },
    async return() { returned++; await release.promise; return { done: true, value: undefined }; },
  }; } };
  commands.register({ name: "peek", async execute(context) {
    void context.stdin[Symbol.asyncIterator]().next().catch(() => {});
    await reading.promise;
    return { exitCode: 7 };
  } });
  const running = shell.exec("peek", { stdin });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => returned > 0);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false);
    release.resolve();
    assert.equal((await running).exitCode, 7);
    assert.equal(returned, 1);
    pending.reject(new Error("late abandoned input read"));
    await new Promise<void>(resolve => { setImmediate(resolve); });
  } finally { release.resolve(); pending.resolve({ done: true, value: undefined }); await running.catch(() => {}); await shell.dispose(); }
});

for (const reason of [undefined, null, false, 0, "", NaN]) test(`pending input does not hide a normal return failure: ${String(reason)}`, async () => {
  const { shell, commands } = setup();
  const reading = deferred();
  const pending = deferred<IteratorResult<Uint8Array>>();
  let returns = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { reading.resolve(); return pending.promise; },
    async return() { returns++; throw reason; },
  }; } };
  commands.register({ name: "peek", async execute(context) {
    void context.stdin[Symbol.asyncIterator]().next().catch(() => {});
    await reading.promise;
    return { exitCode: 7 };
  } });
  try {
    await assert.rejects(shell.exec("peek", { stdin }), error => Object.is(error, reason));
    assert.equal(returns, 1);
  } finally { pending.resolve({ done: true, value: undefined }); await shell.dispose(); }
});

for (const reason of [undefined, null, false, 0, "", NaN]) test(`caller cancellation still abandons opaque pending read/return: ${String(reason)}`, async () => {
  const { shell, commands } = setup();
  const controller = new AbortController();
  const reading = deferred();
  const pending = deferred<IteratorResult<Uint8Array>>();
  const returned = deferred<IteratorResult<Uint8Array>>();
  let returns = 0;
  let settled = false;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { reading.resolve(); return pending.promise; },
    return() { returns++; return returned.promise; },
  }; } };
  commands.register({ name: "peek", async execute(context) {
    void context.stdin[Symbol.asyncIterator]().next().catch(() => {});
    await reading.promise;
    return { exitCode: 7 };
  } });
  const running = shell.exec("peek", { stdin, signal: controller.signal });
  void running.then(() => { settled = true; }, () => { settled = true; });
  const observed = assert.rejects(running, error => Object.is(error, controller.signal.reason));
  void observed.catch(() => {});
  try {
    await until(() => returns > 0);
    controller.abort(reason);
    await until(() => settled);
    await observed;
    assert.equal(returns, 1);
    returned.reject(new Error("late opaque return"));
    pending.reject(new Error("late opaque read"));
    await new Promise<void>(resolve => { setImmediate(resolve); });
  } finally {
    controller.abort(reason); returned.resolve({ done: true, value: undefined }); pending.resolve({ done: true, value: undefined });
    await running.catch(() => {}); await observed.catch(() => {}); await shell.dispose();
  }
});

test("disposal interrupts a normal pending-input return without waiting for the generator", async () => {
  const { shell, commands } = setup();
  const reading = deferred();
  const releaseRead = deferred();
  const releaseFinally = deferred();
  let finalized = false;
  const stdin = (async function* () {
    try { reading.resolve(); await releaseRead.promise; yield Uint8Array.of(65); }
    finally { await releaseFinally.promise; finalized = true; }
  })();
  commands.register({ name: "peek", async execute(context) {
    void context.stdin[Symbol.asyncIterator]().next().catch(() => {});
    await reading.promise;
    return { exitCode: 7 };
  } });
  const running = shell.exec("peek", { stdin });
  const observed = assert.rejects(running, /Shell is disposed/u);
  void observed.catch(() => {});
  try {
    await reading.promise;
    await new Promise<void>(resolve => { setImmediate(resolve); });
    await shell.dispose();
    await observed;
    assert.equal(finalized, false);
  } finally {
    releaseRead.resolve(); releaseFinally.resolve(); await running.catch(() => {}); await observed.catch(() => {});
    await stdin.return(); await shell.dispose();
  }
  assert.equal(finalized, true);
});
