import { describe, expect, it } from "vitest";
import { cellWidth, centerCells, fitToWidth, padEndCells, splitGraphemeCells } from "./text.js";

describe("explorer render text helpers", () => {
  it("truncates by terminal cells without splitting graphemes", () => {
    expect(fitToWidth("修复🚀launch", 7)).toBe("修复🚀…");
    expect(cellWidth(fitToWidth("修复🚀launch", 7))).toBe(7);
    expect(fitToWidth("修复", 1)).toBe("…");
  });

  it("pads and centers by terminal cells", () => {
    expect(padEndCells("計", 5, "─")).toBe("計───");
    expect(centerCells("計", 6)).toBe("  計");
  });

  it("keeps original code-unit offsets for grapheme matches", () => {
    expect(splitGraphemeCells("a🚀b")).toEqual([
      { value: "a", start: 0, end: 1, width: 1 },
      { value: "🚀", start: 1, end: 3, width: 2 },
      { value: "b", start: 3, end: 4, width: 1 }
    ]);
  });
});
