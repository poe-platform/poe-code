import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem, toByteSource } from "../../../src/index.js";
import { Budget } from "../../../src/commands/text-programs/shared.js";
import { compare, formatted, numeric, string, text } from "../../../src/commands/text-programs/awk-values.js";

function budget(maxSteps: number, maxBufferBytes = 4096, signal = new AbortController().signal) {
  return new Budget({
    command: "awk", args: [], cwd: "/", env: {}, fs: new MemoryFileSystem(), signal, stdin: toByteSource(""),
    stdout: { async write() { assert.fail("formatter must not write stdout"); } },
    stderr: { async write() { assert.fail("formatter must not write stderr"); } },
  }, { maxSteps, maxBufferBytes });
}

for (const format of ["x".repeat(64), "%%".repeat(32)]) test(`formatter admits ${format[0] === "x" ? "literal" : "escaped-percent"} scanning work`, () => {
  assert.throws(() => formatted(format, [], text, budget(63)), { message: "execution step limit exceeded" });
});

for (const [format, expected, cost] of [["abcd", "abcd", 8], ["%%", "%", 3]] as const) test(`formatter exact scan and append work: ${JSON.stringify(format)}`, () => {
  assert.equal(formatted(format, [], text, budget(cost)), expected);
  assert.throws(() => formatted(format, [], text, budget(cost - 1)), { message: "execution step limit exceeded" });
});

for (const format of ["%64s", "%064d", "%.64d", "%-64s"]) test(`formatter rejects ${format} before oversized padding`, () => {
  const method = format.includes("-") ? "padEnd" : "padStart";
  const original = String.prototype[method];
  let padding = 0;
  String.prototype[method] = function (width, fill) {
    if (width === 64) padding++;
    return original.call(this, width, fill);
  };
  try {
    assert.throws(() => formatted(format, [format.endsWith("s") ? string("x") : numeric(1)], text, budget(1000, 16)), { message: "text buffer limit exceeded" });
    assert.equal(padding, 0);
    assert.equal(formatted(format, [format.endsWith("s") ? string("x") : numeric(1)], text, budget(1000, 64)).length, 64);
    assert.equal(padding, 1, "the observer detects an admitted padding operation");
  } finally { String.prototype[method] = original; }
});

test("formatter charges padding even when its bytes fit the buffer", () => {
  assert.throws(() => formatted("%64s", [string("x")], text, budget(32, 64)), { message: "execution step limit exceeded" });
});

test("formatter admits selected string bytes before slicing", () => {
  const source = "x".repeat(64);
  const original = String.prototype.slice;
  let slices = 0;
  String.prototype.slice = function (start, end) {
    if (String(this) === source) slices++;
    return original.call(this, start, end);
  };
  try {
    assert.throws(() => formatted("%s", [string(source)], text, budget(32)), { message: "execution step limit exceeded" });
    assert.equal(slices, 0);
    assert.equal(formatted("%.4s", [string(source)], text, budget(16, 4)), "xxxx");
    assert.equal(slices, 1);
  } finally { String.prototype.slice = original; }
});

test("formatter admits string numeric coercion before its prefix scan", () => {
  const source = " ".repeat(62) + "42";
  const original = RegExp.prototype.exec;
  let scans = 0;
  RegExp.prototype.exec = function (value) {
    if (value === source) scans++;
    return original.call(this, value);
  };
  try {
    assert.throws(() => formatted("%d", [string(source)], text, budget(32)), { message: "execution step limit exceeded" });
    assert.equal(scans, 0);
    assert.equal(formatted("%d", [string(source)], text, budget(1000)), "42");
    assert.equal(scans, 1);
  } finally { RegExp.prototype.exec = original; }
});

test("formatter shares one output buffer across literal, percent and conversion branches", () => {
  assert.equal(formatted("a%%%s", [string("bc")], text, budget(100, 4)), "a%bc");
  assert.throws(() => formatted("a%%%s", [string("bcd")], text, budget(100, 4)), { message: "text buffer limit exceeded" });
  assert.throws(() => formatted("abcde", [], text, budget(100, 4)), { message: "text buffer limit exceeded" });
});

