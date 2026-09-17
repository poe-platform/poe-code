import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalBuffer } from "terminal-pilot";
import { createDashboard, type DashboardOptions } from "./dashboard.js";
import { withOutputFormat } from "../internal/output-format.js";

afterEach(() => vi.useRealTimers());

function fixture(onSubmit: NonNullable<DashboardOptions["onSubmit"]>) {
  const stdin = Object.assign(new PassThrough(), { setRawMode: vi.fn() });
  const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 32 });
  const terminal = new TerminalBuffer(120, 32);
  stdout.on("data", (chunk) => terminal.write(chunk.toString()));
  const dashboard = createDashboard({
    title: "Pipeline", appearance: "conversation", onSubmit,
    stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream
  });
  dashboard.updateStats({ status: "running", run: { activePlanId: "first", queue: [
    { kind: "plan", id: "first", path: "first.md", status: "running" },
    { kind: "plan", id: "second", path: "second.md", status: "pending" }
  ] } });
  dashboard.start();
  return {
    dashboard, stdout,
    send: (text: string) => stdin.emit("data", Buffer.from(text)),
    screen: () => terminal.displayBuffer.data.map((row) => row.map((cell) => cell?.[1] ?? " ").join("")).join("\n")
  };
}

describe("dashboard live queue input", () => {
  it("freezes the displayed action age while browsing held history and resumes it on Follow", async () => {
    await withOutputFormat("terminal", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(64000);
      const ui = fixture(vi.fn());
      try {
        for (let index = 0; index < 25; index++) ui.dashboard.appendOutput({ kind: "info", text: `Earlier output ${index}`, ts: 0 });
        ui.dashboard.appendOutput({ kind: "tool", role: "action", text: "Run npm test", ts: 1000 });
        ui.dashboard.appendOutput({ kind: "status", text: "Pending review", ts: 1000 });
        ui.send("\u001b");
        vi.advanceTimersByTime(51);
        expect(ui.screen()).toContain("Run npm test · 01:03");
        ui.send("\u001b[A");
        vi.advanceTimersByTime(20);
        vi.advanceTimersByTime(5000);
        ui.dashboard.updateStats({ elapsedMs: 5000 });
        expect(ui.screen()).toContain("Run npm test · 01:03");
        expect(ui.screen()).not.toContain("Run npm test · 01:08");
        ui.send("f");
        expect(ui.screen()).toContain("Run npm test · 01:08");
      } finally { ui.dashboard.destroy(); }
    });
  });

  it("accepts multiple messages while output streams and targets the displayed plan", async () => {
    await withOutputFormat("terminal", async () => {
      const onSubmit = vi.fn();
      const ui = fixture(onSubmit);
      try {
        ui.send("quick review");
        for (let index = 0; index < 20; index++) ui.dashboard.appendOutput({ kind: "tool", text: `Output ${index}`, ts: index });
        ui.send("\r");
        await Promise.resolve();
        await Promise.resolve();
        expect(onSubmit).toHaveBeenNthCalledWith(1, { kind: "message", text: "quick review", afterPlanId: "first" });
        expect(ui.screen()).toContain("Message queued");
        ui.send("verify tests\r");
        await Promise.resolve();
        await Promise.resolve();
        expect(onSubmit).toHaveBeenNthCalledWith(2, { kind: "message", text: "verify tests", afterPlanId: "first" });
      } finally { ui.dashboard.destroy(); }
    });
  });

  it("keeps rejected input editable and allows switching to plan input", async () => {
    await withOutputFormat("terminal", async () => {
      const onSubmit = vi.fn().mockRejectedValueOnce(new Error("Plan file was not found"));
      const ui = fixture(onSubmit);
      try {
        ui.send("\u0010");
        ui.send("missing.md\r");
        await Promise.resolve();
        await Promise.resolve();
        expect(onSubmit).toHaveBeenCalledWith({ kind: "plan", text: "missing.md" });
        expect(ui.screen()).toContain("missing.md");
        expect(ui.screen()).toContain("Plan file was not found");
      } finally { ui.dashboard.destroy(); }
    });
  });

  it.each([false, true])("reports a rejected submission after leaving the TUI (rejected after exit: %s)", async (afterExit) => {
    await withOutputFormat("terminal", async () => {
      let reject!: (error: Error) => void;
      const ui = fixture(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
      ui.send("\u0010missing.md\r");
      if (afterExit) ui.dashboard.destroy();
      reject(new Error("Plan file was not found"));
      await Promise.resolve();
      await Promise.resolve();
      if (!afterExit) ui.dashboard.destroy();
      expect(ui.screen()).toContain("Could not queue plan: Plan file was not found");
      expect(ui.screen().split("Could not queue plan")).toHaveLength(2);
    });
  });

  it("can target a later plan without moving or interrupting the active plan", async () => {
    await withOutputFormat("terminal", async () => {
      const onSubmit = vi.fn();
      const ui = fixture(onSubmit);
      try {
        ui.send("\u001b[1;3B");
        ui.send("Review the second plan\r");
        await Promise.resolve();
        expect(onSubmit).toHaveBeenCalledWith({ kind: "message", text: "Review the second plan", afterPlanId: "second" });
        expect(ui.screen()).toContain("first.md");
      } finally { ui.dashboard.destroy(); }
    });
  });

  it("follows the active plan when an empty message draft is hidden behind plan input", async () => {
    await withOutputFormat("terminal", async () => {
      const onSubmit = vi.fn();
      const ui = fixture(onSubmit);
      try {
        ui.send("\u0010");
        ui.dashboard.updateStats({ run: { activePlanId: "second", queue: [
          { kind: "plan", id: "first", path: "first.md", status: "completed" },
          { kind: "plan", id: "second", path: "second.md", status: "running" }
        ] } });
        ui.send("\u0010Review the current plan\r");
        await Promise.resolve();
        expect(onSubmit).toHaveBeenCalledWith({ kind: "message", text: "Review the current plan", afterPlanId: "second" });
      } finally { ui.dashboard.destroy(); }
    });
  });

  it("preserves the intended target of a nonempty hidden message draft", async () => {
    await withOutputFormat("terminal", async () => {
      const onSubmit = vi.fn();
      const ui = fixture(onSubmit);
      try {
        ui.send("Review this plan\u0010");
        ui.dashboard.updateStats({ run: { activePlanId: "second" } });
        ui.send("\u0010\r");
        await Promise.resolve();
        expect(onSubmit).toHaveBeenCalledWith({ kind: "message", text: "Review this plan", afterPlanId: "first" });
      } finally { ui.dashboard.destroy(); }
    });
  });

  it("retargets a draft from a finished plan to the current plan before later plans", async () => {
    await withOutputFormat("terminal", async () => {
      const onSubmit = vi.fn();
      const ui = fixture(onSubmit);
      try {
        ui.send("Review this plan");
        ui.dashboard.updateStats({ run: { activePlanId: "second", queue: [
          { kind: "plan", id: "first", path: "first.md", status: "completed" },
          { kind: "plan", id: "second", path: "second.md", status: "running" },
          { kind: "plan", id: "third", path: "third.md", status: "pending" }
        ] } });
        ui.send("\u001b[1;3B\r");
        await Promise.resolve();
        expect(onSubmit).toHaveBeenCalledWith({ kind: "message", text: "Review this plan", afterPlanId: "second" });
      } finally { ui.dashboard.destroy(); }
    });
  });

  it("preserves drafts on resize, supports browse mode, and always handles Ctrl+C", async () => {
    await withOutputFormat("terminal", async () => {
      vi.useFakeTimers();
      const onSubmit = vi.fn();
      const ui = fixture(onSubmit);
      const command = vi.fn();
      ui.dashboard.onCommand(command);
      try {
        ui.send("keep this text");
        ui.stdout.columns = 80;
        ui.stdout.emit("resize");
        ui.send("\u001b");
        vi.advanceTimersByTime(51);
        ui.send("i");
        ui.send("\r");
        await Promise.resolve();
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ text: "keep this text" }));
        ui.send("\u0003");
        expect(command).toHaveBeenCalledWith("forceQuit");
      } finally { ui.dashboard.destroy(); }
    });
  });

  it("lets the user scroll through all tasks without scrolling the transcript", async () => {
    await withOutputFormat("terminal", async () => {
      vi.useFakeTimers();
      const ui = fixture(vi.fn());
      try {
        ui.dashboard.updateStats({ run: { activePlanId: "first", tasks: Array.from({ length: 60 }, (_, index) => ({
          id: `task-${index}`, title: `Task ${index + 1}`, status: "pending" as const
        })) } });
        ui.dashboard.appendOutput({ kind: "info", role: "agent", text: "Current agent message", ts: 0 });
        ui.send("\u001b");
        vi.advanceTimersByTime(51);
        ui.send("v");
        expect(ui.screen()).toContain("Task 1");
        for (let index = 0; index < 8; index++) ui.send("\u001b[6~");
        vi.advanceTimersByTime(20);
        expect(ui.screen()).toContain("Task 60");
        ui.send("v");
        expect(ui.screen()).toContain("Current agent message");
      } finally { ui.dashboard.destroy(); }
    });
  });

  it("opens the work list at the active task and returns there with Follow", async () => {
    await withOutputFormat("terminal", async () => {
      vi.useFakeTimers();
      const ui = fixture(vi.fn());
      try {
        ui.dashboard.updateStats({ run: { activeTaskId: "task-39", activeStep: "verify", tasks: Array.from({ length: 60 }, (_, index) => ({
          id: `task-${index}`, title: `Task ${index + 1}`, status: index < 39 ? "completed" as const : "pending" as const,
          steps: [{ name: "implement", status: "completed" as const }, { name: "verify", status: "pending" as const }]
        })) } });
        ui.send("\u001b");
        vi.advanceTimersByTime(51);
        ui.send("v");
        expect(ui.screen()).toContain("40. Task 40");
        expect(ui.screen()).toContain("› verify");
        ui.send("\u001b[H");
        expect(ui.screen()).toContain("1. Task 1");
        ui.dashboard.updateStats({ elapsedMs: 1000 });
        vi.advanceTimersByTime(20);
        expect(ui.screen()).not.toContain("40. Task 40");
        ui.send("f");
        expect(ui.screen()).toContain("40. Task 40");
        ui.send("\u001b[F");
        expect(ui.screen()).toContain("60. Task 60");
        ui.send("vv");
        expect(ui.screen()).toContain("40. Task 40");
      } finally { ui.dashboard.destroy(); }
    });
  });

  it("focuses the running message ahead of completed plan tasks", async () => {
    await withOutputFormat("terminal", async () => {
      vi.useFakeTimers();
      const ui = fixture(vi.fn());
      try {
        ui.dashboard.updateStats({ run: { activePlanId: "first", queue: [
          { kind: "plan", id: "first", path: "first.md", status: "completed" },
          ...Array.from({ length: 50 }, (_, index) => ({
            kind: "message" as const, id: `message-${index}`, afterPlanId: "first", text: `Follow-up ${index + 1}`,
            status: index < 37 ? "completed" as const : index === 37 ? "running" as const : "pending" as const
          })),
          { kind: "plan", id: "second", path: "second.md", status: "pending" }
        ] } });
        ui.send("\u001b");
        vi.advanceTimersByTime(51);
        ui.send("v");
        expect(ui.screen()).toContain("›   └ Follow-up 38");
        expect(ui.screen()).toContain("After first.md");
        ui.send("\u001b[H");
        expect(ui.screen()).not.toContain("Follow-up 38");
        ui.send("f");
        expect(ui.screen()).toContain("›   └ Follow-up 38");
      } finally { ui.dashboard.destroy(); }
    });
  });
});
