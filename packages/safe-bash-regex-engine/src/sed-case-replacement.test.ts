import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { Budget } from "./text/budget.js";
import { Pattern, substitute, trySubstituteSync } from "./text/regex.js";

const cases = [
  ["(hello) (world)", "hello world", "\\U\\1 \\E\\2", "HELLO world"],
  ["(HELLO) (WORLD)", "HELLO WORLD", "\\L\\1 \\E\\2", "hello WORLD"],
  ["(hello) (world)", "hello world", "\\u\\1 \\u\\2", "Hello World"],
  ["(HELLO) (WORLD)", "HELLO WORLD", "\\l\\1 \\l\\2", "hELLO wORLD"],
  ["a", "aa", "\\Uhello\\L WORLD\\E!", "HELLO world!HELLO world!"],
  ["(a*)b", "b ab", "\\u\\1x", "X Ax"],
  ["(a*)b", "b ab", "\\u\\1\\Ex", "x Ax"],
  ["a", "aa", "\\u&z", "AzAz"],
  ["a", "a", "\\L\\uHELLO", "Hello"],
  ["a", "a", "\\\\U", "\\U"],
  ["a", "a", "\\u🦊abc", "🦊abc"],
  ["a", "a", "\\Ué", "É"],
] as const;
for (const run of [substitute, trySubstituteSync]) {
  for (const [source, input, replacement, expected] of cases) test(`${run.name}: ${replacement} on ${input}`, async () => {
    const budget = new Budget({ signal: new AbortController().signal } as CommandContext, {});
    const pattern = new Pattern(source, true, false, "sed");
    await pattern.prepare(budget);
    assert.equal((await run(input, pattern, replacement, budget, true)).text, expected);
  });
}

for (const run of [substitute, trySubstituteSync]) test(`${run.name}: conversion respects output and work limits`, async () => {
  const context = { signal: new AbortController().signal } as CommandContext;
  const pattern = new Pattern("a", true, false, "sed");
  const budget = new Budget(context, { maxBufferBytes: 3 });
  await pattern.prepare(budget);
  assert.equal((await run("a", pattern, "\\Uabc", budget, false)).text, "ABC");
  await assert.rejects(async () => run("a", pattern, "\\Uabcd", new Budget(context, { maxBufferBytes: 3 }), false), /buffer limit/);
  await assert.rejects(async () => run("a", pattern, "\\U".repeat(1000), new Budget(context, { maxSteps: 100 }), false), /step limit/);
  const controller = new AbortController();
  controller.abort(new Error("cancel conversion"));
  await assert.rejects(async () => run("a", pattern, "\\U&", new Budget({ signal: controller.signal } as CommandContext, {}), false), /cancel conversion/);
});
