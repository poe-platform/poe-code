import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { Budget, JqLimitError, resolveJqLimits } from "./limits.js";

test("a reset window includes real elapsed time before its first check", async () => {
  const signal = new AbortController().signal;
  const budget = new Budget(resolveJqLimits(), signal);
  budget.resetForRun(signal);
  await delay(35);
  const pending = budget.ensureFreshWindow();
  assert.ok(pending instanceof Promise);
  await pending;
  assert.equal(budget.currentSteps, 0);
});

test("late checkpoint binding includes real time elapsed since reset", async () => {
  const signal = new AbortController().signal;
  const budget = new Budget(resolveJqLimits(), signal);
  budget.resetForRun(signal);
  await delay(35);
  let checkpoints = 0;
  registerYieldCheckpoint(signal, () => { checkpoints++; });
  assert.equal(budget.needsYield(), true);
  const pending = budget.tickSync(0);
  assert.ok(pending instanceof Promise);
  await pending;
  assert.equal(checkpoints, 1);
  assert.equal(budget.currentSteps, 0);
});

for (const start of [0, 2 ** 32 + 100]) test(`untracked yield admission preserves the clock window at ${start}`, context => {
  let now = start;
  context.mock.method(performance, "now", () => now);
  const budget = new Budget(resolveJqLimits(), new AbortController().signal);
  budget.step(65536);
  now += 19;
  assert.equal(budget.needsYield(), false);
  budget.step(65536);
  now++;
  assert.equal(budget.needsYield(), true);
});

for (const start of [2 ** 31 - 10, 2 ** 31 + 100, 2 ** 32 + 100]) {
  for (const reset of [false, true]) {
    test(`fresh-window deadline retains the full clock at ${start}, reset=${reset}`, async context => {
      let now = reset ? start - 100 : start;
      context.mock.method(performance, "now", () => now);
      const signal = new AbortController().signal;
      const budget = new Budget(resolveJqLimits(), signal);
      if (reset) {
        now = start;
        budget.resetForRun(signal);
      }
      now += 14;
      assert.equal(budget.ensureFreshWindow(), undefined);
      now++;
      const pending = budget.ensureFreshWindow();
      assert.ok(pending instanceof Promise);
      await pending;
      assert.equal(budget.currentSteps, 0);
      assert.equal(budget.ensureFreshWindow(), undefined);
    });
    test(`elapsed budget yields across clock ${start}, reset=${reset}`, async context => {
      let now = reset ? start - 100 : start;
      context.mock.method(performance, "now", () => now);
      const controller = new AbortController();
      const budget = new Budget(resolveJqLimits(), controller.signal);
      if (reset) {
        budget.step(7);
        now = start;
        budget.resetForRun(controller.signal);
      }
      assert.equal(budget.tickSync(), undefined);
      now += 24;
      // Registration may occur after construction/reset and elapsed work.
      let checkpoints = 0;
      registerYieldCheckpoint(controller.signal, () => { checkpoints++; });
      assert.equal(budget.tickSync(), undefined);
      assert.equal(checkpoints, 0);
      now++;
      assert.equal(budget.needsYield(), true);
      const pending = budget.tickSync(0);
      assert.ok(pending instanceof Promise);
      await pending;
      assert.equal(checkpoints, 1);
      assert.equal(budget.currentSteps, 2);
      assert.equal(budget.tickSync(0), undefined);
    });
  }
}

for (const tracked of [false, true]) test(`constant-clock work yields a real host turn, tracked=${tracked}`, async context => {
  context.mock.method(performance, "now", () => 0);
  const signal = new AbortController().signal;
  const budget = new Budget(resolveJqLimits(), signal);
  if (tracked) registerYieldCheckpoint(signal, () => {});
  const cadence = tracked ? 1024 : 65536;
  for (let index = 0; index < cadence - 1; index++) assert.equal(budget.tickSync(), undefined);
  let hostTurn = false;
  const host = setImmediate(() => { hostTurn = true; });
  context.after(() => clearImmediate(host));
  const pending = budget.tickSync();
  assert.ok(pending instanceof Promise);
  assert.equal(hostTurn, false);
  await pending;
  assert.equal(hostTurn, true);
  assert.equal(budget.currentSteps, cadence);
  // Completing a host turn starts a fresh work interval.
  assert.equal(budget.tickSync(cadence - 1), undefined);
  await budget.tickSync();
  assert.equal(budget.currentSteps, cadence * 2);
});

for (const reason of [false, null]) {
  test(`late checkpoint registration preserves ${reason} without charging admitted work`, async context => {
    let now = 2 ** 31 + 100;
    context.mock.method(performance, "now", () => now);
    const controller = new AbortController();
    const budget = new Budget(resolveJqLimits({ maxSteps: 1 }), controller.signal);
    budget.step();
    registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
    now += 25;
    await assert.rejects(async () => { await budget.tickSync(0); }, error => error === reason);
    assert.equal(budget.currentSteps, 1);
  });
}

test("synchronous budget admission rejects exactly the first excess step", () => {
  const budget = new Budget(resolveJqLimits({ maxSteps: 1 }), new AbortController().signal);
  assert.equal(budget.tickSync(), undefined);
  assert.equal(budget.tickSync(0), undefined);
  assert.throws(() => budget.tickSync(), JqLimitError);
});
