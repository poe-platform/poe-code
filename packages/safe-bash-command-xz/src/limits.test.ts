import assert from "node:assert/strict";
import test from "node:test";
import { createXzCommand, type XzLimits } from "./index.js";

test("xz validates configured limits and accepts unlimited defaults", () => {
  const limits: Partial<XzLimits> = { maxDecodedBytes: 0 };
  assert.doesNotThrow(() => createXzCommand({ limits }));
  assert.doesNotThrow(() => createXzCommand({ limits: { maxDecodedBytes: Infinity } }));
  for (const value of [-1, NaN, 1.5]) {
    assert.throws(() => createXzCommand({ limits: { maxDecodedBytes: value } }), RangeError);
  }
});
