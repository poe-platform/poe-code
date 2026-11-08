import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { wait } from "./commands/archive/internal.js";
for (const failure of [false, true]) test(`host wait releases listeners after settlement: ${failure}`, async () => {
  const signal = new AbortController().signal;
  const reason = new Error("host failed");
  const action = async () => { if (failure) throw reason; return 7; };
  for (let index = 0; index < 3; index++) {
    const pending = wait(signal, action);
    if (failure) await assert.rejects(pending, error => error === reason);
    else assert.equal(await pending, 7);
    assert.equal(getEventListeners(signal, "abort").length, 0);
  }
});
