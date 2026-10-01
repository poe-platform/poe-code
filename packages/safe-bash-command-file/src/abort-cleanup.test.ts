import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { SharedBudget, settings } from "./shared.js";
import type { CommandContext } from "safe-bash-contracts";
test("file host releases listeners and rejects pre-aborted work", async () => {
  const budget = new SharedBudget({ signal: new AbortController().signal } as CommandContext, settings({}));
  const signal = budget.signal;
  const run = (action: () => Promise<number>) => budget.host(action);
  for (let index = 0; index < 3; index++) {
    assert.equal(await run(async () => 7), 7);
    assert.equal(getEventListeners(signal, "abort").length, 0);
  }
  const reason = new Error("failed");
  await assert.rejects(run(async () => { throw reason; }), error => error === reason);
  assert.equal(getEventListeners(signal, "abort").length, 0);
  budget.dispose();
  const aborted = new SharedBudget({ signal: AbortSignal.abort(reason) } as CommandContext, settings({}));
  let called = false;
  await assert.rejects(aborted.host(async () => { called = true; }), error => error === reason);
  assert.equal(called, false);
  aborted.dispose();
});
