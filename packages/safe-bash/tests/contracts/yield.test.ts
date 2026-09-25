import assert from "node:assert/strict";
import test from "node:test";
import { yieldTurn } from "../../src/contracts/yield.js";
import { addAbortSignalWaiter, createManagedControlController } from "../../src/fs/creation-mask.js";

test("yieldTurn shares a managed signal with an existing cancellation waiter", async () => {
  const controller = createManagedControlController();
  const observed: unknown[] = [];
  addAbortSignalWaiter(controller.signal, reason => observed.push(reason));
  const yielding = yieldTurn(controller.signal);
  controller.abort(false);
  await assert.rejects(yielding, reason => reason === false);
  assert.deepEqual(observed, [false]);
});

test("yieldTurn gives timers an abortable macrotask checkpoint", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("stop")), 0);
  await assert.rejects((async () => {
    while (true) await yieldTurn(controller.signal);
  })(), /stop/);
});
