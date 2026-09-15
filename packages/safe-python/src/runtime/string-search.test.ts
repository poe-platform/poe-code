import { describe, expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";

function text(value: string): CodePointString {
  return new CodePointString(new Uint32Array(Array.from(value, point => point.codePointAt(0)!)));
}

describe("code-point substring searching", () => {
  it.each([
    ["banana", "ana", 1, 3, 1], ["aaaaa", "aa", 0, 3, 2],
    ["aaaaab", "aaab", 2, 2, 1], ["abababac", "ababac", 2, 2, 1],
    ["abc", "z", -1, -1, 0], ["abc", "abcd", -1, -1, 0],
    ["", "x", -1, -1, 0], ["", "", 0, 0, 1], ["abc", "", 0, 3, 4]
  ])("searches %s for %s", (source, needle, first, last, count) => {
    const haystack = text(source), pattern = text(needle);
    expect(haystack.search(pattern, "find")).toBe(first);
    expect(haystack.search(pattern, "rfind")).toBe(last);
    expect(haystack.search(pattern, "count")).toBe(count);
  });

  it.each([
    [1n, 5n, 1, 1, 1], [2n, null, 3, 3, 1], [-3n, null, 3, 3, 1],
    [1n, -2n, 1, 1, 1], [0n, 3n, -1, -1, 0],
    [10n ** 100n, null, -1, -1, 0], [-(10n ** 100n), 10n ** 100n, 1, 3, 1]
  ])("respects search bounds %s:%s", (start, stop, first, last, count) => {
    const haystack = text("banana"), pattern = text("ana");
    expect(haystack.search(pattern, "find", start, stop)).toBe(first);
    expect(haystack.search(pattern, "rfind", start, stop)).toBe(last);
    expect(haystack.search(pattern, "count", start, stop)).toBe(count);
  });

  it.each([
    [3n, null, 3, 3, 1], [4n, null, -1, -1, 0],
    [2n, 1n, -1, -1, 0], [-9n, -9n, 0, 0, 1], [0n, 0n, 0, 0, 1],
    [1n, -1n, 1, 2, 2]
  ])("handles empty-pattern bounds %s:%s without over-clamping start", (start, stop, first, last, count) => {
    const haystack = text("abc"), pattern = text("");
    expect(haystack.search(pattern, "find", start, stop)).toBe(first);
    expect(haystack.search(pattern, "rfind", start, stop)).toBe(last);
    expect(haystack.search(pattern, "count", start, stop)).toBe(count);
  });

  it("searches by code point without merging surrogate pairs or normalizing text", () => {
    const haystack = new CodePointString(new Uint32Array([0x10000, 0xd800, 0xdc00, 0x10000]));
    const pair = new CodePointString(new Uint32Array([0xd800, 0xdc00]));
    const supplementary = new CodePointString(new Uint32Array([0x10000]));
    expect(haystack.search(pair, "find")).toBe(1);
    expect(haystack.search(supplementary, "rfind")).toBe(3);
    expect(haystack.search(supplementary, "count")).toBe(2);
    expect(text("A\u0301").search(text("Á"), "find")).toBe(-1);
  });

  it("handles long repeated prefixes without a quadratic restart at each position", () => {
    const haystack = text("a".repeat(10000) + "b");
    expect(haystack.search(text("a".repeat(5000) + "b"), "find")).toBe(5000);
    expect(haystack.search(text("a".repeat(5000) + "c"), "rfind")).toBe(-1);
    expect(haystack.search(text("aaa"), "count")).toBe(3333);
  });
});
