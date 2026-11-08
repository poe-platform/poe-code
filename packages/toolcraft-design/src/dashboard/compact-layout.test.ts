import { describe, expect, it } from "vitest";
import { computeDashboardLayout } from "./layout.js";
import { renderDashboardSnapshot } from "./snapshot.js";
import { ScreenBuffer } from "./buffer.js";
import { renderCompactStatsPane } from "./components/stats-pane.js";
import { TerminalBuffer } from "terminal-pilot";

function screen(ansi: string, width: number, height: number): string[] {
  const terminal = new TerminalBuffer(width, height);
  terminal.write("\u001b[?7l" + ansi.replaceAll("\n", "\r\n"));
  return terminal.displayBuffer.data.map((row) =>
    Array.from({ length: width }, (_, x) => row?.[x]?.[1] ?? " ").join("")
  );
}

describe("compact dashboard", () => {
  it("renders decorated multiline context as safe plain summary text", () => {
    const buffer = new ScreenBuffer(30, 2);
    renderCompactStatsPane(
      buffer,
      { x: 0, y: 0, width: 30, height: 2 },
      {
        status: "running",
        iterations: 0,
        tokensIn: 0,
        tokensOut: 0,
        elapsedMs: 0,
        currentAction: "\u001b[31mReview\u001b[0m\n界"
      }
    );
    const row = Array.from({ length: 30 }, (_, x) => buffer.get(x, 1).ch).join("");
    expect(row.trimEnd()).toBe("Review 界");
  });

  it("gives narrow logs the full interior width", () => {
    const layout = computeDashboardLayout({ totalWidth: 50, totalHeight: 16, rightPaneWidth: 32 });
    expect(layout.leftPane.width).toBe(48);
    expect(layout.rightPane.width).toBe(0);
    expect(layout.leftPane.height).toBeGreaterThan(8);
  });

  it("keeps task context and readable logs together at 50 columns", () => {
    const lines = screen(
      renderDashboardSnapshot({
        width: 50,
        height: 16,
        title: "Pipeline",
        items: [{ kind: "error", text: "Expected task result, received empty output", ts: 0 }],
        stats: {
          status: "error",
          iterations: 1,
          iterationsLabel: "Tasks",
          tokensIn: 137,
          tokensOut: 89,
          elapsedMs: 1000,
          currentAction: "Task 2/8 failed (implement)"
        }
      }),
      50,
      16
    );
    expect(lines.some((line) => line.includes("Task 2/8 failed (implement)"))).toBe(true);
    expect(lines.some((line) => line.includes("Expected task result, received empty output"))).toBe(
      true
    );
    expect(lines.every((line) => line.length === 50)).toBe(true);
  });
});
