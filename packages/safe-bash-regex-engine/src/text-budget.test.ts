import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";

test("text budgets account for elapsed work and newly registered yield hooks", async t => {
  let now = 100;
  // Install before loading Budget so this clock also exercises its default-clock path.
  t.mock.method(performance, "now", () => now);
  const { Budget } = await import("./text/budget.js");
  for (const reset of [false, true]) {
    await t.test(`${reset ? "reset" : "constructor"} retains time before checkpoint 64`, async () => {
      const context = { signal: new AbortController().signal } as CommandContext;
      const budget = new Budget(context, {});
      if (reset) budget.resetForRun(context, {});
      now += 30;
      for (let i = 1; i < 64; i++) assert.equal(budget.checkpointSync(), undefined);
      const pending = budget.checkpointSync();
      assert.ok(pending instanceof Promise, "elapsed work must trigger a yield at the first clock check");
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
