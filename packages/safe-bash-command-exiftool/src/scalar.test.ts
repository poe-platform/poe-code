import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeJsonScalar, printable } from "./scalar.js";

const controls: readonly [string, string][] = [
  ["true", "true"], ["FALSE", "false"], ["null", '"null"'],
  ["NaN", '"NaN"'], ["Infinity", '"Infinity"'], ["001", '"001"'],
  ["-0", "-0"], ["+1", '"+1"'], ["1.0", "1.0"],
  ["1e309", "1e309"], ["1e999", "1e999"], ["1e1000", '"1e1000"'],
  ["123456789012345", "123456789012345"],
  ["1234567890123456", '"1234567890123456"'],
  ["0.1234567890123456", "0.1234567890123456"],
  ["0.12345678901234567", '"0.12345678901234567"'],
  ["1E-003", "1E-003"], ["01.0", '"01.0"'], ["0x10", '"0x10"'],
  ["a\0b\x01\x7f", '"ab\\u0001\\u007F"'],
];

for (const [value, expected] of controls) {
  test(`pinned JSON spelling ${JSON.stringify(value)}`, () => {
    assert.equal(encodeJsonScalar(value), expected);
    assert.equal(encodeJsonScalar(value, { quoteScalars: true }),
      value === "a\0b\x01\x7f" ? expected : JSON.stringify(value));
  });
}

test("Printable is a distinct presentation path, retaining stored input", () => {
  const stored = "a\0b\x01\x7f\n\t  ";
  assert.equal(printable(stored), "ab....");
  assert.equal(encodeJsonScalar(stored), '"ab\\u0001\\u007F\\n\\t  "');
  assert.equal(stored, "a\0b\x01\x7f\n\t  ");
});

test("JSON quoting escapes quotes, slashes and every control with uppercase hex", () => {
  assert.equal(encodeJsonScalar('"\\\b\f\n\r\t\x1b'),
    '"\\"\\\\\\u0008\\u000C\\n\\r\\t\\u001B"');
});

test("scalar serializer enforces work, decoded and output admission before encoding", () => {
  assert.throws(() => encodeJsonScalar("123", { maxDecodedBytes: 5 }), /decoded/);
  assert.throws(() => encodeJsonScalar("123", { maxWork: 2 }), /work/);
  assert.throws(() => encodeJsonScalar("123", { maxRetainedBytes: 5 }), /retained/);
  assert.throws(() => encodeJsonScalar("\x01", { maxOutputBytes: 7 }), /output/);
  const signal = AbortSignal.abort("cancelled");
  assert.throws(() => encodeJsonScalar("123", { signal }), error => error === "cancelled");
});

test("Printable removes NUL before discarding trailing whitespace", () => {
  assert.equal(printable("a \0"), "a");
  assert.equal(printable("a\t\0 \0"), "a.");
  assert.equal(printable("a\u00a0"), "a\u00a0");
});

test("pinned end anchor admits one final LF in numeric/boolean tokens", () => {
  assert.equal(encodeJsonScalar("123\n"), "123\n");
  assert.equal(encodeJsonScalar("true\n"), "true\n");
  assert.equal(encodeJsonScalar("123\n\n"), '"123\\n\\n"');
  assert.equal(encodeJsonScalar("123\n", { quoteScalars: true }), '"123\\n"');
  assert.equal(encodeJsonScalar("true\n", { quoteScalars: true }), '"true\\n"');
  assert.equal(printable("123\n"), "123.");
});
