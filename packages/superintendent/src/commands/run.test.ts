import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { SuperintendentFileSystem } from "../runtime/loop.js";
import type { Dashboard } from "@poe-code/design-system";

function createDoc(builderAgent: string): string {
  return [
    "---",
    "kind: superintendent",
    "version: 1",
    "builder:",
    `  agent: ${builderAgent}`,
    "  prompt: |",
    "    Build {{plan.path}}",
    "superintendent:",
    "  agent: claude-code",
    "  prompt: |",
    "    Review {{builder.summary}}",
    "owner:",
    "  agent: claude-code",
    "  prompt: |",
    "    Review {{superintendent.summary}}",
    "status:",
    "  state: in_progress",
    "  round: 0",
    "  review_turn: 0",
    "---",
    "# Plan",
    "",
    "## Task Board",
    "",
    "- [ ] Task",
    ""
  ].join("\n");
}

type TestFs = SuperintendentFileSystem;

function createFs(files: Record<string, string>): TestFs {
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  return {
    readFile: (filePath: string, encoding: BufferEncoding) =>
      rawFs.readFile(filePath, encoding) as Promise<string>,
    writeFile: async (filePath: string, content: string) => {
      await rawFs.mkdir(path.dirname(filePath), { recursive: true });
      await rawFs.writeFile(filePath, content, { encoding: "utf8" });
    },
    readdir: (filePath: string) => rawFs.readdir(filePath) as Promise<string[]>,
    stat: async (filePath: string) => {
      const stat = await rawFs.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: Number(stat.mtimeMs)
      };
    },
    mkdir: async (filePath: string, options?: { recursive?: boolean }) => {
      await rawFs.mkdir(filePath, options);
    },
    rmdir: async (filePath: string) => {
      await rawFs.rmdir(filePath);
    },
    rename: async (oldPath: string, newPath: string) => {
      await rawFs.mkdir(path.dirname(newPath), { recursive: true });
      await rawFs.rename(oldPath, newPath);
    }
  };
}

function createDashboardMock(): {
  dashboard: Dashboard;
  appendOutput: ReturnType<typeof vi.fn>;
  updateStats: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  onCommand: ReturnType<typeof vi.fn>;
} {
  const appendOutput = vi.fn();
  const updateStats = vi.fn();
  const start = vi.fn();
  const stop = vi.fn();
  const destroy = vi.fn();
  const onCommand = vi.fn();

  return {
    dashboard: {
      appendOutput,
      updateStats,
      start,
      stop,
      destroy,
      onCommand
    },
    appendOutput,
    updateStats,
    start,
    stop,
    destroy,
    onCommand
  };
}

const expectedTimestamp = (() => {
  const date = new Date(0);
  return `[${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}]`;
})();

