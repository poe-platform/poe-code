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

test("matching cannot bypass a finite limit with an eagerly compiled pattern", async () => {
  const pattern = new Pattern("a");
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
