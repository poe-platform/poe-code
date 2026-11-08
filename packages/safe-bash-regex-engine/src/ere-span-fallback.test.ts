import assert from "node:assert/strict";
import { test } from "node:test";
import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { createEreSpanMatcher, matchEre } from "./ere/matcher.js";

for (const materialize of [false, true]) test(`group-free ERE fallback deduplicates repeated quantifiers (captures=${materialize})`, async () => {
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity }, { work: 1000000 });
  const program = await compileEre("a*a*a*a*a*a*b", ledger);
  const subject = "a".repeat(40);
  if (materialize) assert.equal((await matchEre(program, subject, ledger)).matched, false);
  else assert.equal(await (await createEreSpanMatcher(program, subject, ledger))(0), undefined);
  assert.ok(ledger.usage.work < 1000000);
});

for (const source of ["a*a*b", "a{1,3}a{2,4}b", "a*|b*", "a?b?b"]) test(`deduplicated fallback preserves leftmost-longest spans: ${source}`, async () => {
  const exact = new RegExp(`^(?:${source})$`);
  for (const subject of ["", "b", "ab", "aaaab", "aaaaaab", "baab", "aaac"]) {
    const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
    const program = await compileEre(source, ledger);
    let expected: { start: number; end: number } | undefined;
    for (let start = 0; start <= subject.length && !expected; start++) {
      for (let end = subject.length; end >= start; end--) {
        if (exact.test(subject.slice(start, end))) { expected = { start, end }; break; }
      }
    }
    assert.deepEqual(await (await createEreSpanMatcher(program, subject, ledger))(0), expected, subject);
  }
});

test("group-free fallback observes cancellation during traversal", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
  const program = await compileEre("a*a*a*a*a*a*b", ledger);
  const reason = new Error("cancel fallback");
  let checks = 0;
  const signal = { get aborted() { return ++checks > 1000; }, reason } as AbortSignal;
  await assert.rejects(matchEre(program, "a".repeat(40), ledger, signal), error => error === reason);
});
