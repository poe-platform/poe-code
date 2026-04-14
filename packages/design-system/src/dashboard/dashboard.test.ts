import chalk from "chalk";
import { describe, expect, it } from "vitest";
import { ScreenBuffer, cellToAnsi, diff } from "./buffer.js";
import { computeDashboardLayout } from "./layout.js";
import type { Rect } from "./types.js";

function readRow(buffer: ScreenBuffer, y: number): string {
  return Array.from({ length: buffer.width }, (_, x) => buffer.get(x, y).ch).join("");
}

describe("ScreenBuffer", () => {
  it("put writes characters at correct positions", () => {
    const buffer = new ScreenBuffer(5, 3);

    buffer.put(1, 1, "abc", { fg: "red", bold: true });

    expect(buffer.get(0, 1)).toEqual({ ch: " ", style: {} });
    expect(buffer.get(1, 1)).toEqual({ ch: "a", style: { fg: "red", bold: true } });
    expect(buffer.get(2, 1)).toEqual({ ch: "b", style: { fg: "red", bold: true } });
    expect(buffer.get(3, 1)).toEqual({ ch: "c", style: { fg: "red", bold: true } });
  });

  it("put clips text that exceeds buffer width", () => {
    const buffer = new ScreenBuffer(4, 1);

    buffer.put(2, 0, "abcd");

    expect(readRow(buffer, 0)).toBe("  ab");
  });

  it("put clips text that starts before the left edge", () => {
    const buffer = new ScreenBuffer(4, 1);

    buffer.put(-2, 0, "abcd", { fg: "green" });

    expect(readRow(buffer, 0)).toBe("cd  ");
    expect(buffer.get(0, 0)).toEqual({ ch: "c", style: { fg: "green" } });
    expect(buffer.get(1, 0)).toEqual({ ch: "d", style: { fg: "green" } });
  });

  it("put ignores writes outside buffer bounds", () => {
    const buffer = new ScreenBuffer(4, 2);

    buffer.put(0, -1, "top");
    buffer.put(4, 0, "right");
    buffer.put(-3, 1, "ab");
    buffer.put(0, 2, "bottom");

    expect(readRow(buffer, 0)).toBe("    ");
    expect(readRow(buffer, 1)).toBe("    ");
  });

  it("get returns empty cell for unwritten positions", () => {
    const buffer = new ScreenBuffer(3, 2);

    expect(buffer.get(2, 1)).toEqual({ ch: " ", style: {} });
  });

  it("get returns a copy of the stored cell", () => {
    const buffer = new ScreenBuffer(2, 1);

    buffer.put(0, 0, "x", { bold: true });
    const cell = buffer.get(0, 0);
    cell.ch = "y";
    cell.style.bold = false;

    expect(buffer.get(0, 0)).toEqual({ ch: "x", style: { bold: true } });
  });

  it("clear resets all cells", () => {
    const buffer = new ScreenBuffer(4, 2);

    buffer.put(0, 0, "test", { fg: "green" });
    buffer.put(1, 1, "x", { bg: "blue", dim: true });

    buffer.clear({ dim: true });

    for (let y = 0; y < buffer.height; y += 1) {
      for (let x = 0; x < buffer.width; x += 1) {
        expect(buffer.get(x, y)).toEqual({ ch: " ", style: { dim: true } });
      }
    }
  });

  it("clearRect only clears the specified region", () => {
    const buffer = new ScreenBuffer(5, 3);

    buffer.put(0, 0, "ABCDE", { fg: "yellow" });
    buffer.put(0, 1, "FGHIJ", { fg: "yellow" });
    buffer.put(0, 2, "KLMNO", { fg: "yellow" });

    buffer.clearRect({ x: 1, y: 1, width: 3, height: 1 });

    expect(readRow(buffer, 0)).toBe("ABCDE");
    expect(readRow(buffer, 1)).toBe("F   J");
    expect(readRow(buffer, 2)).toBe("KLMNO");
    expect(buffer.get(1, 1)).toEqual({ ch: " ", style: {} });
    expect(buffer.get(4, 1)).toEqual({ ch: "J", style: { fg: "yellow" } });
  });

  it("clearRect clips regions that extend beyond the buffer", () => {
    const buffer = new ScreenBuffer(3, 2);

    buffer.put(0, 0, "ABC", { fg: "yellow" });
    buffer.put(0, 1, "DEF", { fg: "yellow" });

    buffer.clearRect({ x: -1, y: 0, width: 3, height: 3 }, { bg: "black" });

    expect(readRow(buffer, 0)).toBe("  C");
    expect(readRow(buffer, 1)).toBe("  F");
    expect(buffer.get(0, 0)).toEqual({ ch: " ", style: { bg: "black" } });
    expect(buffer.get(1, 1)).toEqual({ ch: " ", style: { bg: "black" } });
    expect(buffer.get(2, 1)).toEqual({ ch: "F", style: { fg: "yellow" } });
  });

  it("resize preserves existing content that fits", () => {
    const buffer = new ScreenBuffer(4, 2);

    buffer.put(0, 0, "ab");
    buffer.put(2, 1, "xy", { fg: "cyan" });

    buffer.resize(3, 3);

    expect(buffer.width).toBe(3);
    expect(buffer.height).toBe(3);
    expect(readRow(buffer, 0)).toBe("ab ");
    expect(readRow(buffer, 1)).toBe("  x");
    expect(readRow(buffer, 2)).toBe("   ");
    expect(buffer.get(2, 1)).toEqual({ ch: "x", style: { fg: "cyan" } });
  });

  it("putInRect clips to rect boundaries", () => {
    const buffer = new ScreenBuffer(6, 4);
    const rect: Rect = { x: 1, y: 1, width: 3, height: 2 };

    buffer.putInRect(rect, 0, "hello", { fg: "magenta" });
    buffer.putInRect(rect, 2, "ignored", { fg: "red" });

    expect(readRow(buffer, 0)).toBe("      ");
    expect(readRow(buffer, 1)).toBe(" hel  ");
    expect(readRow(buffer, 2)).toBe("      ");
    expect(buffer.get(1, 1)).toEqual({ ch: "h", style: { fg: "magenta" } });
    expect(buffer.get(3, 1)).toEqual({ ch: "l", style: { fg: "magenta" } });
  });

  it("putInRect clips when the rect starts outside the buffer", () => {
    const buffer = new ScreenBuffer(4, 1);
    const rect: Rect = { x: -1, y: 0, width: 3, height: 1 };

    buffer.putInRect(rect, 0, "abcd", { fg: "cyan" });

    expect(readRow(buffer, 0)).toBe("bc  ");
    expect(buffer.get(0, 0)).toEqual({ ch: "b", style: { fg: "cyan" } });
    expect(buffer.get(1, 0)).toEqual({ ch: "c", style: { fg: "cyan" } });
  });
});

