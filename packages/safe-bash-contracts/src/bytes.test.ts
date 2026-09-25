import assert from "node:assert/strict";
import test from "node:test";
import { utf8ByteLength, encodeUtf8, concatBytes } from "./bytes.js";

test("portable UTF-8 counts match Node including unpaired surrogates without allocating", () => {
  for (const value of ["", "ascii", "é界😀", "\ud800", "\udc00", "\ud800x\udc00", "\ud800\ud800\udc00", "\0\ufeff"]) {
    assert.equal(utf8ByteLength(value), Buffer.byteLength(value));
    assert.deepEqual(encodeUtf8(value), Uint8Array.from(Buffer.from(value)));
  }
});
test("byte concatenation owns its admitted storage", () => {
  const first = Uint8Array.of(1), second = Uint8Array.of(2, 3);
  const output = concatBytes([first, second], 3);
  first.fill(0); second.fill(0);
  assert.deepEqual([...output], [1, 2, 3]);
});
