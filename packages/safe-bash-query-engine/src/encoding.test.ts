import assert from "node:assert/strict";
import { test } from "node:test";
import { byteString, latin1Bytes, utf8ByteLength, decoder, encoder } from "./encoding.js";

test("UTF-8 accounting matches encoded size, including unpaired surrogates", () => {
  for (const text of ["", "ascii", "éα中文", "🌍", "\ud800", "\udc00", "\ud800a", "\ud800\ud800\udc00", "\ufeffhello"]) {
    assert.equal(utf8ByteLength(text), new TextEncoder().encode(text).length);
  }
  assert.equal(decoder.decode(encoder.encode("\ufeffhello")), "\ufeffhello");
});

test("byte strings preserve every byte and nonzero view offsets", () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  assert.deepEqual(latin1Bytes(byteString(bytes)), bytes);
  assert.deepEqual(latin1Bytes(byteString(bytes.subarray(120, 160))), bytes.subarray(120, 160));
  const large = new Uint8Array(4097).fill(0x80);
  assert.equal(byteString(large), "\x80".repeat(large.length));
});
