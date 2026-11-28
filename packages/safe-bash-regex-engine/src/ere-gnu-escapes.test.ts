import assert from "node:assert/strict";
import { test } from "node:test";
import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { matchEre, prepareUtf8EreSubject, tryMatchEreAsciiRangeSync, warmEreProgram } from "./ere/matcher.js";

for (const [pattern, subject, span] of [
  [String.raw`^\s*$`, " \t\n\r\v\f", [0, 6]],
  [String.raw`^\s+$`, "x", null],
  [String.raw`^\S+$`, "a.b", [0, 3]],
  [String.raw`^\S+$`, "a b", null],
  [String.raw`^\w+$`, "ab_1", [0, 4]],
  [String.raw`^\w+$`, "a-b", null],
  [String.raw`^\W+$`, " .-", [0, 3]],
  [String.raw`^\W+$`, "_", null],
  [String.raw`\bfoo\b`, "a foo b", [2, 5]],
  [String.raw`\bfoo\b`, "_foo_", null],
  [String.raw`\Bfoo\B`, "_foo_", [1, 4]],
  [String.raw`\Bfoo\B`, "foo", null],
  [String.raw`\<foo`, "foo_", [0, 3]],
  [String.raw`\<foo`, "_foo", null],
  [String.raw`foo\>`, "_foo", [1, 4]],
  [String.raw`foo\>`, "foo_", null],
  [String.raw`\b`, "", null],
  [String.raw`\B`, "", [0, 0]],
  [String.raw`\b`, "!a", [1, 1]],
  [String.raw`\B`, "!", [0, 0]],
] as const) {
  test(`GNU ERE ${pattern} on ${JSON.stringify(subject)} across matcher paths`, async () => {
    const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
    const program = await compileEre(pattern, ledger);
    const expected = span ? { start: span[0], end: span[1] } : undefined;
    const result = await matchEre(program, subject, ledger);
    assert.equal(result.matched, !!span);
    assert.deepEqual(result.captures[0], expected);
    await warmEreProgram(program);
    const bytes = new TextEncoder().encode(`x${subject}x`);
    for (const unbounded of [false, true]) {
      assert.deepEqual(tryMatchEreAsciiRangeSync(program, bytes, 1, bytes.length - 1, ledger, undefined, false, false, unbounded), expected);
    }
    const prepare = await prepareUtf8EreSubject(bytes.subarray(1, bytes.length - 1), ledger);
    assert.deepEqual(await prepare(program)(0), expected);
  });
}
