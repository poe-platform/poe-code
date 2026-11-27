import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { Budget } from "./text/budget.js";
import { Pattern, substitute, trySubstituteSync } from "./text/regex.js";

for (const run of [substitute, trySubstituteSync]) {
  for (const [replacement, expected] of [
    [String.raw`\\`, String.raw`\\`],
    [String.raw`\\x`, String.raw`\\x`],
    [String.raw`\&`, "&"],
    [String.raw`\\&`, "\\ "],
    [String.raw`\\\&`, "\\&"],
    [String.raw`\x`, String.raw`\x`],
    ["\\".repeat(3), "\\".repeat(3)],
    ["\\".repeat(4), "\\".repeat(2)],
    ["\\".repeat(4) + "&", "\\\\ "],
  ] as const) {
    test(`${run.name}: awk replacement ${JSON.stringify(replacement)}`, async () => {
      const context = { signal: new AbortController().signal } as CommandContext;
      const pattern = new Pattern(" ", true, false, "awk");
      const budget = new Budget(context, {});
      await pattern.prepare(budget);
      assert.deepEqual(await run("a b", pattern, replacement, budget, true, 1, "awk"), {
        text: `a${expected}b`, count: 1,
      });
    });
  }
  test(`${run.name}: preserved awk backslashes count toward the output limit`, async () => {
    const context = { signal: new AbortController().signal } as CommandContext;
    const pattern = new Pattern(" ", true, false, "awk");
    const budget = new Budget(context, { maxBufferBytes: 3 });
    await pattern.prepare(budget);
    await assert.rejects(async () => run("a b", pattern, String.raw`\\`, budget, true, 1, "awk"), /buffer limit/);
  });
}
