import assert from "node:assert/strict";
import { test } from "node:test";
import { Pattern } from "./text/regex.js";
import { Budget, ProgramError } from "./text/budget.js";
import { PublicDiagnostic } from "safe-bash-contracts/public-diagnostic";
import type { CommandContext } from "safe-bash-contracts";

for (const pooled of [false, true]) {
  for (const startedAt of [100.75, 2 ** 31 - 10, 2 ** 31 + 10, 2 ** 32 + 10]) {
    test(`text budget honors elapsed checkpoints with pooled=${pooled}, clock=${startedAt}`, async t => {
      let now = startedAt;
      t.mock.method(performance, "now", () => now);
      const context = { signal: new AbortController().signal } as CommandContext;
      // A third acquisition exercises a previously released pooled budget.
      for (let invocation = 0; invocation < (pooled ? 3 : 1); invocation++) {
        now = startedAt;
        const budget = pooled ? Budget.acquire(context, {}) : new Budget(context, {});
        try {
          now = startedAt + 24.75;
          assert.equal(budget.checkpointSync(), undefined);
          now = startedAt + 25;
          const pending = budget.checkpointSync();
          assert.ok(pending instanceof Promise);
          await pending;
        } finally { Budget.release(budget); }
      }
    });
  }
}

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

test("AWK backspace escapes consume a character while word boundaries stay zero-width", async () => {
  const budget = { step() {}, checkpoint() {}, maxBufferBytes: 4096 };
  const backspace = new Pattern("\\btarget\\b", true, false, "awk");
  assert.equal(await backspace.find("target", budget), undefined);
  const match = await backspace.find("\btarget\b", budget);
  assert.deepEqual([match?.start, match?.end, match?.groups[0]], [0, 8, "\btarget\b"]);

  for (const [dialect, source] of [["awk", "\\ytarget\\y"], ["sed", "\\btarget\\b"]] as const) {
    const boundary = new Pattern(source, true, false, dialect);
    assert.equal(await boundary.find("target_2", budget), undefined);
    const word = await boundary.find("hit target now", budget);
    assert.deepEqual([word?.start, word?.end, word?.groups[0]], [4, 10, "target"]);
  }
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

for (const dialect of ["sed", "awk", "jq"] as const) {
  for (const [source, input, expected] of [
    ["\\bword\\b", "sword word!", "word"],
    ["\\<word\\>", "sword word!", "word"],
    ["\\Bord\\B", "words", "ord"],
    ["\\yword\\y", "sword word!", "word"],
    ["\\Yord\\Y", "words", "ord"],
  ] as const) test(`${dialect} boundaries agree between small and deferred programs: ${source}`, async () => {
    const budget = { step() {}, checkpoint() {}, maxBufferBytes: 65536 };
    for (const expression of [source, `(?:x{70})?${source}`]) {
      const pattern = new Pattern(expression, true, false, dialect);
      assert.equal((await pattern.find(input, budget))?.groups[0], expected);
    }
  });
}

test("small literal construction retains synchronous matching", () => {
  const pattern = new Pattern("needle");
  const result = pattern.tryFindSync("a needle", { step() {}, checkpoint() {}, checkpointSync() { return undefined; }, maxBufferBytes: 65536 });
  assert.ok(!(result instanceof Promise));
  assert.deepEqual(result, { start: 2, end: 8, groups: ["needle"] });
});

test("failed small-program admission remains chargeable on retry", async () => {
  const pattern = new Pattern("needle");
  const reason = new Error("admission cancelled");
  await assert.rejects(pattern.prepare({ step() { throw reason; }, checkpoint() {} }), error => error === reason);
  let charged = 0;
  await pattern.prepare({ step(amount = 1) { charged += amount; }, checkpoint() {} });
  assert.ok(charged > 0);
});

test("cancelled deferred compilation can retry without publishing a partial program", async () => {
  const pattern = new Pattern("(ab|c){40}", true, false, "jq");
  const reason = new Error("compilation cancelled");
  let checkpoints = 0;
  await assert.rejects(pattern.prepare({ step() {}, checkpoint() {
    if (++checkpoints === 3) throw reason;
  } }), error => error === reason);
  let charged = 0;
  const budget = { step(amount = 1) { charged += amount; }, checkpoint() {}, maxBufferBytes: 65536 };
  await pattern.prepare(budget);
  assert.ok(charged > 64);
  assert.equal((await pattern.find("ab".repeat(40), budget))?.groups[0], "ab".repeat(40));
});
