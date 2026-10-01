import assert from "node:assert/strict";
import { test } from "node:test";
import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { tryMatchEreAsciiRangeSync, warmEreProgram } from "./ere/matcher.js";

test("ERE dot repetition can consume its following newline literal", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
  const program = await compileEre("(.*)\n", ledger);
  await warmEreProgram(program);
  const input = new TextEncoder().encode("abc\n");
  assert.deepEqual(tryMatchEreAsciiRangeSync(program, input, 0, input.length, ledger, undefined, true, false, true), { start: 0, end: 4 });
});

for (const source of ["(a+)+", "(a+)+b", "(a|aa)+b", "([a-z]+_?)+="]) test(`ambiguous ERE ${source} has bounded work`, async () => {
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
  const program = await compileEre(source, ledger);
  await warmEreProgram(program);
  const input = new TextEncoder().encode("a".repeat(40) + "c");
  const start = performance.now();
  const match = tryMatchEreAsciiRangeSync(program, input, 0, input.length, ledger, undefined, false, false, true);
  assert.deepEqual(match, source === "(a+)+" ? { start: 0, end: 40 } : undefined);
  assert.ok(performance.now() - start < 1000, "ambiguous matching must not enumerate exponential paths");
});

for (const source of ["(a|aa)+b", "(ab*)*b", "(a?b){2,4}b", "((a|b)+_?)+=", "(a{1,3}){1,3}b", "(a|ab)*", "(ab*){2,}b"]) {
  test(`span deduplication preserves repeat and alternative semantics: ${source}`, async () => {
    const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
    const program = await compileEre(source, ledger);
    await warmEreProgram(program);
    for (const input of ["", "b", "ab", "aab", "aaab", "aaaab", "aaaaaab", "baab", "ab_a=", "aaac"]) {
      const bytes = new TextEncoder().encode(input);
      const js = new RegExp(source).exec(input);
      assert.deepEqual(tryMatchEreAsciiRangeSync(program, bytes, 0, bytes.length, ledger, undefined, true, false, true),
        js ? { start: js.index, end: js.index + js[0].length } : undefined, input);
      let longest: { start: number; end: number } | undefined;
      const exact = new RegExp(`^(?:${source})$`);
      for (let start = 0; start <= input.length && !longest; start++) {
        for (let end = input.length; end >= start; end--) {
          if (exact.test(input.slice(start, end))) { longest = { start, end }; break; }
        }
      }
      assert.deepEqual(tryMatchEreAsciiRangeSync(program, bytes, 0, bytes.length, ledger, undefined, false, false, true), longest, input);
    }
  });
}

test("synchronous ambiguous span matching observes cancellation during traversal", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
  const program = await compileEre("(a+)+b", ledger);
  await warmEreProgram(program);
  const input = new TextEncoder().encode("a".repeat(40));
  let checks = 0;
  const reason = new Error("cancel traversal");
  const signal = { get aborted() { return ++checks >= 32; }, reason } as AbortSignal;
  assert.throws(() => tryMatchEreAsciiRangeSync(program, input, 0, input.length, ledger, signal, false, false, true), error => error === reason);
});