describe("diff", () => {
  it("returns empty array for identical buffers", () => {
    const prev = new ScreenBuffer(3, 2);
    const next = new ScreenBuffer(3, 2);

    next.put(1, 0, "x", { bold: true });
    prev.put(1, 0, "x", { bold: true });

    expect(diff(prev, next)).toEqual([]);
  });

  it("returns changed cells only", () => {
    const prev = new ScreenBuffer(4, 2);
    const next = new ScreenBuffer(4, 2);

    prev.put(0, 0, "ab", { fg: "red" });
    next.put(0, 0, "ax", { fg: "red" });
    next.put(3, 1, "z", { bg: "blue" });

    expect(diff(prev, next)).toEqual([
      { x: 1, y: 0, cell: { ch: "x", style: { fg: "red" } } },
      { x: 3, y: 1, cell: { ch: "z", style: { bg: "blue" } } }
    ]);
  });

  it("handles buffers of different sizes", () => {
    const smaller = new ScreenBuffer(2, 1);
    const larger = new ScreenBuffer(3, 2);

    larger.put(2, 1, "X", { dim: true });

    expect(diff(smaller, larger)).toEqual([
      { x: 2, y: 1, cell: { ch: "X", style: { dim: true } } }
    ]);

    const prev = new ScreenBuffer(3, 2);
    const next = new ScreenBuffer(2, 1);

    prev.put(2, 1, "Y", { bold: true });

    expect(diff(prev, next)).toEqual([
      { x: 2, y: 1, cell: { ch: " ", style: {} } }
    ]);
  });
});