describe("superintendent run command", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("uses discovered defaults with --yes and skips the pre-dashboard prompts", async () => {
    const fs = createFs({
      "/repo/.poe-code/superintendent/b-plan.md": createDoc("codex"),
      "/repo/.poe-code/superintendent/a-plan.md": createDoc("claude-code")
    });
    const selectPrompt = vi.fn();
    const dashboardMock = createDashboardMock();
    const runLoopMock = vi.fn(async () => ({
      state: "completed" as const,
      round: 0,
      reviewTurn: 0,
      maxRounds: 100,
      maxReviewTurns: 5,
      stopReason: "completed" as const
    }));

    const { runSuperintendentCommand } = await import("./run.js");
    const result = await runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      assumeYes: true,
      interactive: true,
      useDashboard: true,
      fs,
      selectPrompt,
      createDashboard: () => dashboardMock.dashboard,
      runLoop: runLoopMock,
      now: () => 0,
      setInterval: (() => 0) as typeof global.setInterval,
      clearInterval: vi.fn(),
      openInEditor: vi.fn(),
      env: {}
    });

    expect(selectPrompt).not.toHaveBeenCalled();
    expect(runLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        docPath: "/repo/.poe-code/superintendent/a-plan.md"
      })
    );
    expect(result).toMatchObject({
      docPath: "/repo/.poe-code/superintendent/a-plan.md",
      builderAgent: "claude-code",
      stopReason: "completed"
    });
  });

  it("wires loop callbacks to the dashboard", async () => {
    const fs = createFs({
      "/repo/.poe-code/superintendent/plan.md": createDoc("claude-code")
    });
    const dashboardMock = createDashboardMock();
    const runLoopMock = vi.fn(async (options: { callbacks?: {
      onStateChange?: (state: { state: "in_progress" | "review" | "completed"; round: number; reviewTurn: number; maxRounds: number; maxReviewTurns: number }) => void;
      onBuilderStart?: () => void;
      onBuilderComplete?: (result: { summary: string; log: string }) => void;
      onInspectorStart?: (name: string) => void;
      onInspectorComplete?: (result: { name: string; summary: string }) => void;
      onSuperintendentStart?: () => void;
      onSuperintendentComplete?: (result: { summary: string; transition: { action: "request_review"; summary: string } }) => void;
      onOwnerStart?: () => void;
      onOwnerComplete?: (result: { transition: { action: "approve_completion" } }) => void;
      onRoundComplete?: (round: number) => void;
      onLoopComplete?: (result: { state: "completed"; round: number; reviewTurn: number; maxRounds: number; maxReviewTurns: number; stopReason: "completed" }) => void;
    } }) => {
      options.callbacks?.onStateChange?.({
        state: "in_progress",
        round: 1,
        reviewTurn: 0,
        maxRounds: 100,
        maxReviewTurns: 5
      });
      options.callbacks?.onBuilderStart?.();
      options.callbacks?.onBuilderComplete?.({ summary: "Builder done", log: "Done" });
      options.callbacks?.onInspectorStart?.("code-quality");
      options.callbacks?.onInspectorComplete?.({ name: "code-quality", summary: "Looks good" });
      options.callbacks?.onSuperintendentStart?.();
      options.callbacks?.onSuperintendentComplete?.({
        summary: "Ready for owner",
        transition: { action: "request_review", summary: "Ready for owner" }
      });
      options.callbacks?.onStateChange?.({
        state: "review",
        round: 1,
        reviewTurn: 0,
        maxRounds: 100,
        maxReviewTurns: 5
      });
      options.callbacks?.onOwnerStart?.();
      options.callbacks?.onOwnerComplete?.({
        transition: { action: "approve_completion" }
      });
      options.callbacks?.onStateChange?.({
        state: "completed",
        round: 1,
        reviewTurn: 0,
        maxRounds: 100,
        maxReviewTurns: 5
      });
      options.callbacks?.onRoundComplete?.(1);
      const result = {
        state: "completed" as const,
        round: 1,
        reviewTurn: 0,
        maxRounds: 100,
        maxReviewTurns: 5,
        stopReason: "completed" as const
      };
      options.callbacks?.onLoopComplete?.(result);
      return result;
    });

    const { runSuperintendentCommand } = await import("./run.js");
    const result = await runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/.poe-code/superintendent/plan.md",
      builderAgent: "codex",
      interactive: true,
      useDashboard: true,
      fs,
      createDashboard: () => dashboardMock.dashboard,
      runLoop: runLoopMock,
      now: () => 0,
      setInterval: (() => 0) as typeof global.setInterval,
      clearInterval: vi.fn(),
      openInEditor: vi.fn(),
      env: {}
    });

    expect(dashboardMock.start).toHaveBeenCalledTimes(1);
    expect(dashboardMock.onCommand).toHaveBeenCalledTimes(1);
    expect(dashboardMock.appendOutput.mock.calls.map(([item]) => item)).toEqual([
      { kind: "status", text: `${expectedTimestamp} Builder starting`, ts: 0 },
      { kind: "success", text: `${expectedTimestamp} Builder completed`, ts: 0 },
      { kind: "status", text: `${expectedTimestamp} Inspector code-quality starting`, ts: 0 },
      { kind: "info", text: `${expectedTimestamp} Inspector code-quality completed`, ts: 0 },
      { kind: "status", text: `${expectedTimestamp} Superintendent reviewing`, ts: 0 },
      { kind: "info", text: `${expectedTimestamp} Superintendent requested owner review`, ts: 0 },
      { kind: "status", text: `${expectedTimestamp} Owner reviewing`, ts: 0 },
      { kind: "success", text: `${expectedTimestamp} Owner approved`, ts: 0 },
      { kind: "success", text: `${expectedTimestamp} Round 1 completed`, ts: 0 },
      { kind: "success", text: `${expectedTimestamp} Loop completed`, ts: 0 }
    ]);
    expect(dashboardMock.updateStats).toHaveBeenCalledWith(
      expect.objectContaining({
        iterations: 1,
        status: "done"
      })
    );
    expect(dashboardMock.stop).toHaveBeenCalledTimes(1);
    expect(dashboardMock.destroy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      builderAgent: "codex",
      state: "completed",
      stopReason: "completed"
    });
  });

  it("streams agent stdout and stderr lines into the dashboard output", async () => {
    const fs = createFs({
      "/repo/.poe-code/superintendent/plan.md": createDoc("codex")
    });
    const dashboardMock = createDashboardMock();
    const executeAgent = vi.fn(async (_agent: string, input: {
      onStdout?: (chunk: string) => void;
      onStderr?: (chunk: string) => void;
    }) => {
      input.onStdout?.("thinking...\nplanning next step\npar");
      input.onStdout?.("tial line completes\n");
      input.onStderr?.("warning: low disk\n");
      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    });
    const runLoopMock = vi.fn(async (options: {
      callbacks?: { onBuilderStart?: () => void; onBuilderComplete?: (result: { summary: string; log: string }) => void };
      runAgent?: (input: { agent: string; prompt: string; cwd: string }) => Promise<unknown>;
    }) => {
      options.callbacks?.onBuilderStart?.();
      await options.runAgent?.({ agent: "codex", prompt: "Build", cwd: "/repo" });
      options.callbacks?.onBuilderComplete?.({ summary: "done", log: "" });
      return {
        state: "completed" as const,
        round: 1,
        reviewTurn: 0,
        maxRounds: 100,
        maxReviewTurns: 5,
        stopReason: "completed" as const
      };
    });

    const { runSuperintendentCommand } = await import("./run.js");
    await runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/.poe-code/superintendent/plan.md",
      builderAgent: "codex",
      assumeYes: true,
      interactive: true,
      useDashboard: true,
      fs,
      executeAgent,
      createDashboard: () => dashboardMock.dashboard,
      runLoop: runLoopMock,
      now: () => 0,
      setInterval: (() => 0) as typeof global.setInterval,
      clearInterval: vi.fn(),
      openInEditor: vi.fn(),
      env: {}
    });

    const outputs = dashboardMock.appendOutput.mock.calls.map(([item]) => item);
    const texts = outputs.map((item: { text: string }) => item.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("[builder] thinking..."),
        expect.stringContaining("[builder] planning next step"),
        expect.stringContaining("[builder] partial line completes"),
        expect.stringContaining("[builder] warning: low disk")
      ])
    );
    const toolKind = outputs.find((item: { kind: string; text: string }) =>
      item.kind === "tool" && item.text.includes("thinking...")
    );
    expect(toolKind).toBeDefined();
    const errKind = outputs.find((item: { kind: string; text: string }) =>
      item.kind === "error" && item.text.includes("warning: low disk")
    );
    expect(errKind).toBeDefined();
  });

  it("scans the configured planDirectory instead of the default superintendent directory", async () => {
    const fs = createFs({
      "/repo/.poe-code/superintendent/should-be-ignored.md": createDoc("codex"),
      "/repo/docs/plans/expected.md": createDoc("claude-code")
    });
    const dashboardMock = createDashboardMock();
    const runLoopMock = vi.fn(async () => ({
      state: "completed" as const,
      round: 0,
      reviewTurn: 0,
      maxRounds: 100,
      maxReviewTurns: 5,
      stopReason: "completed" as const
    }));

    const { runSuperintendentCommand } = await import("./run.js");
    const result = await runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "docs/plans",
      assumeYes: true,
      interactive: true,
      useDashboard: true,
      fs,
      selectPrompt: vi.fn(),
      createDashboard: () => dashboardMock.dashboard,
      runLoop: runLoopMock,
      now: () => 0,
      setInterval: (() => 0) as typeof global.setInterval,
      clearInterval: vi.fn(),
      openInEditor: vi.fn(),
      env: {}
    });

    expect(runLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        docPath: "/repo/docs/plans/expected.md"
      })
    );
    expect(result).toMatchObject({
      docPath: "/repo/docs/plans/expected.md",
      builderAgent: "claude-code"
    });
  });

  it("writes the loop error to stderr after the dashboard tears down", async () => {
    const fs = createFs({
      "/repo/.poe-code/superintendent/plan.md": createDoc("claude-code")
    });
    const dashboardMock = createDashboardMock();
    const runLoopMock = vi.fn(async () => {
      throw new Error("Builder failed: agent stderr blob");
    });
    const stderrChunks: string[] = [];
    const stderr = {
      write: (chunk: string | Uint8Array): boolean => {
        stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }
    } as NodeJS.WritableStream;
    const writeOrder: string[] = [];
    dashboardMock.destroy.mockImplementation(() => writeOrder.push("destroy"));
    const trackingStderr = {
      write: (chunk: string | Uint8Array): boolean => {
        writeOrder.push("stderr");
        return stderr.write(chunk);
      }
    } as NodeJS.WritableStream;

    const { runSuperintendentCommand } = await import("./run.js");
    await expect(
      runSuperintendentCommand({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: "/repo/.poe-code/superintendent/plan.md",
        builderAgent: "claude-code",
        assumeYes: true,
        interactive: true,
        useDashboard: true,
        fs,
        createDashboard: () => dashboardMock.dashboard,
        runLoop: runLoopMock,
        now: () => 0,
        setInterval: (() => 0) as typeof global.setInterval,
        clearInterval: vi.fn(),
        openInEditor: vi.fn(),
        env: {},
        stderr: trackingStderr
      })
    ).rejects.toThrow("Builder failed: agent stderr blob");

    expect(dashboardMock.appendOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "error",
        text: expect.stringContaining("Builder failed: agent stderr blob")
      })
    );
    expect(dashboardMock.destroy).toHaveBeenCalled();
    expect(stderrChunks.join("")).toContain("Builder failed: agent stderr blob");
    expect(writeOrder.indexOf("destroy")).toBeLessThan(writeOrder.indexOf("stderr"));
  });

  it("kills the process with exit code 130 on SIGINT after restoring the terminal", async () => {
    const fs = createFs({
      "/repo/.poe-code/superintendent/plan.md": createDoc("claude-code")
    });
    const dashboardMock = createDashboardMock();

    let rejectLoop: (error: Error) => void = () => {};
    const runLoopMock = vi.fn(
      () =>
        new Promise<never>((_, reject) => {
          rejectLoop = reject;
        })
    );

    const callOrder: string[] = [];
    dashboardMock.destroy.mockImplementation(() => {
      callOrder.push("destroy");
    });
    const exitMock = vi.fn((code: number) => {
      callOrder.push(`exit:${code}`);
      rejectLoop(new Error("__sigint_exit__"));
      return undefined as never;
    });

    const { runSuperintendentCommand } = await import("./run.js");
    const promise = runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/.poe-code/superintendent/plan.md",
      builderAgent: "claude-code",
      assumeYes: true,
      interactive: true,
      useDashboard: true,
      fs,
      createDashboard: () => dashboardMock.dashboard,
      runLoop: runLoopMock,
      now: () => 0,
      setInterval: (() => 0) as typeof global.setInterval,
      clearInterval: vi.fn(),
      openInEditor: vi.fn(),
      env: {},
      exit: exitMock,
      stderr: { write: () => true } as NodeJS.WritableStream
    });

    await new Promise((resolve) => setImmediate(resolve));
    process.emit("SIGINT");

    await expect(promise).rejects.toThrow("__sigint_exit__");

    expect(exitMock).toHaveBeenCalledWith(130);
    expect(dashboardMock.destroy).toHaveBeenCalled();
    expect(callOrder.indexOf("destroy")).toBeLessThan(callOrder.indexOf("exit:130"));
  });
});
