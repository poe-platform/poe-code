import assert from "node:assert/strict";
import { test } from "node:test";
import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { matchEre } from "./ere/matcher.js";

// The selected Darwin Bash 3.2 profile clears captures skipped in the last
// parent repetition. Linux/glibc retains them. Native strings are recorded in
// safe-bash/tests/compatibility/bash-ere-native-preflight-review-20260829/
// actual-audit-v1/REPORT.md; null versus empty spans is the engine's model.
for (const [pattern, subject, values, spans] of [
  ["(a(b)?)+", "aba", ["aba", "a", ""], [[0, 3], [2, 3], null]],
  ["(a(b)?)+", "ab", ["ab", "ab", "b"], [[0, 2], [0, 2], [1, 2]]],
  ["(a(b)?)+", "a", ["a", "a", ""], [[0, 1], [0, 1], null]],
  ["(a(b?))+", "aba", ["aba", "a", ""], [[0, 3], [2, 3], [3, 3]]],
  ["(a(b)?){2}", "aba", ["aba", "a", ""], [[0, 3], [2, 3], null]],
  ["((a)|(b))+", "ab", ["ab", "b", "", "b"], [[0, 2], [1, 2], null, [1, 2]]],
  ["((a(b)?)c)+", "abcac", ["abcac", "ac", "a", ""], [[0, 5], [3, 5], [3, 4], null]],
  ["(ba(na)*s )*", "bananas bas ", ["bananas bas ", "bas ", ""], [[0, 12], [8, 12], null]],
  ["((a)?b){2}", "abb", ["abb", "b", ""], [[0, 3], [2, 3], null]],
  ["(x)((a)?b)+", "xabb", ["xabb", "x", "b", ""], [[0, 4], [0, 1], [3, 4], null]],
  ["(a(b)?)+c", "abXac", ["ac", "a", ""], [[3, 5], [3, 4], null]],
  ["((a(b)?)+c|aba)", "aba", ["aba", "aba", "", ""], [[0, 3], [0, 3], null, null]],
] as const) {
  test(`ERE repeated captures: ${pattern} on ${JSON.stringify(subject)}`, async () => {
    const ledger = new EreLedger({ maxExpansionBytes: 1024, maxExpansionFields: 16 });
    const program = await compileEre(pattern, ledger);
    const result = await matchEre(program, subject, ledger);
    assert.equal(result.matched, true);
    assert.deepEqual(result.values, values);
    assert.deepEqual(result.captures.map(span => span && [span.start, span.end]), spans);
    assert.equal(ledger.usage.captureSlots, values.length);
    assert.equal(ledger.usage.captureBytes, values.reduce((bytes, value) => bytes + value.length, 0));
  });
}

test("ERE captures do not leak into another match", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: 1024, maxExpansionFields: 16 });
  const program = await compileEre("(a(b)?)+", ledger);
  assert.deepEqual((await matchEre(program, "ab", ledger)).values, ["ab", "ab", "b"]);
  const next = await matchEre(program, "a", ledger);
  assert.deepEqual(next.values, ["a", "a", ""]);
  assert.equal(next.captures[2], null);
  assert.equal((await matchEre(program, "z", ledger)).matched, false);
});

test("ERE capture byte limits account only for the final parent iteration", async () => {
  const ledger = new EreLedger({ maxExpansionBytes: 4, maxExpansionFields: 3 });
  const program = await compileEre("(a(b)?)+", ledger);
  assert.deepEqual((await matchEre(program, "aba", ledger)).values, ["aba", "a", ""]);
  assert.equal(ledger.usage.captureBytes, 4);
});
