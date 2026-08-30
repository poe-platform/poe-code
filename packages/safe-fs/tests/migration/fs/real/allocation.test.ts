import assert from "node:assert/strict";
import { test } from "vitest";
import { nativeAllocatedBytes } from "../../../../src/fs/real/allocation.js";

const largestBlocks = Math.floor(Number.MAX_SAFE_INTEGER / 512);
const invalidBlocks: unknown[] = [
  undefined, null, "1", 1n, {}, -1, -512, NaN, Infinity, -Infinity,
  0.5, 1.5, Number.MAX_SAFE_INTEGER + 1, largestBlocks + 1, Number.MAX_SAFE_INTEGER,
];

for (const platform of ["darwin", "linux"]) {
  test(`${platform}: validates block count and byte-product boundaries without coercion`, () => {
    for (const blocks of [0, 1, 8, largestBlocks]) {
      assert.equal(nativeAllocatedBytes(blocks, platform), Number(BigInt(blocks) * 512n));
    }
    for (const blocks of invalidBlocks) assert.equal(nativeAllocatedBytes(blocks, platform), undefined);
    const hostile = { valueOf() { throw new Error("must not coerce native metadata"); } };
    assert.equal(nativeAllocatedBytes(hostile, platform), undefined);
  });
}

test("undocumented platforms omit allocation, including otherwise valid reported zero", () => {
  for (const platform of ["win32", "freebsd", "openbsd", "aix", "sunos", "", "unknown"]) {
    for (const blocks of [0, 1, largestBlocks, ...invalidBlocks]) {
      assert.equal(nativeAllocatedBytes(blocks, platform), undefined);
    }
  }
});