test("formatter retains its independent ceiling before slicing a large logical source", () => {
  // Instrument the conversion callback's length/slice boundary without creating
  // a large string. The admitted control proves the slice observer is reached.
  let slices = 0;
  const source = { length: 32 * 1024 * 1024 + 1, slice() { slices++; return "x"; } };
  const convert = () => source as unknown as string;
  assert.throws(() => formatted("%s", [string("x")], convert, budget(128 * 1024 * 1024, 64 * 1024 * 1024)), { message: "formatted output exceeds buffer limit" });
  assert.equal(slices, 0);
  source.length--;
  assert.equal(formatted("%s", [string("x")], convert, budget(128 * 1024 * 1024, 64 * 1024 * 1024)), "x");
  assert.equal(slices, 1);
});

for (const format of ["%*s", "%.*s"]) test(`formatter charges the full string ${format} numeric argument before scanning`, () => {
  const source = string(" ".repeat(62) + "04");
  assert.throws(() => formatted(format, [source, string("x")], text, budget(32)), { message: "execution step limit exceeded" });
  assert.equal(formatted(format, [source, string("x")], text, budget(1000)), format === "%*s" ? "   x" : "x");
});

test("formatter repeated calls and integer text share the same remaining allowance", () => {
  const shared = budget(6);
  assert.equal(formatted("%%", [], text, shared), "%");
  assert.equal(formatted("%%", [], text, shared), "%");
  assert.throws(() => formatted("%%", [], text, shared), { message: "execution step limit exceeded" });
  assert.equal(text(numeric(1234), undefined, budget(4, 4)), "1234");
  assert.throws(() => text(numeric(1234), undefined, budget(3, 4)), { message: "execution step limit exceeded" });
  assert.throws(() => text(numeric(1234), undefined, budget(100, 3)), { message: "text buffer limit exceeded" });
});

for (const reason of [false, null, 0, ""]) test(`formatter preserves observed cancellation between conversions: ${JSON.stringify(reason)}`, () => {
  const controller = new AbortController();
  let conversions = 0;
  assert.throws(() => formatted("%s%s", [string("a"), string("b")], value => {
    conversions++;
    controller.abort(reason);
    return text(value);
  }, budget(100, 16, controller.signal)), error => Object.is(error, reason));
  assert.equal(conversions, 1);
});

test("formatter includes implicit text and comparison formatting", () => {
  const format = "%%".repeat(32) + "%g";
  assert.throws(() => text(numeric(1.5), format, budget(32)), { message: "execution step limit exceeded" });
  assert.throws(() => compare(numeric(1.5), string("x"), format, budget(32)), { message: "execution step limit exceeded" });
  assert.equal(text(numeric(1.5), "%.2f", budget(100, 4)), "1.50");
});

test("formatter preserves raw-byte and numeric flags, width and precision semantics", () => {
  const cases = [
    ["%s%c", [string("\xff\0"), numeric(254)], "\xff\0\xfe"],
    ["%-5.2s", [string("abcd")], "ab   "],
    ["%+05d", [numeric(7)], "+0007"],
    ["%#.4x", [numeric(15)], "0x000f"],
    ["%#o", [numeric(8)], "010"],
    ["%.*f", [numeric(2), numeric(1.5)], "1.50"],
    ["%*s", [numeric(-4), string("x")], "x   "],
    ["%.0d", [numeric(0)], ""],
    ["%E", [numeric(10)], "1.000000E+01"],
  ] as const;
  for (const [format, values, expected] of cases) assert.equal(formatted(format, values, text, budget(1000)), expected);
  assert.throws(() => formatted("%s", [], text, budget(100)), { message: "not enough arguments for format" });
  assert.throws(() => formatted("%q", [], text, budget(100)), /unsupported format/u);
});