describe("cellToAnsi", () => {
  it("converts a styled cell to ANSI text", () => {
    expect(cellToAnsi({
      ch: "A",
      style: { fg: "red", bg: "blue", bold: true, dim: true }
    })).toBe(chalk.bold.dim.red.bgBlue("A"));
  });

  it("supports hex foreground and background colors", () => {
    expect(cellToAnsi({
      ch: "A",
      style: { fg: "#ff0000", bg: "#0000ff" }
    })).toBe(chalk.hex("#ff0000").bgHex("#0000ff")("A"));
  });
});

describe("computeDashboardLayout", () => {
  it("produces the expected rects for a standard 80x24 terminal", () => {
    expect(computeDashboardLayout({ totalWidth: 80, totalHeight: 24 })).toEqual({
      outerBorder: { x: 0, y: 0, width: 80, height: 24 },
      leftPane: { x: 1, y: 1, width: 52, height: 20 },
      rightPane: { x: 54, y: 1, width: 25, height: 20 },
      divider: { x: 53, top: 1, bottom: 20 },
      footer: { x: 1, y: 22, width: 78, height: 1 },
      footerDivider: { y: 21, left: 1, right: 78 }
    });
  });

  it("respects a custom right pane width", () => {
    expect(computeDashboardLayout({
      totalWidth: 100,
      totalHeight: 30,
      rightPaneWidth: 30
    })).toMatchObject({
      leftPane: { x: 1, y: 1, width: 67, height: 26 },
      rightPane: { x: 69, y: 1, width: 30, height: 26 },
      divider: { x: 68, top: 1, bottom: 26 },
      footer: { x: 1, y: 28, width: 98, height: 1 },
      footerDivider: { y: 27, left: 1, right: 98 }
    });
  });

  it("keeps the left pane at a minimum width of 20 columns when space is tight", () => {
    const layout = computeDashboardLayout({ totalWidth: 40, totalHeight: 24 });

    expect(layout.leftPane).toEqual({ x: 1, y: 1, width: 20, height: 20 });
    expect(layout.divider).toEqual({ x: 21, top: 1, bottom: 20 });
    expect(layout.rightPane).toEqual({ x: 22, y: 1, width: 17, height: 20 });
  });

  it("accounts for borders, divider, and footer when calculating heights", () => {
    const layout = computeDashboardLayout({
      totalWidth: 80,
      totalHeight: 12,
      footerHeight: 2
    });

    expect(layout.leftPane.height).toBe(7);
    expect(layout.rightPane.height).toBe(7);
    expect(layout.footer).toEqual({ x: 1, y: 9, width: 78, height: 2 });
    expect(layout.footerDivider).toEqual({ y: 8, left: 1, right: 78 });
    expect(1 + layout.leftPane.height + 1 + layout.footer.height + 1).toBe(12);
  });

  it("keeps collapsed layouts anchored inside the terminal bounds", () => {
    expect(computeDashboardLayout({ totalWidth: 0, totalHeight: 0 })).toEqual({
      outerBorder: { x: 0, y: 0, width: 0, height: 0 },
      leftPane: { x: 0, y: 0, width: 0, height: 0 },
      rightPane: { x: 0, y: 0, width: 0, height: 0 },
      divider: { x: 0, top: 0, bottom: 0 },
      footer: { x: 0, y: 0, width: 0, height: 0 },
      footerDivider: { y: 0, left: 0, right: 0 }
    });

    expect(computeDashboardLayout({ totalWidth: 1, totalHeight: 1 })).toEqual({
      outerBorder: { x: 0, y: 0, width: 1, height: 1 },
      leftPane: { x: 0, y: 0, width: 0, height: 0 },
      rightPane: { x: 0, y: 0, width: 0, height: 0 },
      divider: { x: 0, top: 0, bottom: 0 },
      footer: { x: 0, y: 0, width: 0, height: 0 },
      footerDivider: { y: 0, left: 0, right: 0 }
    });
  });
});
