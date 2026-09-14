import { describe, expect, it } from "vitest";
import { encodeUtf8Text } from "./utf8-text-encode.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function text(value: string): CodePointString {
  return new CodePointString(Uint32Array.from(value, point => point.codePointAt(0)!));
}

describe("UTF-8 text write preparation", () => {
  it.each([
    [null, "\n", "a\r\nb\n"], [null, "\r\n", "a\r\r\nb\r\n"],
    [null, "\r", "a\r\rb\r"], ["", "\r\n", "a\r\nb\n"],
    ["\n", "\r\n", "a\r\nb\n"], ["\r", "\n", "a\r\rb\r"],
    ["\r\n", "\n", "a\r\r\nb\r\n"]
  ] as const)("translates newline %j with platform separator %j", (newline, lineSeparator, expected) => {
    const result = encodeUtf8Text(text("a\r\nb\n"), { newline, lineSeparator });
    expect([...result.bytes]).toEqual([...new TextEncoder().encode(expected)]);
    expect(result.characters).toBe(5);
    expect(result.lineBreak).toBe(true);
  });

  it.each(["", "abc", "\u0085\u2028\u2029", "😀"])("does not imply line flush for %j", source => {
    const result = encodeUtf8Text(text(source), { newline: "\r\n" });
    expect(result.lineBreak).toBe(false);
    expect(result.characters).toBe(Array.from(source).length);
    expect([...result.bytes]).toEqual([...new TextEncoder().encode(source)]);
  });

  it("detects a lone CR for line buffering without translating it", () => {
    const result = encodeUtf8Text(text("\r"), { newline: "\r\n" });
    expect(result.lineBreak).toBe(true);
    expect([...result.bytes]).toEqual([13]);
  });

  it("reports error positions in the translated string", () => {
    const input = text("\n\ud800");
    try {
      encodeUtf8Text(input, { newline: "\r\n" });
      expect.fail("expected encoding error");
    } catch (error) {
      expect(error).toMatchObject({ name: "UnicodeEncodeError", start: 2, end: 3, reason: "surrogates not allowed" });
      expect([...(error as { object: CodePointString }).object]).toEqual([13, 10, 0xd800]);
    }
    expect([...input]).toEqual([10, 0xd800]);
  });

  it.each([
    ["ignore", [13, 10]], ["replace", [13, 10, 63]],
    ["surrogateescape", [13, 10, 128]], ["surrogatepass", [13, 10, 237, 178, 128]],
    ["backslashreplace", [13, 10, 92, 117, 100, 99, 56, 48]],
    ["namereplace", [13, 10, 92, 117, 100, 99, 56, 48]],
    ["xmlcharrefreplace", [13, 10, 38, 35, 53, 54, 52, 52, 56, 59]]
  ] as const)("applies %s after translation", (errors, expected) => {
    const result = encodeUtf8Text(text("\n\udc80"), { newline: "\r\n", errors });
    expect([...result.bytes]).toEqual(expected);
    expect(result.characters).toBe(2);
  });

  it("does not combine surrogate pairs across independent writes", () => {
    expect([...encodeUtf8Text(text("\ud800"), { errors: "surrogatepass" }).bytes]).toEqual([237, 160, 128]);
    expect([...encodeUtf8Text(text("\udc00"), { errors: "surrogatepass" }).bytes]).toEqual([237, 176, 128]);
  });

  it("meters scans, translation buffers, and byte output without mutating input", () => {
    const input = text("a\n😀\n");
    const expected = encodeUtf8Text(input, { newline: "\r\n" });
    for (const axis of ["maxSteps", "maxAllocatedBytes"] as const) {
      let failures = 0, successes = 0;
      for (let limit = 0; limit < 300; limit++) {
        const budget = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000, [axis]: limit });
        try {
          expect(encodeUtf8Text(input, { newline: "\r\n" }, budget)).toEqual(expected);
          successes++;
        } catch (error) {
          expect(error).toBeInstanceOf(ExecutionLimitError);
          failures++;
        }
        expect([...input]).toEqual([97, 10, 0x1f600, 10]);
      }
      expect(failures).toBeGreaterThan(0);
      expect(successes).toBeGreaterThan(0);
    }
  });

  it("checks cancellation on empty writes", () => {
    const controller = new AbortController();
    controller.abort();
    const budget = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal });
    expect(() => encodeUtf8Text(text(""), {}, budget)).toThrow(expect.objectContaining({ reason: "cancelled" }));
  });

  it("rejects invalid newline settings", () => {
    expect(() => encodeUtf8Text(text(""), { newline: "x" })).toThrow(expect.objectContaining({ name: "ValueError" }));
  });
});
