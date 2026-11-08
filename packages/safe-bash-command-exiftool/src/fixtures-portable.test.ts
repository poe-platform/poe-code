import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "node:zlib";
import { fixture } from "../tests/fixtures.js";

test("PNG fixtures preserve bytes and checksums without a Buffer global", () => {
  const expected = fixture("héllo", "世界");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  let actual: Uint8Array;
  try {
    Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true });
    actual = fixture("héllo", "世界");
  } finally {
    Object.defineProperty(globalThis, "Buffer", descriptor);
  }
  assert.deepEqual(actual, expected);
  const view = new DataView(actual.buffer, actual.byteOffset, actual.byteLength);
  for (let offset = 8; offset < actual.length;) {
    const end = offset + 8 + view.getUint32(offset);
    assert.equal(view.getUint32(end), crc32(actual.subarray(offset + 4, end)));
    offset = end + 4;
  }
});
