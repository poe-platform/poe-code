import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellLimitError } from "../../src/shell/index.js";
import type { ByteSource } from "../../src/contracts/index.js";
import { ShellInput } from "../../src/shell/input.js";
import { Budget, defaultLimits } from "../../src/shell/runtime.js";
import { setup } from "./helpers.js";

test("signal-only upstream remains pending until the caller cancels", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const controller = new AbortController();
  const reason = new Error("caller cancels no-write producer");
  let consumed!: () => void;
  const consumerFinished = new Promise<void>(resolve => { consumed = resolve; });
  let upstreamAborted = false;
  let settled = false;
  commands.register({ name: "waiting", async execute({ signal }) {
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    upstreamAborted = signal.aborted;
    signal.throwIfAborted();
    return { exitCode: 0 };
  } });
  commands.register({ name: "consumer", execute() { consumed(); return { exitCode: 0 }; } });
  const execution = shell.exec("waiting | consumer", { signal: controller.signal });
  const rejected = assert.rejects(execution, error => error === reason);
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await consumerFinished;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(upstreamAborted, false);
  } finally { controller.abort(reason); }
  await rejected;
  assert.equal(upstreamAborted, true);
  await shell.dispose();
});

for (const limit of [0, 127, 128, 129, 256]) {
  test(`cooperative yielding preserves exact command budget ${limit}`, async () => {
    const { shell, fs, commands } = setup();
    let executed = 0;
    commands.register({ name: "count", execute() { executed++; return { exitCode: 0 }; } });
    try {
      await assert.rejects(shell.exec(`${"count;".repeat(limit)} : >after`, { limits: { maxCommands: limit } }),
        error => error instanceof ShellLimitError && error.limit === "maxCommands");
      assert.equal(executed, limit);
      assert.deepEqual(await fs.readdir("/"), []);
    } finally { await shell.dispose(); }
  });
}

test("cooperative yielding preserves the loop iteration budget", async () => {
  const { shell, commands } = setup();
  let executed = 0;
  commands.register({ name: "count", execute() { executed++; return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec("while true; do count; done", { limits: { maxLoopIterations: 129 } }),
      error => error instanceof ShellLimitError && error.limit === "maxLoopIterations");
    assert.equal(executed, 129);
  } finally { await shell.dispose(); }
});

test("cancelling an active input view preserves its pending byte for the next reader", { timeout: 2000 }, async () => {
  const budget = new Budget(defaultLimits);
  const controller = new AbortController();
  const reason = new Error("cancel active view only");
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  let active = 0;
  let maximum = 0;
  let returned = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() {
      const position = reads++;
      active++;
      maximum = Math.max(maximum, active);
      try {
        if (position === 0) { started(); await gate; }
        return { done: false, value: new Uint8Array([65 + position]) };
      } finally { active--; }
    },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  const owner = new ShellInput(source, budget);
  const cancelled = new ShellInput(owner, budget, controller.signal);
  const first = cancelled.next();
  const rejection = assert.rejects(first, error => error === reason);
  await entered;
  controller.abort(reason);
  await rejection;
  await cancelled.close();
  assert.equal(returned, 0);
  const retained = owner.next();
  release();
  assert.deepEqual((await retained).value, new Uint8Array([65]));
  assert.deepEqual((await owner.next()).value, new Uint8Array([66]));
  assert.equal(reads, 2);
  assert.equal(maximum, 1);
  await owner.close();
  assert.equal(returned, 1);
});

for (const retain of [false, true]) {
  test(`cancelled active input late rejection stays observed, retained=${retain}`, { timeout: 2000 }, async () => {
    const budget = new Budget(defaultLimits);
    const controller = new AbortController();
    const reason = new Error("cancel active view only");
    const sourceError = new Error("late source rejection");
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let rejectRead!: (error: Error) => void;
    let reads = 0;
    let returned = 0;
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      next() { reads++; entered(); return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => { rejectRead = reject; }); },
      async return() { returned++; return { done: true, value: undefined }; },
    }; } };
    const owner = new ShellInput(source, budget);
    const cancelled = new ShellInput(owner, budget, controller.signal);
    const rejected = assert.rejects(cancelled.next(), error => error === reason);
    await started;
    controller.abort(reason);
    await rejected;
    await cancelled.close();
    if (retain) {
      const retained = assert.rejects(owner.next(), error => error === sourceError);
      rejectRead(sourceError);
      await retained;
    } else {
      await owner.close();
      rejectRead(sourceError);
    }
    await new Promise<void>(resolve => setImmediate(resolve));
    await owner.close();
    assert.equal(reads, 1);
    assert.equal(returned, 1);
  });
}
