import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";

test("text budgets account for elapsed work and newly registered yield hooks", async t => {
  let now = 100;
  // A shared test runner may have loaded Budget before this clock is installed.
  t.mock.method(performance, "now", () => now);
  const { Budget } = await import("./text/budget.js");
  for (const reset of [false, true]) {
    await t.test(`${reset ? "reset" : "constructor"} retains elapsed work through checkpoint 64`, async () => {
      const context = { signal: new AbortController().signal } as CommandContext;
      const budget = new Budget(context, {});
      if (reset) budget.resetForRun(context, {});
      now += 30;
      let pending: Promise<void> | undefined;
      for (let i = 0; i < 64 && !pending; i++) pending = budget.checkpointSync();
      assert.ok(pending instanceof Promise, "elapsed work must trigger a yield within 64 checkpoints");
      await pending;
    });
    await t.test(`${reset ? "reset" : "constructor"} observes a late yield hook`, async () => {
      const context = { signal: new AbortController().signal } as CommandContext;
      const budget = new Budget(context, {});
      if (reset) budget.resetForRun(context, {});
      let checkpoints = 0;
      registerYieldCheckpoint(context.signal, () => { checkpoints++; });
      now += 30;
      await budget.checkpointSync();
      assert.equal(checkpoints, 1);
    });
  }
});
