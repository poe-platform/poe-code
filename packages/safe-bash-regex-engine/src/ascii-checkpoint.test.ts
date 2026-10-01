import assert from "node:assert/strict";
import { test } from "node:test";
import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { tryMatchEreAsciiRangeSync, warmEreProgram } from "./ere/matcher.js";

for (const pattern of [".*\n", ".+\n"]) {
  test(`ASCII fast path matches newline after ${JSON.stringify(pattern)}`, async () => {
    const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
    const program = await compileEre(pattern, ledger);
    await warmEreProgram(program);
    const bytes = new TextEncoder().encode("abc\ndef");
    assert.deepEqual(tryMatchEreAsciiRangeSync(program, bytes, 0, bytes.length, ledger, undefined, true, false, true), { start: 0, end: 4 });
  });
}

test("ASCII speculative backtracking hands off at the work quantum", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
  const program = await compileEre("a*a*a*a*a*b", ledger);
  await warmEreProgram(program);
  const bytes = new TextEncoder().encode("a".repeat(200));
  assert.equal(tryMatchEreAsciiRangeSync(program, bytes, 0, bytes.length, ledger, undefined, false, false, true), null);
  assert.ok(ledger.usage.work >= 16384 - 64);
});
