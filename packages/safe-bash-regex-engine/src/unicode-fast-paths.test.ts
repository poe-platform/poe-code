import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { Budget } from "./text/budget.js";
import { Pattern } from "./text/regex.js";

const budget = () => new Budget({ signal: new AbortController().signal } as CommandContext, {});
for (const dialect of ["sed", "awk"] as const) for (const [source, input, expected] of [
  ["[😀]+", "😀😀", "😀😀"],
  ["a😀+b", "a😀😀b", "a😀😀b"],
  ["(a.|z)b", "a😀b", "a😀b"],
  ["a.b", "a😀b", "a😀b"],
  ["a[^x]b", "a😀b", "a😀b"],
  ["a.{2,}b", "a😀b", undefined],
  ["a..+b", "a😀b", undefined],
  ["a[^x]{2,}x", "a😀x", undefined],
  ["a[^x]{2,}x", "a😀😁x", "a😀😁x"],
  ["[^x]{2,}x", "😀x😁😎x", "😁😎x"],
  ["^a.{2,}$", "a😀", undefined],
  ["a.{2,}", "a😀", undefined],
  [".{2,}", "😀", undefined],
  ["[^x]{2,}", "😀x😁😎", "😁😎"],
  ["^(a[^x]+)$", "a😀😁", "a😀😁"],
] as const) {
  test(`Unicode ${dialect} matching: ${source} on ${input}`, async () => {
    const pattern = new Pattern(source, true, false, dialect);
    const match = await pattern.tryFindSync(input, budget());
    assert.equal(match?.groups[0], expected);
    assert.equal((await pattern.find(input, budget()))?.groups[0], expected);
    if (!pattern.canFindSync()) return;
    const offsets = new Int32Array((pattern.groupCount + 1) * 2);
    assert.equal(pattern.findSyncFastInto(input, budget(), 0, offsets), expected !== undefined);
    if (expected !== undefined) assert.equal(input.slice(offsets[0], offsets[1]), expected);
  });
}

test("Unicode captures retain UTF-16 offsets in bounded batch matching", async () => {
  for (const source of ["^a([^x]+)", "^a([^x]+)x"]) {
    const pattern = new Pattern(source);
    await pattern.prepare(budget());
    const input = "😀!a😁😎x!😀";
    const offsets = new Int32Array((pattern.groupCount + 1) * 2);
    assert.equal(pattern.canFindSync(), true);
    assert.equal(pattern.findSyncFastInto(input, budget(), 3, offsets, 9, 3), true);
    assert.deepEqual([...offsets], [3, source.endsWith("x") ? 9 : 8, 4, 8]);
    const match = await pattern.tryFindSync(input.slice(3, 9), budget());
    assert.equal(match?.groups[1], "😁😎");
  }
});
