import assert from "node:assert/strict";
import test from "node:test";
import { drainCooperativeSteps } from "./yield.js";

test("cooperative steps deliver falsey cancellation to the operation and retire its resources", async () => {
  const controller = new AbortController();
  let retired = false;
  function* operation(): Generator<void, string, void> {
    try { for (;;) yield; }
    catch (reason) { assert.equal(reason, false); return "cancelled"; }
    finally { retired = true; }
  }
  const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  Object.defineProperty(globalThis, "setImmediate", { value: undefined, configurable: true });
  const timer = setTimeout(() => controller.abort(false), 0);
  try {
    assert.equal(await drainCooperativeSteps(operation(), controller.signal), "cancelled");
    assert.equal(retired, true);
  } finally {
    clearTimeout(timer);
    if (immediate) Object.defineProperty(globalThis, "setImmediate", immediate);
  }
});
