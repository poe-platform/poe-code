import assert from "node:assert/strict";
import { test } from "node:test";
import { bytesFrom, compareBytes, concatBytes, equalBytes, latin1Text, utf8ByteLength } from "./index.js";
test("portable byte operations preserve Unicode and raw bytes", () => { for (const text of ["plain", "é", "😀", "\ud800", "a\udc00b"]) assert.equal(utf8ByteLength(text), new TextEncoder().encode(text).length); const bytes = bytesFrom([0, 128, 255]); const copy = bytesFrom(bytes); bytes[0] = 1; assert.equal(copy[0], 0); assert.equal(latin1Text(copy), "\0\x80ÿ"); assert.ok(equalBytes(concatBytes([copy.subarray(0, 1), copy.subarray(1)]), copy)); assert.equal(compareBytes(copy, bytes), -1); });

test("portable encodings preserve UTF-16 code units", () => { assert.deepEqual([...bytesFrom("A😀", "utf16le")], [65, 0, 61, 216, 0, 222]); assert.deepEqual([...bytesFrom("A😀", "latin1")], [65, 61, 0]); });
