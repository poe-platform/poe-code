import assert from "node:assert/strict";
import test from "node:test";
import { encodeBytes, decodeBytes, byteLength, concatBytes, compareByteArrays, writeEncodedBytes, indexOfBytes } from "../../src/byte-encoding.js";

test("portable byte operations match Node encodings and ownership", () => {
  const cases = ["", "hello é😀", "\ud800", "abc", "a\0b"];
  for (const encoding of ["utf8", "latin1", "ascii", "utf16le", "hex", "base64", "base64url"] as const) {
    for (const text of cases) {
      assert.deepEqual(Array.from(encodeBytes(text, encoding)), Array.from(Buffer.from(text, encoding)), `${encoding}: ${text}`);
      assert.equal(byteLength(text, encoding), Buffer.byteLength(text, encoding));
    }
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    assert.equal(decodeBytes(bytes, encoding), Buffer.from(bytes).toString(encoding));
  }
  const data = Uint8Array.of(1, 2, 3);
  const copy = encodeBytes(data);
  copy[0] = 9;
  assert.equal(data[0], 1);
  assert.deepEqual(concatBytes([data, copy], 4), Uint8Array.of(1, 2, 3, 9));
  assert.deepEqual(concatBytes([new Uint8Array(), data]), data);
  assert.equal(compareByteArrays(data, copy), -8);
  assert.equal(indexOfBytes(data, Uint8Array.of(2, 3)), 1);
  assert.equal(indexOfBytes(data, Uint8Array.of(2, 3), 2), -1);
  const output = new Uint8Array(3);
  assert.equal(writeEncodedBytes(output, "é😀", 0, "utf8"), 2);
  assert.deepEqual(output, Uint8Array.of(195, 169, 0));
});

test("base64 decoding matches Node UTF-16 low-byte parsing", () => {
  for (const text of ["YŁ==", "Y😀Q=="]) {
    for (const encoding of ["base64", "base64url"] as const) {
      assert.deepEqual(Array.from(encodeBytes(text, encoding)), Array.from(Buffer.from(text, encoding)));
    }
  }
});
