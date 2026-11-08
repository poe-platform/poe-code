import assert from "node:assert/strict";
import test from "node:test";
import { hasRegisteredYieldCheckpoint, hasYieldCheckpoint, inheritYieldCheckpoint, registerInternalYieldCheckpoint, registerYieldCheckpoint, runYieldCheckpoint, yieldTurn } from "./yield.js";

for (const frozen of [false, true]) {
  for (const external of [false, true]) {
    test(`reused signal replaces internal checkpoint (frozen=${frozen}, external=${external})`, async () => {
      const signal = new AbortController().signal;
      if (frozen) Object.freeze(signal);
      const calls: string[] = [];
      if (external) registerYieldCheckpoint(signal, () => { calls.push("external"); });
      for (let i = 0; i < 100; i++) {
        registerInternalYieldCheckpoint(signal, () => { calls.push(`internal${i}`); });
      }
      const child = new AbortController().signal;
      if (frozen) Object.freeze(child);
      inheritYieldCheckpoint(signal, child);
      registerInternalYieldCheckpoint(child, () => { calls.push("child"); });
      assert.equal(hasRegisteredYieldCheckpoint(child), true);
      assert.equal(hasYieldCheckpoint(child), external);
      runYieldCheckpoint(signal);
      await yieldTurn(child);
      assert.deepEqual(calls, external ? ["internal99", "external", "child", "external"] : ["internal99", "child"]);
    });
  }
  test(`external replacement preserves internal checkpoint (frozen=${frozen})`, () => {
    const signal = new AbortController().signal;
    const calls: string[] = [];
    registerYieldCheckpoint(signal, () => { calls.push("old external"); });
    registerInternalYieldCheckpoint(signal, () => { calls.push("internal"); });
    if (frozen) Object.freeze(signal);
    registerYieldCheckpoint(signal, () => { calls.push("external"); });
    runYieldCheckpoint(signal);
    assert.deepEqual(calls, ["internal", "external"]);
  });
}
