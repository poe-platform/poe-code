import { describe, expect, it, vi } from "vitest";
import { displayWidth, graphemes, graphemeWidth, truncateToWidth } from "./terminal-width.js";

describe("terminal width", () => {
  it.each(["", "Hello, world! 0123456789 ~"])(
    "segments %j without invoking the native segmenter",
    (value) => {
      const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
      try {
        expect(graphemes(value)).toEqual([...value]);
        expect(segment).not.toHaveBeenCalled();
      } finally {
        segment.mockRestore();
      }
    }
  );

  it("segments the full printable ASCII range without invoking the native segmenter", () => {
    const characters = Array.from({ length: 95 }, (_, index) => String.fromCharCode(0x20 + index));
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    try {
      expect(graphemes(characters.join(""))).toEqual(characters);
      expect(segment).not.toHaveBeenCalled();
    } finally {
      segment.mockRestore();
    }
  });

  it.each(["", "ASCII"])("returns fresh arrays for %j", (value) => {
    const first = graphemes(value);
    const second = graphemes(value);
    expect(first).not.toBe(second);
    first.push("changed");
    expect(second).toEqual([...value]);
    expect(graphemes(value)).toEqual([...value]);
  });

  it.each([
    { value: "\0", expected: ["\0"] },
    { value: "\t", expected: ["\t"] },
    { value: "\r\n", expected: ["\r\n"] },
    { value: "\x1f", expected: ["\x1f"] },
    { value: "\x7f", expected: ["\x7f"] },
    {
      value: "\x1b[31mA\x1b[0m",
      expected: ["\x1b", "[", "3", "1", "m", "A", "\x1b", "[", "0", "m"]
    },
    { value: "é", expected: ["é"] },
    { value: "e\u0301", expected: ["e\u0301"] },
    { value: "♥️", expected: ["♥️"] },
    { value: "👩‍💻", expected: ["👩‍💻"] },
    { value: "🇵🇱", expected: ["🇵🇱"] },
    { value: "漢字", expected: ["漢", "字"] },
    { value: " ~\x7f", expected: [" ", "~", "\x7f"] }
  ])("uses native grapheme boundaries for $value", ({ value, expected }) => {
    const native = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const nativeResult = Array.from(native.segment(value), ({ segment }) => segment);
    expect(nativeResult).toEqual(expected);
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    try {
      expect(graphemes(value)).toEqual(expected);
      expect(segment).toHaveBeenCalledExactlyOnceWith(value);
    } finally {
      segment.mockRestore();
    }
  });

  it("measures whole graphemes and promotes VS16 emoji presentation", () => {
    expect(graphemeWidth("♥")).toBe(1);
    expect(graphemeWidth("♥️")).toBe(2);
    expect(displayWidth("A♥️B")).toBe(4);
  });

  it("truncates at grapheme boundaries with an ellipsis", () => {
    expect(truncateToWidth("ab🙂cd", 5)).toBe("ab🙂…");
    expect(truncateToWidth("🙂", 1)).toBe("…");
    expect(truncateToWidth("abc", 0)).toBe("");
  });
});
