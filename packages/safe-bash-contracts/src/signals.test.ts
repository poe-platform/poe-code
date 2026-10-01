import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { addAbortSignalWaiter, removeAbortSignalWaiter } from "./signals.js";

for (const frozen of [false, true]) {
  test(`external waiters drain and resubscribe without mutating signals, frozen=${frozen}`, () => {
    const controller = new AbortController();
    const signal = controller.signal;
    if (frozen) Object.freeze(signal);
    const keys = Reflect.ownKeys(signal);
    const first = () => {};
    const second = { onAbort() {} };
    for (let run = 0; run < 15; run++) {
      addAbortSignalWaiter(signal, first);
      addAbortSignalWaiter(signal, first);
      addAbortSignalWaiter(signal, second);
      assert.equal(getEventListeners(signal, "abort").length, 1);
      removeAbortSignalWaiter(signal, first);
      assert.equal(getEventListeners(signal, "abort").length, 1);
      removeAbortSignalWaiter(signal, second);
      assert.equal(getEventListeners(signal, "abort").length, 0);
    }
    assert.deepEqual(Reflect.ownKeys(signal), keys);
  });
}

test("external abort delivers the exact reason to callbacks and objects and releases its listener", () => {
  const controller = new AbortController();
  const received: unknown[] = [];
  const first = (reason: unknown) => received.push(reason);
  const second = { onAbort: first };
  addAbortSignalWaiter(controller.signal, first);
  addAbortSignalWaiter(controller.signal, second);
  controller.abort(null);
  assert.deepEqual(received, [null, null]);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  removeAbortSignalWaiter(controller.signal, first);
  removeAbortSignalWaiter(controller.signal, second);
});
