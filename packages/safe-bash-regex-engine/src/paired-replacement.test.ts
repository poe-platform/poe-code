import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { Budget } from "./text/budget.js";
import { Pattern, trySubstitutePairSync, trySubstitutePairToBufferSync, trySubstitutePairBatchToBufferSync } from "./text/regex.js";

const cases = [
  ["^foo", "qux", "baz", "&-&", "foo baz", "qux baz-baz"],
  ["^f(o+)", "\\1-\\1", "baz", "qux", "foo baz", "oo-oo qux"],
  ["^foo", "qux", "b(a)(z)", "\\2", "foo baz", "qux z"],
  ["^f(o+)", "[&]\\1", "b(a)(z)", "\\2-\\1", "foo baz", "[foo]oo z-a"],
  ["^f([0-9]+)", "\\1-\\1", "baz", "(&)&", "f12 baz", "12-12 (baz)baz"],
  ...Array.from({ length: 8 }, (_, i) => ["^f(o)(o)", "\\2", "b(a)(b)(c)(d)(e)(f)(g)(h)(i)", `\\${i + 2}`, "foo babcdefghi", `o ${"bcdefghi"[i]}`]),
];
test("paired batches honor changed record boundaries on a reused array", async () => {
  const budget = new Budget({ signal: new AbortController().signal } as CommandContext, {});
  const pat1 = new Pattern("^foo", true, false, "sed");
  const pat2 = new Pattern("baz", true, false, "sed");
  await pat1.prepare(budget);
  await pat2.prepare(budget);
  const text = "foo baz\nfoo baz\n";
  const ends = new Int32Array([7, 15]);
  const output = new Uint8Array(4096);
  const run = () => {
    const length = trySubstitutePairBatchToBufferSync(text, ends, 2, pat1, "qux", false, 1, pat2, "zip", false, 1, budget, output, 10, output.length);
    assert.ok(length >= 0);
    return new TextDecoder().decode(output.subarray(0, length));
  };
  assert.equal(run(), "qux zip\nqux zip\n");
  ends[0] = 3;
  assert.equal(run(), "qux\nzip\nfoo baz\n");
});
for (const [source1, rep1, source2, rep2, input, expected] of cases) {
  for (const mode of ["string", "buffer", "batch"] as const) test(`paired ${mode}: ${source1}/${rep1}; ${source2}/${rep2}`, async () => {
    const budget = new Budget({ signal: new AbortController().signal } as CommandContext, {});
    const pat1 = new Pattern(source1!, true, false, "sed");
    const pat2 = new Pattern(source2!, true, false, "sed");
    await pat1.prepare(budget);
    await pat2.prepare(budget);
    if (mode === "string") {
      const result = await trySubstitutePairSync(input!, pat1, rep1!, false, 1, pat2, rep2!, false, 1, budget);
      assert.equal(result?.text, expected);
    } else {
      const output = new Uint8Array(4096);
      const length = mode === "buffer"
        ? await trySubstitutePairToBufferSync(input!, pat1, rep1!, false, 1, pat2, rep2!, false, 1, budget, output, 0, 10)
        : trySubstitutePairBatchToBufferSync(`${input}\n${input}\n`, new Int32Array([input!.length, input!.length * 2 + 1]), 2, pat1, rep1!, false, 1, pat2, rep2!, false, 1, budget, output, 10, output.length);
      assert.ok(length >= 0, `unexpected fallback ${length}`);
      assert.equal(new TextDecoder().decode(output.subarray(0, length)), `${expected}\n`.repeat(mode === "batch" ? 2 : 1));
    }
  });
}
