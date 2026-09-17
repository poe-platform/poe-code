import { describe, expect, it, vi } from "vitest";
import { displayWidth, expandTabs, graphemes, graphemeWidth, truncateToWidth } from "./terminal-width.js";

describe("terminal width", () => {
  it.each(["", "Hello, world! 0123456789 ~", "解析中 ASCII 界界", "\u4e00\u9fff", "\t", "first\n\tsecond\n"])(
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
    { value: "界\u0301", expected: ["界\u0301"] },
    { value: "界\ufe0f", expected: ["界\ufe0f"] },
    { value: "界👩‍💻字", expected: ["界", "👩‍💻", "字"] },
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

  it("leaves tab-free Unicode untouched without segmenting it", () => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    try {
      expect(expandTabs("界👩‍💻e\u0301", 7)).toBe("界👩‍💻e\u0301");
      expect(segment).not.toHaveBeenCalled();
    } finally {
      segment.mockRestore();
    }
  });

  it("expands tabs using the display width of mixed graphemes", () => {
    expect(expandTabs("界\t👩‍💻\t", 1)).toBe("界     👩‍💻      ");
  });

  it("truncates at grapheme boundaries with an ellipsis", () => {
    expect(truncateToWidth("ab🙂cd", 5)).toBe("ab🙂…");
    expect(truncateToWidth("🙂", 1)).toBe("…");
    expect(truncateToWidth("abc", 0)).toBe("");
  });
});
