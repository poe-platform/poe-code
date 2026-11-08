import { expect, it } from "vitest";
import { ScreenBuffer } from "../buffer.js";
import { renderContextPane } from "./context-pane.js";

it("wraps the active plan and preserves queue order above the scrolling output", () => {
  const buffer = new ScreenBuffer(40, 12);
  const remaining = renderContextPane(buffer, { x: 0, y: 0, width: 40, height: 12 }, [
    "Plan 1/3: docs/plans/improve-pipeline-progress.md",
    "Next 2/3: second.md", "Next 3/3: third.md"
  ]);
  const rows = Array.from({ length: remaining.y }, (_, y) => Array.from({ length: 40 }, (_, x) => buffer.get(x, y).ch).join("").trim());
  expect(rows.join(" ")).toContain("improve-pipeline-progress.md");
  expect(rows.join(" ")).toContain("Next 2/3: second.md Next 3/3: third.md");
  expect(remaining.height).toBeGreaterThan(0);
});

it("signals hidden queue entries and leaves space for output in short terminals", () => {
  const buffer = new ScreenBuffer(40, 4);
  const remaining = renderContextPane(buffer, { x: 0, y: 0, width: 40, height: 4 }, ["Plan: first.md", ...Array.from({ length: 20 }, (_, i) => `Next: ${i}.md`)]);
  expect(remaining.height).toBeGreaterThan(0);
  expect(Array.from({ length: 40 }, (_, x) => buffer.get(x, remaining.y - 1).ch).join("")).toContain("more plans");
});

it("does not claim hidden queued plans when only the active filename overflows", () => {
  const buffer = new ScreenBuffer(30, 4);
  const remaining = renderContextPane(buffer, { x: 0, y: 0, width: 30, height: 4 }, ["Plan 1/1: docs/plans/improve-restart-progress-and-task-counts.md"]);
  const text = Array.from({ length: remaining.y }, (_, y) => Array.from({ length: 30 }, (_, x) => buffer.get(x, y).ch).join("")).join(" ");
  expect(text).not.toContain("more plans");
  expect(text).toContain("improve");
  expect(text).toContain("…");
});

it("includes the active filename when only one context row fits", () => {
  const buffer = new ScreenBuffer(48, 2);
  renderContextPane(buffer, { x: 0, y: 0, width: 48, height: 2 }, ["Plan 1/3: docs/plans/improve-pipeline-task-counts-and-restart-progress.md"]);
  expect(Array.from({ length: 48 }, (_, x) => buffer.get(x, 0).ch).join("")).toContain("docs/plans/improve");
});
