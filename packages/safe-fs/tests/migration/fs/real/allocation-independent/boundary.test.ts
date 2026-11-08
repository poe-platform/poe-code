import assert from "node:assert/strict";
import { test } from "vitest";
import { nativeAllocatedBytes } from "../../../../../src/fs/real/allocation.js";

const lastRepresentable = Number(BigInt(Number.MAX_SAFE_INTEGER) / 512n);
const invalid: readonly unknown[] = [undefined, null, false, true, "1", 1n, {}, [],
  -1, -0.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
  lastRepresentable + 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1];

for (const platform of ["darwin", "linux"]) {
  test(`independent ${platform} conversion uses exact integer byte arithmetic`, () => {
    for (const blocks of [0, 1, 7, 8, 127, lastRepresentable - 1, lastRepresentable]) {
      assert.equal(nativeAllocatedBytes(blocks, platform), Number(BigInt(blocks) * 512n));
    }
    assert.ok(nativeAllocatedBytes(-0, platform) === 0);
    for (const blocks of invalid) assert.equal(nativeAllocatedBytes(blocks, platform), undefined);
  });
}

test("independent unsupported platforms never acquire allocation", () => {
  for (const platform of ["win32", "freebsd", "openbsd", "netbsd", "aix", "sunos", "Darwin", "", "unknown"]) {
    for (const blocks of [0, 1, lastRepresentable, ...invalid]) {
      assert.equal(nativeAllocatedBytes(blocks, platform), undefined);
    }
  }
});
