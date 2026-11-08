import assert from "node:assert/strict";
import test from "node:test";
import { compareBytes, decodeBase64, decodeLatin1, encodeBase64, encodeLatin1, utf8ByteLength, utf8Decoder, utf8Encoder } from "./bytes.js";

test("portable UTF-8 preserves byte quotas, BOMs and replacement of lone surrogates", () => {
  for (const text of ["", "ASCII", "é🌊", "\ufeffhead", "\ud800", "\udc00", "\ud800x\udc00", "é🌊".repeat(4097)]) {
    const expected = Buffer.from(text);
    assert.equal(utf8ByteLength(text), expected.length);
    assert.deepEqual([...utf8Encoder.encode(text)], [...expected]);
    assert.equal(utf8Decoder.decode(expected), expected.toString("utf8"));
  }
});

test("portable Latin-1 and base64 preserve all byte values and sliced views", () => {
  const storage = Uint8Array.from({ length: 32771 }, (_, index) => index % 256);
  for (const bytes of [storage, storage.subarray(1, 32770), storage.subarray(0, 0)]) {
    const expected = Buffer.from(bytes);
    const latin1 = decodeLatin1(bytes);
    assert.equal(latin1, expected.toString("latin1"));
    assert.deepEqual(encodeLatin1(latin1), bytes);
    const base64 = encodeBase64(bytes);
    assert.equal(base64, expected.toString("base64"));
    assert.deepEqual(decodeBase64(base64), bytes);
  }
});

test("portable byte comparison retains UTF-8 ordering instead of UTF-16 ordering", () => {
  const values = ["", "a", "aa", "é", "\ue000", "🌊", "\ufeff"];
  for (const left of values) for (const right of values) {
    assert.equal(Math.sign(compareBytes(utf8Encoder.encode(left), utf8Encoder.encode(right))), Math.sign(Buffer.compare(Buffer.from(left), Buffer.from(right))));
  }
});
