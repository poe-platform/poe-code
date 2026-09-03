import assert from "node:assert/strict";
import test from "node:test";
import { yieldTurn } from "../../src/contracts/yield.js";

test("yieldTurn gives timers an abortable macrotask checkpoint", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("stop")), 0);
  await assert.rejects((async () => {
    while (true) await yieldTurn(controller.signal);
  })(), /stop/);
});
