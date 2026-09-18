import { describe, expect, it, vi } from "vitest";
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
  it.each([40, 60, 80, 140])("preserves output, input, and controls in a short terminal at %s columns", (width) => {
    const { rows, result } = screen(width, 12, {
      output: [{ kind: "info", role: "agent", text: "Latest result", ts: 0 }],
      composer: { ...createComposerState("message", "first"), text: "Review this result", cursor: 18 }
    });
    expect(result.outputRect.height).toBeGreaterThan(0);
    expect(rows.join("\n")).toContain("Latest result");
    expect(rows.join("\n")).toContain("7/30 tasks");
    expect(rows[result.cursor!.y]).toContain("Review this result");
    const target = rows.find((row) => row.includes("AFTER "))!;
    expect(target.trim()).toBe("AFTER docx-release.md");
    expect(rows.join("\n")).toContain("Usage unavailable");
    expect(rows.slice(-3).join("\n")).toContain("Esc Browse");
    expect(result.outputRect.y + result.outputRect.height).toBeLessThan(result.cursor!.y);
  });

  it("keeps the edited line and validation error separate in a short terminal", () => {
    const text = "First line\nSecond line\nEdited line";
    const { rows, result } = screen(60, 12, {
      output: [{ kind: "info", role: "agent", text: "Latest result", ts: 0 }],
      composer: { ...createComposerState("message", "first"), text, cursor: text.length, error: "Plan file was not found" }
    });
    expect(rows[result.cursor!.y]).toContain("Edited line");
    expect(rows[result.cursor!.y + 1]).toContain("Plan file was not found");
    expect(rows.join("\n")).toContain("Latest result");
    expect(rows.slice(-2).join("\n")).toContain("Esc Browse");
  });

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

  it("shows live action age during a run without applying a ticking clock to a finished view", () => {
    const output = [{ role: "action" as const, kind: "tool" as const, text: "Run npm test", ts: 1000 }];
    expect(screen(80, 24, { output, now: 64000 }).text).toContain("Run npm test · 01:03");
    expect(screen(80, 24, { output, now: 64000, stats: { ...stats, status: "done" } }).text).not.toContain("01:03");
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

  it("keeps the current step and task progress visible beside a long task title at 80 columns", () => {
    const { rows } = screen(80, 24, { stats: {
      ...stats, run: { ...stats.run, phase: "Preserve document formatting and validate all package relationships", activeStep: "implement" }
    } });
    const phase = rows.find((row) => row.includes("●"))!;
    expect(phase).toContain("implement");
    expect(phase).toContain("7/30 tasks");
  });

  it("keeps quit and detail controls legible in the compact browse footer", () => {
    const { rows } = screen(80, 24, { composer: { ...createComposerState("message", "first"), focused: false } });
    expect(rows.at(-1)).toContain("d Details");
    expect(rows.at(-1)).toContain("q Quit");
    expect(rows.at(-1)).not.toContain("…");
  });

  it.each([true, false])("wraps complete composer and browse shortcuts at 60 columns (editing: %s)", (focused) => {
    const { rows, result } = screen(60, 20, { composer: { ...createComposerState("message", "first"), focused } });
    const footer = rows.slice(-2).join("\n");
    expect(footer).toContain(focused ? "Esc Browse" : "q Quit");
    expect(footer).toContain(focused ? "Alt+↑↓ Target" : "f Follow");
    expect(footer).not.toContain("…");
    expect(result.cursor?.y ?? 0).toBeLessThan(18);
    expect(result.outputRect.y + result.outputRect.height).toBeLessThan(18);
  });

  it("wraps custom harness controls without hiding the final shortcuts", () => {
    const hints = [
      { key: "i", label: "Message" }, { key: "p", label: "Add plan" }, { key: "v", label: "Tasks & plans" },
      { key: "Space", label: "Pause" }, { key: "q", label: "Quit" }, { key: "e", label: "Edit" },
      { key: "l", label: "Log" }, { key: "↑↓", label: "Scroll" }, { key: "F", label: "Follow" }
    ];
    const { rows } = screen(80, 24, { hints, composer: { ...createComposerState("message", "first"), focused: false } });
    const footer = rows.slice(-2).join("\n");
    for (const hint of hints) expect(footer).toContain(`${hint.key} ${hint.label}`);
    expect(footer).not.toContain("…");
  });

  it("shows the return-to-current-work shortcut in the full list", () => {
    const { text } = screen(80, 24, { showQueue: true, composer: undefined });
    expect(text).toContain("f Current");
    expect(text).toContain("q Quit");
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

  it("keeps the active follow-up and its plan visible in a long message queue", () => {
    const { text } = screen(120, 32, { stats: {
      ...stats, run: { ...stats.run, queue: [
        { kind: "plan", id: "first", path: "docs/plans/release.md", status: "completed" },
        ...Array.from({ length: 25 }, (_, index) => ({
          kind: "message" as const, id: `message-${index}`, afterPlanId: "first", text: `Follow-up ${index + 1}`,
          status: index < 17 ? "completed" as const : index === 17 ? "running" as const : "pending" as const
        })),
        { kind: "plan", id: "second", path: "docs/plans/next.md", status: "pending" }
      ] }
    } });
    expect(text).toContain("›   └ Follow-up 18");
    expect(text).toContain("release.md");
    expect(text).toContain("more queued work");
  });

  it.each(["Follow-up", "Cancelling"])("shows the follow-up position for its own plan without hiding %s", (phase) => {
    const { text } = screen(80, 24, { stats: {
      ...stats, run: { ...stats.run, phase, queue: [
        { kind: "plan", id: "first", path: "release.md", status: "completed" },
        { kind: "message", id: "one", afterPlanId: "first", text: "Review", status: "completed" },
        { kind: "message", id: "two", afterPlanId: "first", text: "Verify", status: "running" },
        { kind: "message", id: "three", afterPlanId: "first", text: "Summarize", status: "pending" },
        { kind: "plan", id: "second", path: "next.md", status: "pending" },
        { kind: "message", id: "four", afterPlanId: "second", text: "Review next", status: "pending" }
      ] }
    } });
    expect(text).toContain(phase === "Follow-up" ? "Follow-up 2/3" : "Cancelling");
    expect(text).not.toContain("Follow-up 2/4");
  });

  it("keeps progress visible when the active command is long", () => {
    const { rows } = screen(80, 24, { stats: {
      ...stats, run: { ...stats.run, activity: `Run npm test ${"very-long-option ".repeat(8)}` }
    } });
    const phase = rows.find((row) => row.includes("●"))!;
    expect(phase).toContain("Setup");
    expect(phase).toContain("7/30 tasks");
    expect(phase).toContain("Run npm test");
  });

  it("shows workspace-relative plan paths and full work-list navigation hints", () => {
    const { text } = screen(100, 30, {
      showQueue: true, composer: undefined, hints: [{ key: "Space", label: "Pause" }],
      stats: { ...stats, run: { ...stats.run, cwd: "/workspace/project", queue: [
        { kind: "plan", id: "first", path: "/workspace/project/docs/plans/release.md", status: "running" },
        { kind: "plan", id: "second", path: "/workspace/project-other/plan.md", status: "pending" }
      ] } }
    });
    expect(text).toContain("1. docs/plans/release.md");
    expect(text).toContain("2. /workspace/project-other/plan.md");
    expect(text).toContain("Home/End Jump");
  });

  it("retains the parent plan while scrolling through messages in the full list", () => {
    const { text } = screen(80, 24, {
      showQueue: true, workOffset: 8, composer: undefined,
      stats: { ...stats, run: { ...stats.run, queue: [
        { kind: "plan", id: "first", path: "docs/plans/release.md", status: "running" },
        { kind: "plan", id: "second", path: "docs/plans/next.md", status: "pending" },
        ...Array.from({ length: 25 }, (_, index) => ({
          kind: "message" as const, id: `message-${index}`, afterPlanId: "second", text: `Follow-up ${index + 1}`, status: "pending" as const
        }))
      ] } }
    });
    expect(text).toContain("↑ earlier · After docs/plans/next.md");
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

  it("formats only visible task titles and steps in a large work list", () => {
    let titleReads = 0;
    let stepReads = 0;
    const tasks = Array.from({ length: 3000 }, (_, index) => ({
      id: `task-${index}`, status: "pending" as const,
      get title() { titleReads++; return `Task ${index + 1}`; },
      steps: ["implement", "verify"].map((name) => ({
        status: "pending" as const, get name() { stepReads++; return name; }
      }))
    }));
    const { text } = screen(80, 24, { showQueue: true, workOffset: 4500, composer: undefined,
      stats: { ...stats, run: { ...stats.run, tasks } }
    });
    expect(text).toContain("implement");
    expect(text).toContain("verify");
    expect(titleReads).toBeLessThan(30);
    expect(stepReads).toBeLessThan(30);
  });

  it("formats only visible messages in a large queue", () => {
    let reads = 0;
    const { text } = screen(80, 24, { showQueue: true, workOffset: 1500, composer: undefined,
      stats: { ...stats, run: { ...stats.run, queue: [
        { kind: "plan", id: "first", path: "docs/plans/release.md", status: "running" },
        ...Array.from({ length: 3000 }, (_, index) => ({
          kind: "message" as const, id: `message-${index}`, afterPlanId: "first", status: "pending" as const,
          get text() { reads++; return `Follow-up ${index + 1}`; }
        }))
      ] } }
    });
    expect(text).toContain("Follow-up 1499");
    expect(text).toContain("After docs/plans/release.md");
    expect(reads).toBeLessThan(20);
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

  it("reuses an unchanged draft layout while output streams and invalidates it after editing or resizing", () => {
    const text = "Review 👩‍💻 document changes\n".repeat(50);
    const composer = { ...createComposerState("message", "first"), text, cursor: text.length };
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    const measurements = () => segment.mock.calls.filter(([value]) => value === text).length;
    try {
      screen(80, 24, { composer });
      screen(80, 24, { composer, output: [{ kind: "info", text: "Streaming progress", ts: 0 }] });
      expect(measurements()).toBe(1);
      const resized = screen(100, 24, { composer });
      expect(measurements()).toBe(2);
      composer.cursor = 0;
      const moved = screen(100, 24, { composer });
      expect(measurements()).toBe(3);
      expect(moved.result.cursor?.y).toBeLessThan(resized.result.cursor?.y ?? 24);
      composer.text = "Updated draft";
      composer.cursor = composer.text.length;
      expect(screen(100, 24, { composer }).text).toContain("Updated draft");
    } finally { segment.mockRestore(); }
  });
});
