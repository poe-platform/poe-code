import assert from "node:assert/strict";
import test from "node:test";
import { resolveLimits } from "../../src/shell/runtime.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { evaluateArithmetic, prepareArithmetic } from "../../src/shell/arithmetic.js";
import { createJobState } from "../../src/shell/extensions/jobs/state.js";
import { setup } from "./helpers.js";

test("omitted quotas remain unlimited when one quota is supplied", () => {
  for (const [key, value] of Object.entries(resolveLimits())) {
    if (key === "pipeHighWaterMark") continue;
    assert.equal(value, Infinity, key);
    const limits = resolveLimits({ [key]: 1 });
    for (const [other, cap] of Object.entries(limits)) {
      if (other !== key && other !== "pipeHighWaterMark") assert.equal(cap, Infinity, other);
    }
  }
});

test("unconfigured parsing and arithmetic exceed previous quotas", () => {
  new ParseBudget().admit(262_145);
  const source = Array(10_001).fill("1").join("+");
  assert.equal(evaluateArithmetic(prepareArithmetic(source), {}), 10_001n);
  assert.throws(() => new ParseBudget(1).admit(2));
});

test("pipelines exceed previous default even with an unrelated explicit limit", async t => {
  const { shell } = setup({ limits: { maxOutputBytes: 1 } });
  t.after(() => shell.dispose());
  assert.equal((await shell.exec(Array(65).fill(":").join(" | "))).exitCode, 0);
  await assert.rejects(shell.exec(": | :", { limits: { maxPipelineStages: 1 } }));
});

test("jobs exceed previous default and explicit caps may exceed previous ceilings", async t => {
  for (const options of [{}, { maxJobs: 257, maxWaiters: 65, maxCleanupsPerJob: 65 }]) {
    const state = createJobState(options);
    t.after(() => state.close());
    for (let i = 0; i < 257; i++) await state.start(() => ({ run: () => 0 }));
  }
  const capped = createJobState({ maxJobs: 1 });
  t.after(() => capped.close());
  await capped.start(() => ({ run: () => 0 }));
  await assert.rejects(capped.start(() => ({ run: () => 0 })));
});

test("unlimited execution arms no deadline and preserves cancellation", async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const timers = t.mock.method(globalThis, "setTimeout");
  assert.equal((await shell.exec(":" )).exitCode, 0);
  assert.equal(timers.mock.callCount(), 0);
  timers.mock.restore();
  const reason = new Error("cancelled by caller");
  await assert.rejects(shell.exec(":", { signal: AbortSignal.abort(reason) }), error => error === reason);
});

test("waiters and cleanup callbacks exceed old defaults independently", async t => {
  for (const options of [{ maxJobs: 1 }, { maxWaiters: 65, maxCleanupsPerJob: 65 }]) {
    const state = createJobState(options);
    t.after(() => state.close());
    let finish!: (value: number) => void;
    const pending = new Promise<number>(resolve => { finish = resolve; });
    let cleaned = 0;
    const handle = await state.start(task => {
      for (let i = 0; i < 65; i++) task.registerCleanup(() => { cleaned++; });
      return { run: () => pending };
    });
    const waits = Array.from({ length: 65 }, () => state.wait([{ handle }]));
    finish(0);
    await Promise.all(waits);
    assert.equal(cleaned, 65);
  }
});
