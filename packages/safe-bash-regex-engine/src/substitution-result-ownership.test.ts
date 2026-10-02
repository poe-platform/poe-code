import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { Budget } from "./text/budget.js";
import { Pattern, trySubstituteSync, trySubstitutePairSync } from "./text/regex.js";

test("synchronous substitutions preserve results across later calls", async () => {
  const budget = new Budget({ signal: new AbortController().signal } as CommandContext, {});
  const pattern = new Pattern("foo", true, false, "sed");
  await pattern.prepare(budget);
  const first = await trySubstituteSync("foo foo", pattern, "bar", budget, true, 1);
  assert.deepEqual(first, { text: "bar bar", count: 2 });
  const second = await trySubstituteSync("unchanged", pattern, "bar", budget, true, 1);
  assert.deepEqual(second, { text: "unchanged", count: 0 });
  assert.deepEqual(first, { text: "bar bar", count: 2 });
  assert.notStrictEqual(first, second);
});

for (const [input, expected, substituted] of [
  ["foo baz", "qux zip", true],
  ["foo alone", "qux alone", true],
  ["unchanged", "unchanged", false],
] as const) {
  test(`paired substitutions own their result for ${input}`, async () => {
    const budget = new Budget({ signal: new AbortController().signal } as CommandContext, {});
    const firstPattern = new Pattern("^foo", true, false, "sed");
    const secondPattern = new Pattern("baz", true, false, "sed");
    await firstPattern.prepare(budget);
    await secondPattern.prepare(budget);
    const run = (text: string) => trySubstitutePairSync(text, firstPattern, "qux", false, 1, secondPattern, "zip", false, 1, budget);
    const first = await run(input);
    assert.deepEqual(first, { text: expected, substituted });
    const second = await run("foo baz later");
    assert.deepEqual(second, { text: "qux zip later", substituted: true });
    assert.deepEqual(first, { text: expected, substituted });
    assert.notStrictEqual(first, second);
  });
}
