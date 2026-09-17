import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../buffer.js";
import { createComposerState } from "../composer.js";
import { renderRunView } from "./run-view.js";
import type { DashboardStats } from "../types.js";

const stats: DashboardStats = {
  status: "running", iterations: 7, tokensIn: 0, tokensOut: 0, elapsedMs: 19366000,
  usageAvailable: false,
  currentAction: "Setup",
  run: {
    agent: "codex", phase: "Setup", activity: "Read validation.ts", activePlanId: "first",
    queue: [
      { kind: "plan", id: "first", path: "docs/plans/docx-release.md", status: "running" },
      { kind: "message", id: "review", afterPlanId: "first", text: "Review public API", status: "pending" },
      { kind: "plan", id: "second", path: "docs/plans/docx-typescript-safe-bash.md", status: "pending" }
    ],
    tasks: Array.from({ length: 30 }, (_, index) => ({
      id: `task-${index}`, title: `Release task ${index + 1}`, status: index < 7 ? "completed" : "pending"
    }))
  }
};

function screen(width: number, height: number, overrides: Partial<Parameters<typeof renderRunView>[1]> = {}) {
  const buffer = new ScreenBuffer(width, height);
  const result = renderRunView(buffer, {
    title: "Pipeline", stats, output: [], scrollOffset: 0,
    composer: createComposerState("message", "first"), ...overrides
  });
  const rows = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => buffer.get(x, y).ch).join(""));
  return { result, text: rows.join("\n"), rows };
}

describe("run dashboard information hierarchy", () => {
  it("renders readable conversation blocks and keeps raw action detail collapsed", () => {
    const output = [
      { kind: "info" as const, role: "agent" as const, text: "The release checks are passing.", ts: 0 },
      { kind: "tool" as const, role: "action" as const, text: "Read validation.ts", detail: "/bin/zsh -lc 'cat src/validation.ts'", ts: 1 }
    ];
    const collapsed = screen(80, 24, { output }).text;
    expect(collapsed).toContain("•  The release checks are passing.");
    expect(collapsed).toContain("›  Read validation.ts");
    expect(collapsed).not.toContain("/bin/zsh");
    expect(screen(80, 24, { output, showDetails: true }).text).toContain("/bin/zsh");
  });

  it("separates a long setup from agent activity, task progress, and the plan sequence", () => {
    const { text } = screen(140, 36);
    expect(text).toContain("Setup");
    expect(text).toContain("Read validation.ts");
    expect(text).toContain("7/30");
    expect(text).toContain("docx-release.md");
    expect(text).toContain("docx-typescript-safe-bash.md");
    expect(text).toContain("Review public API");
    expect(text).toContain("Release task 8");
    expect(text).toContain("Usage unavailable");
    expect(text).not.toContain("0 tokens");
  });

  it("keeps the composer, current plan, and next plan visible on a small terminal", () => {
    const { text, result } = screen(80, 24);
    expect(text).toContain("docx-release.md");
    expect(text).toContain("docx-typescript-safe-bash.md");
    expect(text).toContain("Queue a message");
    expect(result.cursor?.y).toBeLessThan(24);
    expect(result.cursor?.x).toBeLessThan(80);
  });

  it("marks hidden tasks in the sidebar and keeps the active task visible", () => {
    const { text } = screen(120, 32, { stats: {
      ...stats, run: { ...stats.run, activeTaskId: "task-7", activeStep: "implement",
        tasks: stats.run!.tasks!.map((task, index) => index === 7 ? {
          ...task, steps: [{ name: "implement", status: "running" }, { name: "verify", status: "pending" }]
        } : task)
      }
    } });
    expect(text).toContain("› 8. Release task 8");
    expect(text).toContain("› implement");
    expect(text).toContain("↓ more tasks · v View all");
  });

  it("shows a full task and plan view when the compact terminal switches views", () => {
    const { text } = screen(80, 24, { showQueue: true });
    expect(text).toContain("PLANS");
    expect(text).toContain("TASKS");
    expect(text).toContain("Release task 1");
    expect(text).toContain("more tasks and plans");
  });

  it("gives the work list space while browsing and restores the editor when focused", () => {
    const composer = { ...createComposerState("message", "first"), focused: false, text: "Preserved draft" };
    const browsing = screen(80, 24, { showQueue: true, composer });
    const editing = screen(80, 24, { showQueue: true, composer: { ...composer, focused: true } });
    expect(browsing.result.outputRect.height).toBeGreaterThan(editing.result.outputRect.height);
    expect(editing.text).toContain("Preserved draft");
  });

  it("labels the shortcut for switching from plan input back to messages", () => {
    expect(screen(80, 24, { composer: createComposerState("plan") }).text).toContain("Ctrl+P Message");
  });

  it("shows harness controls while browsing without replacing editor shortcuts", () => {
    const composer = { ...createComposerState("message", "first"), focused: false };
    const hints = [{ key: "Space", label: "Pause" }, { key: "e", label: "Edit" }, { key: "l", label: "Log" }];
    expect(screen(120, 32, { composer, hints }).text).toContain("Space Pause  e Edit  l Log");
    expect(screen(120, 32, { composer: { ...composer, focused: true }, hints }).text).toContain("Enter Queue");
  });

  it("uses a pause marker for a stopped run with pending work", () => {
    const { text } = screen(80, 24, { stats: { ...stats, status: "paused", run: { ...stats.run, phase: "Paused", activity: undefined } } });
    expect(text).toContain("Ⅱ Paused");
    expect(text).not.toContain("✓ Paused");
  });

  it("shows queue confirmation and pending message counts in compact mode", () => {
    const { text } = screen(80, 24, { feedback: "Message queued" });
    expect(text).toContain("Message queued");
    expect(text).toContain("1 message queued");
  });

  it("shows the tail of long work lists with an explicit earlier-items marker", () => {
    const { text, result } = screen(140, 36, { showQueue: true, workOffset: 999 });
    expect(text).toContain("Release task 30");
    expect(text).toContain("earlier");
    expect(result.workOffset).toBeLessThan(999);
  });

  it("keeps a multiline draft and its cursor visible at the end of long input", () => {
    const composer = createComposerState("message", "first");
    composer.text = "Follow-up line\n".repeat(20) + "Check the final result";
    composer.cursor = composer.text.length;
    const { text, result } = screen(80, 24, { composer });
    expect(text).toContain("Check the final result");
    expect(result.cursor?.y).toBeLessThan(24);
    expect(result.cursor?.x).toBeLessThan(80);
  });
});
