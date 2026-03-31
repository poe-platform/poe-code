import { describe, expect, it } from "vitest";
import { TerminalScreen } from "./terminal-screen.js";

describe("TerminalScreen", () => {
  it("strips ANSI sequences from visible lines and preserves raw lines", () => {
    const screen = new TerminalScreen({
      lines: ["\x1b[32mready\x1b[0m", "plain"],
      rawLines: ["\x1b[32mready\x1b[0m", "plain"],
      cursor: { row: 1, col: 5 },
      size: { rows: 24, cols: 80 }
    });

    expect(screen.lines).toEqual(["ready", "plain"]);
    expect(screen.rawLines).toEqual(["\x1b[32mready\x1b[0m", "plain"]);
  });

  it("joins visible lines into text", () => {
    const screen = new TerminalScreen({
      lines: ["first", "second", "third"],
      rawLines: ["first", "second", "third"],
      cursor: { row: 2, col: 0 },
      size: { rows: 3, cols: 10 }
    });

    expect(screen.text).toBe("first\nsecond\nthird");
  });

  it("supports positive and negative line indexing", () => {
    const screen = new TerminalScreen({
      lines: ["top", "middle", "bottom"],
      rawLines: ["top", "middle", "bottom"],
      cursor: { row: 0, col: 0 },
      size: { rows: 3, cols: 10 }
    });

    expect(screen.line(0)).toBe("top");
    expect(screen.line(1)).toBe("middle");
    expect(screen.line(-1)).toBe("bottom");
    expect(screen.line(-2)).toBe("middle");
    expect(screen.line(-3)).toBe("top");
  });

  it("throws for out-of-bounds line indexes", () => {
    const screen = new TerminalScreen({
      lines: ["only"],
      rawLines: ["only"],
      cursor: { row: 0, col: 0 },
      size: { rows: 1, cols: 10 }
    });

    expect(() => screen.line(1)).toThrow(RangeError);
    expect(() => screen.line(-2)).toThrow(RangeError);
  });

  it("checks whether the visible text contains a substring", () => {
    const screen = new TerminalScreen({
      lines: ["build", "completed successfully"],
      rawLines: ["build", "completed successfully"],
      cursor: { row: 1, col: 10 },
      size: { rows: 2, cols: 40 }
    });

    expect(screen.contains("completed")).toBe(true);
    expect(screen.contains("build\ncompleted")).toBe(true);
    expect(screen.contains("failed")).toBe(false);
  });

  it("creates an immutable snapshot that does not track later input mutations", () => {
    const lines = ["\x1b[36mhello\x1b[0m", "world"];
    const rawLines = ["\x1b[36mhello\x1b[0m", "world"];
    const cursor = { row: 1, col: 3 };
    const size = { rows: 2, cols: 20 };

    const screen = new TerminalScreen({ lines, rawLines, cursor, size });

    lines[0] = "changed";
    rawLines[0] = "changed";
    cursor.row = 99;
    size.cols = 120;

    expect(screen.lines).toEqual(["hello", "world"]);
    expect(screen.rawLines).toEqual(["\x1b[36mhello\x1b[0m", "world"]);
    expect(screen.cursor).toEqual({ row: 1, col: 3 });
    expect(screen.size).toEqual({ rows: 2, cols: 20 });

    expect(Object.isFrozen(screen.lines)).toBe(true);
    expect(Object.isFrozen(screen.rawLines)).toBe(true);
    expect(Object.isFrozen(screen.cursor)).toBe(true);
    expect(Object.isFrozen(screen.size)).toBe(true);

    expect(() => {
      screen.lines[0] = "mutated";
    }).toThrow(TypeError);
    expect(() => {
      screen.cursor.row = 7;
    }).toThrow(TypeError);
  });
});
