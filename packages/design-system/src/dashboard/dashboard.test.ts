import chalk from "chalk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScreenBuffer, cellToAnsi, diff } from "./buffer.js";
import { renderBorder } from "./components/border.js";
import { defaultHints, renderFooter } from "./components/footer.js";
import { createKeymap } from "./keymap.js";
import {
  computeVisualLines,
  renderOutputPane,
  scrollDown,
  scrollToBottom,
  scrollToTop,
  scrollUp
} from "./components/output-pane.js";
import {
  formatElapsed,
  formatNumber,
  renderStatsPane,
  statsToLines
} from "./components/stats-pane.js";
import { computeDashboardLayout } from "./layout.js";
import { resetThemeCache } from "../internal/theme-detect.js";
import type { DashboardLayout } from "./layout.js";
import type { KeypressEvent } from "./terminal.js";
import type { DashboardStats, OutputItem, Rect } from "./types.js";

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

    expect(diff(prev, next)).toEqual([{ x: 2, y: 1, cell: { ch: " ", style: {} } }]);
  });
});

describe("cellToAnsi", () => {
  it("converts a styled cell to ANSI text", () => {
    expect(
      cellToAnsi({
        ch: "A",
        style: { fg: "red", bg: "blue", bold: true, dim: true }
      })
    ).toBe(chalk.bold.dim.red.bgBlue("A"));
  });

  it("supports hex foreground and background colors", () => {
    expect(
      cellToAnsi({
        ch: "A",
        style: { fg: "#ff0000", bg: "#0000ff" }
      })
    ).toBe(chalk.hex("#ff0000").bgHex("#0000ff")("A"));
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
    expect(
      computeDashboardLayout({
        totalWidth: 100,
        totalHeight: 30,
        rightPaneWidth: 30
      })
    ).toMatchObject({
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

describe("renderBorder", () => {
  it("places border characters at the expected positions", () => {
    const buffer = new ScreenBuffer(30, 8);
    const layout = computeDashboardLayout({ totalWidth: 30, totalHeight: 8 });

    renderBorder(buffer, layout, { style: { fg: "cyan" } });

    expect(readRow(buffer, 0)).toBe("┌────────────────────┬───────┐");
    expect(readRow(buffer, 5)).toBe("├────────────────────┴───────┤");
    expect(readRow(buffer, 7)).toBe("└────────────────────────────┘");
    expect(buffer.get(0, 1)).toEqual({ ch: "│", style: { fg: "cyan" } });
    expect(buffer.get(21, 1)).toEqual({ ch: "│", style: { fg: "cyan" } });
    expect(buffer.get(29, 1)).toEqual({ ch: "│", style: { fg: "cyan" } });
    expect(buffer.get(21, 6)).toEqual({ ch: " ", style: {} });
  });

  it("renders titles inline in the top border", () => {
    const buffer = new ScreenBuffer(40, 8);
    const layout = computeDashboardLayout({ totalWidth: 40, totalHeight: 8 });

    renderBorder(buffer, layout, {
      leftTitle: "Agent Output",
      rightTitle: "Stats",
      style: { fg: "green", bold: true }
    });

    expect(readRow(buffer, 0)).toBe("┌─ Agent Output ─────┬─ Stats ─────────┐");
    expect(buffer.get(1, 0)).toEqual({ ch: "─", style: { fg: "green", bold: true } });
    expect(buffer.get(3, 0)).toEqual({ ch: "A", style: { fg: "green", bold: true } });
    expect(buffer.get(22, 0)).toEqual({ ch: "─", style: { fg: "green", bold: true } });
  });

  it("uses the correct junction characters at intersections", () => {
    const buffer = new ScreenBuffer(10, 6);
    const layout: DashboardLayout = {
      outerBorder: { x: 0, y: 0, width: 10, height: 6 },
      leftPane: { x: 1, y: 1, width: 4, height: 3 },
      rightPane: { x: 6, y: 1, width: 3, height: 3 },
      divider: { x: 5, top: 1, bottom: 4 },
      footer: { x: 1, y: 4, width: 8, height: 1 },
      footerDivider: { y: 3, left: 1, right: 8 }
    };

    renderBorder(buffer, layout, { style: { dim: true } });

    expect(readRow(buffer, 0)).toBe("┌────┬───┐");
    expect(readRow(buffer, 3)).toBe("├────┼───┤");
    expect(readRow(buffer, 5)).toBe("└────┴───┘");
  });

  it("truncates long titles to fit the available top-border width", () => {
    const buffer = new ScreenBuffer(40, 8);
    const layout = computeDashboardLayout({ totalWidth: 40, totalHeight: 8 });

    renderBorder(buffer, layout, {
      leftTitle: "ABCDEFGHIJKLMNOPQRSTUVWX",
      rightTitle: "12345678901234567890",
      style: { fg: "yellow" }
    });

    expect(readRow(buffer, 0)).toBe("┌─ ABCDEFGHIJKLMNOPQR┬─ 123456789012345┐");
  });

  it("preserves top and bottom junctions when the divider touches the outer frame", () => {
    const buffer = new ScreenBuffer(10, 6);
    const layout: DashboardLayout = {
      outerBorder: { x: 0, y: 0, width: 10, height: 6 },
      leftPane: { x: 1, y: 1, width: 4, height: 4 },
      rightPane: { x: 6, y: 1, width: 3, height: 4 },
      divider: { x: 5, top: 0, bottom: 5 },
      footer: { x: 1, y: 5, width: 8, height: 0 },
      footerDivider: { y: 5, left: 1, right: 8 }
    };

    renderBorder(buffer, layout, { style: { fg: "magenta" } });

    expect(readRow(buffer, 0)).toBe("┌────┬───┐");
    expect(readRow(buffer, 5)).toBe("└────┴───┘");
    expect(buffer.get(5, 2)).toEqual({ ch: "│", style: { fg: "magenta" } });
  });

  it("omits divider junctions when there is no interior height", () => {
    const buffer = new ScreenBuffer(12, 2);
    const layout = computeDashboardLayout({ totalWidth: 12, totalHeight: 2 });

    renderBorder(buffer, layout, { style: { fg: "blue" } });

    expect(readRow(buffer, 0)).toBe("┌──────────┐");
    expect(readRow(buffer, 1)).toBe("└──────────┘");
  });

  it("omits the pane divider when the right pane collapses to zero width", () => {
    const buffer = new ScreenBuffer(10, 6);
    const layout = computeDashboardLayout({ totalWidth: 10, totalHeight: 6 });

    renderBorder(buffer, layout, { style: { fg: "red" } });

    expect(readRow(buffer, 0)).toBe("┌────────┐");
    expect(readRow(buffer, 3)).toBe("├────────┤");
    expect(buffer.get(8, 1)).toEqual({ ch: " ", style: {} });
  });
});

describe("output pane", () => {
  const previousPoeCodeTheme = process.env.POE_CODE_THEME;
  const previousPoeTheme = process.env.POE_THEME;

  beforeEach(() => {
    process.env.POE_CODE_THEME = "dark";
    delete process.env.POE_THEME;
    resetThemeCache();
  });

  afterEach(() => {
    if (previousPoeCodeTheme === undefined) {
      delete process.env.POE_CODE_THEME;
    } else {
      process.env.POE_CODE_THEME = previousPoeCodeTheme;
    }

    if (previousPoeTheme === undefined) {
      delete process.env.POE_THEME;
    } else {
      process.env.POE_THEME = previousPoeTheme;
    }

    resetThemeCache();
  });

  it("computeVisualLines wraps long text correctly", () => {
    const items: OutputItem[] = [{ kind: "info", text: "alpha beta gamma", ts: 1 }];

    expect(computeVisualLines(items, 10)).toEqual([
      {
        prefix: "◇",
        prefixStyle: { fg: "magenta" },
        style: { fg: "magenta" },
        text: "alpha"
      },
      {
        prefix: "│",
        prefixStyle: { dim: true },
        style: { fg: "magenta" },
        text: "beta"
      },
      {
        prefix: "│",
        prefixStyle: { dim: true },
        style: { fg: "magenta" },
        text: "gamma"
      }
    ]);
  });

  it("computeVisualLines assigns the correct prefix and style per item kind", () => {
    const items: OutputItem[] = [
      { kind: "info", text: "info", ts: 1 },
      { kind: "success", text: "success", ts: 2 },
      { kind: "error", text: "error", ts: 3 },
      { kind: "tool", text: "tool", ts: 4 },
      { kind: "status", text: "status", ts: 5 }
    ];

    expect(computeVisualLines(items, 20)).toEqual([
      { prefix: "◇", prefixStyle: { fg: "magenta" }, style: { fg: "magenta" }, text: "info" },
      { prefix: "◆", prefixStyle: { fg: "green" }, style: { fg: "green" }, text: "success" },
      { prefix: "■", prefixStyle: { fg: "red" }, style: { fg: "red" }, text: "error" },
      { prefix: "│", prefixStyle: { dim: true }, style: { dim: true }, text: "tool" },
      { prefix: "●", prefixStyle: { fg: "magenta" }, style: { fg: "magenta" }, text: "status" }
    ]);
  });

  it("computeVisualLines preserves explicit blank lines and wraps each paragraph", () => {
    const items: OutputItem[] = [{ kind: "info", text: ["alpha beta", "", "gamma"].join("\n"), ts: 1 }];

    expect(computeVisualLines(items, 9)).toEqual([
      {
        prefix: "◇",
        prefixStyle: { fg: "magenta" },
        style: { fg: "magenta" },
        text: "alpha"
      },
      {
        prefix: "│",
        prefixStyle: { dim: true },
        style: { fg: "magenta" },
        text: "beta"
      },
      {
        prefix: "│",
        prefixStyle: { dim: true },
        style: { fg: "magenta" },
        text: ""
      },
      {
        prefix: "│",
        prefixStyle: { dim: true },
        style: { fg: "magenta" },
        text: "gamma"
      }
    ]);
  });

  it("computeVisualLines resolves light theme colors", () => {
    process.env.POE_CODE_THEME = "light";
    resetThemeCache();

    const items: OutputItem[] = [
      { kind: "info", text: "info", ts: 1 },
      { kind: "success", text: "success", ts: 2 },
      { kind: "error", text: "error", ts: 3 },
      { kind: "tool", text: "tool", ts: 4 },
      { kind: "status", text: "status", ts: 5 }
    ];

    expect(computeVisualLines(items, 20)).toEqual([
      { prefix: "◇", prefixStyle: { fg: "#a200ff" }, style: { fg: "#a200ff" }, text: "info" },
      { prefix: "◆", prefixStyle: { fg: "#008800" }, style: { fg: "#008800" }, text: "success" },
      { prefix: "■", prefixStyle: { fg: "#cc0000" }, style: { fg: "#cc0000" }, text: "error" },
      { prefix: "│", prefixStyle: { fg: "#666666" }, style: { fg: "#666666" }, text: "tool" },
      { prefix: "●", prefixStyle: { fg: "#a200ff" }, style: { fg: "#a200ff" }, text: "status" }
    ]);
  });

  it("scroll up and down clamp to valid offsets", () => {
    const state = { items: [], scrollOffset: 2, autoFollow: true };

    expect(scrollUp(state, 5)).toEqual({ items: [], scrollOffset: 0, autoFollow: false });
    expect(scrollDown(state, 5, 4)).toEqual({ items: [], scrollOffset: 3, autoFollow: false });
  });

  it("scrollToBottom enables auto-follow", () => {
    expect(scrollToBottom({ items: [], scrollOffset: 1, autoFollow: false }, 10, 4)).toEqual({
      items: [],
      scrollOffset: 6,
      autoFollow: true
    });
  });

  it("manual scrolling disables auto-follow", () => {
    expect(scrollDown({ items: [], scrollOffset: 0, autoFollow: true }, 1, 3).autoFollow).toBe(
      false
    );
    expect(scrollUp({ items: [], scrollOffset: 3, autoFollow: true }, 1).autoFollow).toBe(false);
    expect(scrollToTop({ items: [], scrollOffset: 3, autoFollow: true }).autoFollow).toBe(false);
  });

  it("renderOutputPane renders the expected lines in the rect", () => {
    const buffer = new ScreenBuffer(16, 5);
    const rect: Rect = { x: 1, y: 1, width: 13, height: 3 };
    const items: OutputItem[] = [
      { kind: "info", text: "alpha beta gamma", ts: 1 },
      { kind: "success", text: "done", ts: 2 }
    ];

    renderOutputPane(buffer, rect, {
      items,
      scrollOffset: 0,
      autoFollow: false
    });

    expect(readRow(buffer, 1)).toBe(" ◇  alpha beta  ");
    expect(readRow(buffer, 2)).toBe(" │  gamma       ");
    expect(readRow(buffer, 3)).toBe(" ◆  done        ");
    expect(buffer.get(1, 1)).toEqual({ ch: "◇", style: { fg: "magenta" } });
    expect(buffer.get(4, 1)).toEqual({ ch: "a", style: { fg: "magenta" } });
    expect(buffer.get(1, 2)).toEqual({ ch: "│", style: { dim: true } });
    expect(buffer.get(4, 3)).toEqual({ ch: "d", style: { fg: "green" } });
  });

  it("renderOutputPane respects scrollOffset when auto-follow is disabled", () => {
    const buffer = new ScreenBuffer(16, 6);
    const rect: Rect = { x: 1, y: 1, width: 13, height: 3 };
    const items: OutputItem[] = [
      { kind: "info", text: "alpha beta gamma", ts: 1 },
      { kind: "success", text: "done", ts: 2 },
      { kind: "error", text: "oops", ts: 3 }
    ];

    renderOutputPane(buffer, rect, {
      items,
      scrollOffset: 1,
      autoFollow: false
    });

    expect(readRow(buffer, 1)).toBe(" │  gamma       ");
    expect(readRow(buffer, 2)).toBe(" ◆  done        ");
    expect(readRow(buffer, 3)).toBe(" ■  oops        ");
  });

  it("renderOutputPane ignores scrollOffset while auto-follow is enabled", () => {
    const buffer = new ScreenBuffer(16, 5);
    const rect: Rect = { x: 1, y: 1, width: 13, height: 2 };
    const items: OutputItem[] = [
      { kind: "info", text: "alpha beta gamma", ts: 1 },
      { kind: "success", text: "done", ts: 2 }
    ];

    renderOutputPane(buffer, rect, {
      items,
      scrollOffset: 0,
      autoFollow: true
    });

    expect(readRow(buffer, 1)).toBe(" │  gamma       ");
    expect(readRow(buffer, 2)).toBe(" ◆  done        ");
  });
});

describe("stats pane", () => {
  const previousPoeCodeTheme = process.env.POE_CODE_THEME;
  const previousPoeTheme = process.env.POE_THEME;

  beforeEach(() => {
    process.env.POE_CODE_THEME = "dark";
    delete process.env.POE_THEME;
    resetThemeCache();
  });

  afterEach(() => {
    if (previousPoeCodeTheme === undefined) {
      delete process.env.POE_CODE_THEME;
    } else {
      process.env.POE_CODE_THEME = previousPoeCodeTheme;
    }

    if (previousPoeTheme === undefined) {
      delete process.env.POE_THEME;
    } else {
      process.env.POE_THEME = previousPoeTheme;
    }

    resetThemeCache();
  });

  it("formatElapsed formats correctly for various durations", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(999)).toBe("00:00:00");
    expect(formatElapsed(92_000)).toBe("00:01:32");
    expect(formatElapsed(3_723_000)).toBe("01:02:03");
    expect(formatElapsed(90_061_000)).toBe("25:01:01");
    expect(formatElapsed(-1_000)).toBe("00:00:00");
    expect(formatElapsed(Number.NaN)).toBe("00:00:00");
  });

  it("formatNumber adds commas", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(12_430)).toBe("12,430");
    expect(formatNumber(1_234_567)).toBe("1,234,567");
  });

  it("statsToLines produces the expected label/value pairs", () => {
    const stats: DashboardStats = {
      status: "running",
      iterations: 14,
      tokensIn: 12_430,
      tokensOut: 5_982,
      elapsedMs: 92_000,
      currentAction: "generating patch"
    };

    expect(statsToLines(stats, 25)).toEqual([
      {
        prefix: "Status            ",
        prefixStyle: {},
        style: { fg: "magenta" },
        text: "Running"
      },
      {
        prefix: "Iteration              ",
        prefixStyle: {},
        style: {},
        text: "14"
      },
      {
        prefix: "Elapsed          ",
        prefixStyle: {},
        style: {},
        text: "00:01:32"
      },
      {
        prefix: "",
        prefixStyle: {},
        style: {},
        text: ""
      },
      {
        prefix: "Tokens In          ",
        prefixStyle: {},
        style: {},
        text: "12,430"
      },
      {
        prefix: "Tokens Out          ",
        prefixStyle: {},
        style: {},
        text: "5,982"
      },
      {
        prefix: "Total              ",
        prefixStyle: {},
        style: {},
        text: "18,412"
      },
      {
        prefix: "",
        prefixStyle: {},
        style: {},
        text: ""
      },
      {
        prefix: "Current:",
        prefixStyle: {},
        style: {},
        text: ""
      },
      {
        prefix: "  ",
        prefixStyle: { dim: true },
        style: { dim: true },
        text: "generating patch"
      }
    ]);
  });

  it("statsToLines applies the expected status colors", () => {
    expect(
      statsToLines(
        { status: "running", iterations: 0, tokensIn: 0, tokensOut: 0, elapsedMs: 0 },
        20
      )[0]
    ).toMatchObject({ style: { fg: "magenta" }, text: "Running" });
    expect(
      statsToLines(
        { status: "paused", iterations: 0, tokensIn: 0, tokensOut: 0, elapsedMs: 0 },
        20
      )[0]
    ).toMatchObject({ style: { fg: "yellow" }, text: "Paused" });
    expect(
      statsToLines(
        { status: "error", iterations: 0, tokensIn: 0, tokensOut: 0, elapsedMs: 0 },
        20
      )[0]
    ).toMatchObject({ style: { fg: "red" }, text: "Error" });
    expect(
      statsToLines({ status: "done", iterations: 0, tokensIn: 0, tokensOut: 0, elapsedMs: 0 }, 20)[0]
    ).toMatchObject({ style: { fg: "green" }, text: "Done" });
    expect(
      statsToLines({ status: "idle", iterations: 0, tokensIn: 0, tokensOut: 0, elapsedMs: 0 }, 20)[0]
    ).toMatchObject({ style: { dim: true }, text: "Idle" });
  });

  it("statsToLines resolves light theme status colors", () => {
    process.env.POE_CODE_THEME = "light";
    resetThemeCache();

    expect(
      statsToLines(
        { status: "running", iterations: 0, tokensIn: 0, tokensOut: 0, elapsedMs: 0 },
        20
      )[0]
    ).toMatchObject({ style: { fg: "#a200ff" }, text: "Running" });
    expect(
      statsToLines(
        { status: "paused", iterations: 0, tokensIn: 0, tokensOut: 0, elapsedMs: 0 },
        20
      )[0]
    ).toMatchObject({ style: { fg: "#cc6600" }, text: "Paused" });
    expect(
      statsToLines(
        { status: "error", iterations: 0, tokensIn: 0, tokensOut: 0, elapsedMs: 0 },
        20
      )[0]
    ).toMatchObject({ style: { fg: "#cc0000" }, text: "Error" });
    expect(
      statsToLines({ status: "done", iterations: 0, tokensIn: 0, tokensOut: 0, elapsedMs: 0 }, 20)[0]
    ).toMatchObject({ style: { fg: "#008800" }, text: "Done" });
    expect(
      statsToLines({ status: "idle", iterations: 0, tokensIn: 0, tokensOut: 0, elapsedMs: 0 }, 20)[0]
    ).toMatchObject({ style: { fg: "#666666" }, text: "Idle" });
  });

  it("statsToLines includes the current action only when present", () => {
    const withCurrent = statsToLines(
      {
        status: "running",
        iterations: 14,
        tokensIn: 12_430,
        tokensOut: 5_982,
        elapsedMs: 92_000,
        currentAction: "generating patch"
      },
      25
    );
    const withoutCurrent = statsToLines(
      {
        status: "running",
        iterations: 14,
        tokensIn: 12_430,
        tokensOut: 5_982,
        elapsedMs: 92_000
      },
      25
    );

    expect(withCurrent.slice(-2)).toEqual([
      { prefix: "Current:", prefixStyle: {}, style: {}, text: "" },
      {
        prefix: "  ",
        prefixStyle: { dim: true },
        style: { dim: true },
        text: "generating patch"
      }
    ]);
    expect(withoutCurrent).toHaveLength(7);
    expect(withoutCurrent.some((line) => line.prefix === "Current:" || line.text === "generating patch")).toBe(false);
  });

  it("statsToLines renders the Current section for an empty action and clips narrow widths", () => {
    expect(
      statsToLines(
        {
          status: "running",
          iterations: 14,
          tokensIn: 12_430,
          tokensOut: 5_982,
          elapsedMs: 92_000,
          currentAction: ""
        },
        0
      )
    ).toEqual([]);

    expect(
      statsToLines(
        {
          status: "running",
          iterations: 14,
          tokensIn: 12_430,
          tokensOut: 5_982,
          elapsedMs: 92_000,
          currentAction: ""
        },
        8
      ).slice(-2)
    ).toEqual([
      { prefix: "Current:", prefixStyle: {}, style: {}, text: "" },
      { prefix: "  ", prefixStyle: { dim: true }, style: { dim: true }, text: "" }
    ]);

    expect(
      statsToLines(
        {
          status: "running",
          iterations: 14,
          tokensIn: 12_430,
          tokensOut: 5_982,
          elapsedMs: 92_000,
          currentAction: "generating patch"
        },
        3
      )
    ).toEqual([
      { prefix: "", prefixStyle: {}, style: { fg: "magenta" }, text: "Run" },
      { prefix: " ", prefixStyle: {}, style: {}, text: "14" },
      { prefix: "", prefixStyle: {}, style: {}, text: "00:" },
      { prefix: "", prefixStyle: {}, style: {}, text: "" },
      { prefix: "", prefixStyle: {}, style: {}, text: "12," },
      { prefix: "", prefixStyle: {}, style: {}, text: "5,9" },
      { prefix: "", prefixStyle: {}, style: {}, text: "18," },
      { prefix: "", prefixStyle: {}, style: {}, text: "" },
      { prefix: "Cur", prefixStyle: {}, style: {}, text: "" },
      {
        prefix: "  ",
        prefixStyle: { dim: true },
        style: { dim: true },
        text: "g"
      }
    ]);
  });

  it("renderStatsPane renders aligned lines into the rect", () => {
    const buffer = new ScreenBuffer(30, 12);
    const rect: Rect = { x: 2, y: 1, width: 25, height: 10 };

    renderStatsPane(buffer, rect, {
      status: "running",
      iterations: 14,
      tokensIn: 12_430,
      tokensOut: 5_982,
      elapsedMs: 92_000,
      currentAction: "generating patch"
    });

    expect(readRow(buffer, 1)).toBe("  Status            Running   ");
    expect(readRow(buffer, 2)).toBe("  Iteration              14   ");
    expect(readRow(buffer, 3)).toBe("  Elapsed          00:01:32   ");
    expect(readRow(buffer, 5)).toBe("  Tokens In          12,430   ");
    expect(readRow(buffer, 6)).toBe("  Tokens Out          5,982   ");
    expect(readRow(buffer, 7)).toBe("  Total              18,412   ");
    expect(readRow(buffer, 9)).toBe("  Current:                    ");
    expect(readRow(buffer, 10)).toBe("    generating patch          ");
    expect(buffer.get(20, 1)).toEqual({ ch: "R", style: { fg: "magenta" } });
    expect(buffer.get(4, 10)).toEqual({ ch: "g", style: { dim: true } });
  });
});

describe("footer", () => {
  const previousPoeCodeTheme = process.env.POE_CODE_THEME;
  const previousPoeTheme = process.env.POE_THEME;

  beforeEach(() => {
    process.env.POE_CODE_THEME = "dark";
    delete process.env.POE_THEME;
    resetThemeCache();
  });

  afterEach(() => {
    if (previousPoeCodeTheme === undefined) {
      delete process.env.POE_CODE_THEME;
    } else {
      process.env.POE_CODE_THEME = previousPoeCodeTheme;
    }

    if (previousPoeTheme === undefined) {
      delete process.env.POE_THEME;
    } else {
      process.env.POE_THEME = previousPoeTheme;
    }

    resetThemeCache();
  });

  it("returns the standard footer hints", () => {
    expect(defaultHints()).toEqual([
      { key: "q", label: "Quit" },
      { key: "e", label: "Edit" },
      { key: "p", label: "Pause" },
      { key: "r", label: "Retry" },
      { key: "↑↓", label: "Scroll" }
    ]);
  });

  it("renders centered hints with the expected spacing", () => {
    const buffer = new ScreenBuffer(20, 1);

    renderFooter(buffer, { x: 0, y: 0, width: 20, height: 1 }, [
      { key: "q", label: "Quit" },
      { key: "e", label: "Edit" }
    ]);

    expect(readRow(buffer, 0)).toBe("   q Quit  e Edit   ");
  });

  it("centers hints within the footer rect vertically and horizontally", () => {
    const buffer = new ScreenBuffer(20, 3);

    renderFooter(buffer, { x: 0, y: 0, width: 20, height: 3 }, [
      { key: "q", label: "Quit" },
      { key: "e", label: "Edit" }
    ]);

    expect(readRow(buffer, 0)).toBe("                    ");
    expect(readRow(buffer, 1)).toBe("   q Quit  e Edit   ");
    expect(readRow(buffer, 2)).toBe("                    ");
  });

  it("truncates overflowing hints with an ellipsis", () => {
    const buffer = new ScreenBuffer(12, 1);

    renderFooter(buffer, { x: 0, y: 0, width: 12, height: 1 }, defaultHints());

    expect(readRow(buffer, 0)).toBe("q Quit  e...");
  });

  it("styles keys with the accent color in bold", () => {
    const buffer = new ScreenBuffer(20, 1);

    renderFooter(buffer, { x: 0, y: 0, width: 20, height: 1 }, [
      { key: "q", label: "Quit" }
    ]);

    expect(buffer.get(7, 0)).toEqual({ ch: "q", style: { fg: "cyan", bold: true } });
    expect(buffer.get(9, 0)).toEqual({ ch: "Q", style: {} });
  });
});

describe("keymap", () => {
  function key(event: Partial<KeypressEvent>): KeypressEvent {
    return {
      ctrl: false,
      meta: false,
      shift: false,
      ...event
    };
  }

  it("resolves default keys to commands", () => {
    const resolve = createKeymap();

    expect(resolve(key({ ch: "q" }))).toBe("quit");
    expect(resolve(key({ ch: "e" }))).toBe("edit");
    expect(resolve(key({ ch: "p" }))).toBe("pause");
    expect(resolve(key({ ch: "r" }))).toBe("retry");
    expect(resolve(key({ name: "up" }))).toBe("scrollUp");
    expect(resolve(key({ ch: "k" }))).toBe("scrollUp");
    expect(resolve(key({ name: "down" }))).toBe("scrollDown");
    expect(resolve(key({ ch: "j" }))).toBe("scrollDown");
    expect(resolve(key({ name: "pageup" }))).toBe("pageUp");
    expect(resolve(key({ name: "pagedown" }))).toBe("pageDown");
    expect(resolve(key({ name: "home" }))).toBe("scrollToTop");
    expect(resolve(key({ ch: "g" }))).toBe("scrollToTop");
    expect(resolve(key({ name: "end" }))).toBe("scrollToBottom");
    expect(resolve(key({ ch: "G", shift: true }))).toBe("scrollToBottom");
  });

  it("resolves ctrl+c to quit", () => {
    const resolve = createKeymap();

    expect(resolve(key({ name: "c", ctrl: true }))).toBe("quit");
  });

  it("returns undefined for unknown keys", () => {
    const resolve = createKeymap();

    expect(resolve(key({ ch: "x" }))).toBeUndefined();
    expect(resolve(key({ name: "left" }))).toBeUndefined();
  });

  it("replaces default bindings with overrides", () => {
    const resolve = createKeymap({
      edit: ["x"],
      quit: ["escape"]
    });

    expect(resolve(key({ ch: "e" }))).toBeUndefined();
    expect(resolve(key({ ch: "x" }))).toBe("edit");
    expect(resolve(key({ ch: "q" }))).toBeUndefined();
    expect(resolve(key({ name: "escape" }))).toBe("quit");
    expect(resolve(key({ name: "c", ctrl: true }))).toBeUndefined();
  });

  it("supports shifted character overrides", () => {
    const resolve = createKeymap({
      scrollToBottom: ["shift+g"]
    });

    expect(resolve(key({ ch: "G", shift: true }))).toBe("scrollToBottom");
  });
});
