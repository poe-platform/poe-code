import assert from "node:assert/strict";
import { test } from "node:test";
import { Pattern } from "./text/regex.js";
import { Budget, ProgramError } from "./text/budget.js";
import { PublicDiagnostic } from "safe-bash-contracts/public-diagnostic";
import type { CommandContext } from "safe-bash-contracts";

test("pooled text budgets replace retired callers and preserve limits and cancellation", () => {
  const budgets = new Set<Budget>();
  for (let index = 0; index < 6; index++) {
    const controller = new AbortController();
    const context = { signal: controller.signal } as CommandContext;
    const reason = new Error(`caller ${index}`);
    const budget = Budget.acquire(context, { maxSteps: 1 });
    budgets.add(budget);
    try {
      assert.equal(budget.context, context);
      AbortSignal.prototype.throwIfAborted.call(budget.context.signal);
      budget.step();
      assert.throws(() => budget.step(), ProgramError);
      controller.abort(reason);
      assert.throws(() => budget.checkpointSync(), error => error === reason);
    } finally { Budget.release(budget); }
    assert.notEqual(budget.context, context);
    assert.notEqual(budget.context.signal, controller.signal);
  }
  assert.ok(budgets.size < 6, "released budgets are reused");
});

test("query regex preserves named captures without host regex execution", async () => {
  const pattern = new Pattern("(?<part>a+)", true, false, "jq");
  const match = await pattern.find("baa", { step() {}, async checkpoint() {}, maxBufferBytes: 4096 });
  assert.equal(match?.groups[pattern.groupNames.get("part")!], "aa");
  assert.equal(match?.start, 1);
  await assert.rejects(pattern.find("baa", { step() {}, async checkpoint() {}, maxBufferBytes: 1 }), ProgramError);
});

test("regex errors retain the canonical public diagnostic constructor", () => {
  assert.ok(new ProgramError("bounded") instanceof PublicDiagnostic);
  assert.throws(() => new Pattern("[", true, false, "jq"), ProgramError);
});

test("regex accepts budgets whose checkpoints complete synchronously", async () => {
  let checkpoints = 0;
  const pattern = new Pattern("a+", true, false, "jq");
  const match = await pattern.find("baa", { step() {}, checkpoint() { checkpoints++; }, maxBufferBytes: 4096 });
  assert.equal(match?.start, 1);
  assert.ok(checkpoints > 0);
});

for (const yields of [false, true]) test(`regex supports a cooperatively yielding budget: ${yields}`, async () => {
  const stopped = new Error("cancelled");
  let aborted = false;
  const budget = {
    step() {},
    checkpoint() {
      if (aborted) throw stopped;
      if (yields) return Promise.resolve();
    },
    maxBufferBytes: 4096,
  };
  const pattern = new Pattern("a+", true);
  await pattern.prepare(budget);
  const match = await pattern.tryFindSync("baa", budget);
  assert.deepEqual([match?.start, match?.end, match?.groups[0]], [1, 3, "aa"]);
  aborted = true;
  await assert.rejects(pattern.find("baa", budget), error => error === stopped);
});
