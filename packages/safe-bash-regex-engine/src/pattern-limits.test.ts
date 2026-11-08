import assert from "node:assert/strict";
import { test } from "node:test";
import { Pattern } from "./text/regex.js";
import { Budget } from "./text/budget.js";
import type { CommandContext } from "safe-bash-contracts";

test("expanded regex programs above the old ceiling are unlimited by default", async () => {
  const pattern = new Pattern("^a{16384}$");
  const budget = new Budget({ signal: new AbortController().signal } as CommandContext, {});
  await pattern.prepare(budget);
  assert.equal((await pattern.find("a".repeat(16384), budget))?.end, 16384);
});

test("explicit regex instruction limits reject expansion before compilation", async () => {
  const pattern = new Pattern("a{12}");
  const budget = new Budget({ signal: new AbortController().signal } as CommandContext, { maxPatternInstructions: 12 });
  await assert.rejects(pattern.prepare(budget), /regular expression program limit exceeded/u);
});

test("explicit regex instruction limits include small eagerly compiled patterns", async () => {
  const pattern = new Pattern("a");
  const budget = new Budget({ signal: new AbortController().signal } as CommandContext, { maxPatternInstructions: 1 });
  await assert.rejects(pattern.prepare(budget), /regular expression program limit exceeded/u);
});

for (const dialect of ["sed", "awk", "jq", "rust"] as const) test(`${dialect} matching cannot bypass a finite instruction limit`, async () => {
  const pattern = new Pattern("a", true, false, dialect);
  const budget = new Budget({ signal: new AbortController().signal } as CommandContext, { maxPatternInstructions: 1 });
  await assert.rejects(pattern.find("a", budget), /regular expression program limit exceeded/u);
  assert.throws(() => pattern.tryFindSync("a", budget), /regular expression program limit exceeded/u);
  assert.throws(() => pattern.tryTestSync("a", budget), /regular expression program limit exceeded/u);
  assert.throws(() => pattern.findSyncFastInto("a", budget, 0, new Int32Array(2)), /regular expression program limit exceeded/u);
});

test("a reused pattern enforces each caller's instruction limit", async () => {
  const pattern = new Pattern("^a{65}$");
  const context = { signal: new AbortController().signal } as CommandContext;
  await pattern.prepare(new Budget(context, {}));
  await assert.rejects(pattern.find("a".repeat(65), new Budget(context, { maxPatternInstructions: 64 })), /regular expression program limit exceeded/u);
});

test("callers can bound parsing before eager instruction emission", () => {
  assert.throws(() => new Pattern("a", true, false, "sed", "", { maxPatternInstructions: 1 }), /regular expression program limit exceeded/u);
  assert.doesNotThrow(() => new Pattern("a{16384}", true, false, "sed", "", { maxPatternInstructions: Infinity }));
  for (const maxPatternInstructions of [NaN, -Infinity, -1, 0, 0.5]) {
    assert.throws(() => new Pattern("a", true, false, "sed", "", { maxPatternInstructions }), /limits must be positive/u);
  }
});

test('regex source and group nesting are unlimited by default', () => {
  assert.doesNotThrow(() => new Pattern('a'.repeat(8193)));
  assert.doesNotThrow(() => new Pattern('('.repeat(65) + 'a' + ')'.repeat(65)));
});

test('regex source and group nesting accept explicit host limits', () => {
  assert.throws(() => new Pattern('abc', true, false, 'sed', '', { maxPatternSource: 2 }), /source limit/u);
  assert.throws(() => new Pattern('((a))', true, false, 'sed', '', { maxPatternDepth: 1 }), /depth limit/u);
});

test('caller budgets enforce source, depth and instructions on reused patterns', async () => {
  const context = { signal: new AbortController().signal } as CommandContext;
  const nested = new Pattern('((a))');
  await nested.prepare(new Budget(context, {}));
  await assert.rejects(nested.find('a', new Budget(context, { maxPatternDepth: 1 })), /depth limit/u);
  await assert.rejects(nested.find('a', new Budget(context, { maxPatternSource: 2 })), /source limit/u);
  assert.throws(() => new Pattern('a{20000}', true, false, 'sed', '', { maxPatternInstructions: 19000 }), /program limit/u);
});

test('Rust patterns retain nesting depth for each caller budget', async () => {
  const context = { signal: new AbortController().signal } as CommandContext;
  const nested = new Pattern('('.repeat(65) + 'a' + ')'.repeat(65), true, false, 'rust');
  await nested.prepare(new Budget(context, {}));
  await assert.rejects(nested.find('a', new Budget(context, { maxPatternDepth: 64 })), /depth limit/u);
  assert.throws(() => new Pattern('((a))', true, false, 'rust', '', { maxPatternDepth: 1 }), /depth limit/u);
  assert.throws(() => new Pattern('abc', true, false, 'rust', '', { maxPatternSource: 2 }), /source limit/u);
  assert.doesNotThrow(() => new Pattern('a'.repeat(8193), true, false, 'rust'));
});
