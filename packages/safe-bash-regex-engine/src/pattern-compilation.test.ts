import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { Budget, ProgramError } from "./text/budget.js";
import { Pattern } from "./text/regex.js";

test("large regex programs use the caller's compilation budget", async () => {
  const context = { signal: new AbortController().signal } as CommandContext;
  const pattern = new Pattern("(a|b){4000}", true, false, "jq");
  await assert.rejects(
    pattern.prepare(new Budget(context, { maxSteps: 24_000 })),
    (error) => error instanceof ProgramError && error.message === "execution step limit exceeded"
  );
  const exact = new Budget(context, { maxSteps: 24_001 });
  await pattern.prepare(exact);
  assert.equal(exact.stepsUsed, 24_001);
  const literal = "q".repeat(10_000);
  const matched = await new Pattern(literal).find(literal, new Budget(context, {}));
  assert.deepEqual(matched, { start: 0, end: literal.length, groups: [literal] });
});

test("deep regex groups compile without call-stack or descendant-list growth", async () => {
  const context = { signal: new AbortController().signal } as CommandContext;
  const literal = new Pattern("(?:".repeat(20_000) + "x" + ")".repeat(20_000));
  assert.equal(literal.canFindSync(), true);
  assert.deepEqual(await literal.find("x", new Budget(context, {})), {
    start: 0, end: 1, groups: ["x"]
  });
  const captures = new Pattern("(".repeat(20_000) + "x" + ")".repeat(20_000));
  const exact = new Budget(context, { maxSteps: 40_002 });
  await captures.prepare(exact);
  assert.equal(exact.stepsUsed, 40_002);
  assert.equal(captures.groupCount, 20_000);
});

test("cancelled regex compilation can retry without publishing partial branches", async () => {
  const context = { signal: new AbortController().signal } as CommandContext;
  const pattern = new Pattern("(a|b){3000}", true, false, "jq");
  const reason = { cancelled: true };
  let checkpoints = 0;
  await assert.rejects(pattern.prepare({
    step() {},
    checkpoint() { if (++checkpoints === 3) throw reason; }
  }), (error) => error === reason);
  const exact = new Budget(context, { maxSteps: 18_001 });
  await pattern.prepare(exact);
  assert.equal(exact.stepsUsed, 18_001);
});

test("repeated groups clear only their own nested capture slots", async () => {
  const context = { signal: new AbortController().signal } as CommandContext;
  for (const [source, input] of [
    ["(x)((a)|(b))*", "xab"],
    ["((a)?b)+", "abb"],
    ["((a)|(b(c)?))+", "abcab"],
    ["(x)((a)?b)+", "xabb"]
  ] as const) {
    const expected = new RegExp(source).exec(input);
    const actual = await new Pattern(source, true, false, "jq").find(input, new Budget(context, {}));
    assert.deepEqual(actual?.groups, expected ? [...expected] : undefined, source);
  }
});

test("a rejected small compilation still charges the next caller's quota", async () => {
  const context = { signal: new AbortController().signal } as CommandContext;
  const pattern = new Pattern("ab");
  for (let attempt = 0; attempt < 2; attempt++)
    await assert.rejects(pattern.prepare(new Budget(context, { maxSteps: 1 })), ProgramError);
  const exact = new Budget(context, { maxSteps: 3 });
  await pattern.prepare(exact);
  assert.equal(exact.stepsUsed, 3);
});
