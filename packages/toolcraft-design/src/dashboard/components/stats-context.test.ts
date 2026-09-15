import { describe, expect, it } from "vitest";
import { renderStatsPane, statsToLines } from "./stats-pane.js";
import { ScreenBuffer } from "../buffer.js";
import { displayWidth } from "../terminal-width.js";
import type { DashboardStats } from "../types.js";

const stats: DashboardStats = {
  status: "running",
  iterations: 2,
  tokensIn: 100,
  tokensOut: 200,
  elapsedMs: 5000
};

describe("persistent task context", () => {
  it("keeps the active stage visible ahead of secondary metrics in short panes", () => {
    const buffer = new ScreenBuffer(40, 3);
    renderStatsPane(
      buffer,
      { x: 0, y: 0, width: 40, height: 3 },
      {
        ...stats,
        currentAction: "Task 2/8 failed (implement)"
      }
    );
    const rows = Array.from({ length: 3 }, (_, y) =>
      Array.from({ length: 40 }, (_, x) => buffer.get(x, y).ch).join("")
    );
    expect(rows[0]).toContain("Running");
    expect(rows[1]).toContain("Task 2/8 failed (implement)");
    expect(rows[2]).toContain("Iteration");
  });

  it("signals when short panes cannot fit the complete current action", () => {
    const buffer = new ScreenBuffer(15, 2);
    renderStatsPane(
      buffer,
      { x: 0, y: 0, width: 15, height: 2 },
      {
        ...stats,
        currentAction: "Improve streaming output (implement)"
      }
    );
    const row = Array.from({ length: 15 }, (_, x) => buffer.get(x, 1).ch).join("");
    expect(row).toContain("Improve");
    expect(row).toContain("…");
  });

  it("wraps long current actions instead of silently discarding the stage", () => {
    const action = "Improve streaming output (implement)";
    for (const width of [15, 25, 32]) {
      const lines = statsToLines({ ...stats, currentAction: action }, width).slice(9);
      expect(lines.map((line) => line.text).join(" ")).toBe(action);
      expect(lines.every((line) => displayWidth(line.prefix + line.text) <= width)).toBe(true);
    }
  });

  it("retains action text even when only one text cell fits", () => {
    const lines = statsToLines({ ...stats, currentAction: "review" }, 3).slice(9);
    expect(lines.map((line) => line.text).join("")).toBe("review");
    expect(lines.every((line) => displayWidth(line.prefix + line.text) <= 3)).toBe(true);
  });

  it("aligns wide task labels using terminal cells", () => {
    const line = statsToLines({ ...stats, iterationsLabel: "任务" }, 15)[1]!;
    expect(displayWidth(line.prefix + line.text)).toBe(15);
  });

  it("keeps combining and emoji graphemes intact while wrapping", () => {
    const action = "界界 👩‍💻 é (review)";
    const lines = statsToLines({ ...stats, currentAction: action }, 10).slice(9);
    expect(lines.map((line) => line.text).join(" ")).toBe(action);
    expect(lines.every((line) => displayWidth(line.prefix + line.text) <= 10)).toBe(true);
  });
});
