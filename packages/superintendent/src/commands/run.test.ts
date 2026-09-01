import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpawnResult } from "@poe-code/agent-spawn";
import { Volume, createFsFromVolume } from "memfs";
import type { RunLoopOptions, SuperintendentFileSystem } from "../runtime/loop.js";
import type { Dashboard } from "toolcraft-design";

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

function createDocWithBuilderSection(builderSection: string[]): string {
  return [
    "---",
    "kind: superintendent",
    "version: 1",
    "builder:",
    ...builderSection,
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
    writeFile: async (
      filePath: string,
      content: string,
      options?: { encoding?: BufferEncoding; flag?: string }
    ) => {
      await rawFs.mkdir(path.dirname(filePath), { recursive: true });
      await rawFs.writeFile(filePath, content, { encoding: "utf8", ...options });
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
    lstat: async (filePath: string) => {
      const stat = await rawFs.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
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
    },
    unlink: async (filePath: string) => {
      await rawFs.unlink(filePath);
    }
  } as SuperintendentFileSystem;
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

function createStreamingResult(
  events: unknown[],
  result: SpawnResult
): {
  events: AsyncIterable<unknown>;
  done: Promise<SpawnResult>;
} {
  return {
    events: {
      async *[Symbol.asyncIterator]() {
        for (const event of events) {
          yield event;
        }
      }
    },
    done: Promise.resolve(result)
  };
}

describe("superintendent run command", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("uses discovered defaults with --yes and skips the pre-dashboard prompts", async () => {
    const fs = createFs({
      "/repo/docs/plans/b-plan.md": createDoc("codex"),
      "/repo/docs/plans/a-plan.md": createDoc("claude-code")
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
        docPath: "/repo/docs/plans/a-plan.md"
      })
    );
    expect(result).toMatchObject({
      docPath: "/repo/docs/plans/a-plan.md",
      builderAgent: "claude-code",
      stopReason: "completed"
    });
  }, 15_000);

  it("prompts for a builder agent when flag and frontmatter are empty", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDocWithBuilderSection([
        "  prompt: |",
        "    Build {{plan.path}}"
      ])
    });
    const selectPrompt = vi.fn(async () => "codex");
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
      docPath: "/repo/docs/plans/plan.md",
      interactive: true,
      useDashboard: false,
      fs,
      selectPrompt,
      runLoop: runLoopMock,
      now: () => 0,
      stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
      env: {}
    });

    expect(selectPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Select agent to run Superintendent builder with:"
      })
    );
    expect(runLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runAgent: expect.any(Function)
      })
    );
    expect(result.builderAgent).toBe("codex");
  });

  it("passes runtime overrides from command options into agent runs", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDoc("codex")
    });
    const executeAgent = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const runLoopMock = vi.fn(async (options: RunLoopOptions) => {
      await options.runAgent?.({
        agent: "claude-code",
        prompt: "Build",
        cwd: "/repo"
      });
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
      docPath: "/repo/docs/plans/plan.md",
      assumeYes: true,
      interactive: false,
      useDashboard: false,
      fs,
      runLoop: runLoopMock,
      executeAgent,
      runtime: "docker",
      detach: true,
      mountPoeCode: true,
      runnerSync: "none",
      env: {}
    });

    expect(executeAgent).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({
        runtime: "docker",
        detach: true,
        mountPoeCode: true,
        runnerSync: "none"
      })
    );
  });

  it("previews a dry-run loop without invoking runtime agents", async () => {
    const fs = createFs({ "/repo/docs/plans/plan.md": createDoc("codex") });
    const runLoopMock = vi.fn();
    const { runSuperintendentCommand } = await import("./run.js");

    const result = await runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/docs/plans/plan.md",
      assumeYes: true,
      interactive: false,
      useDashboard: false,
      dryRun: true,
      fs,
      runLoop: runLoopMock,
      env: {}
    });

    expect(runLoopMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ builderAgent: "codex", stopReason: "dry_run" });
  });

  it("prompts for a builder agent when frontmatter omits builder.agent", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDocWithBuilderSection([
        "  prompt: |",
        "    Build {{plan.path}}"
      ])
    });
    const selectPrompt = vi.fn(async () => "codex");
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
      docPath: "/repo/docs/plans/plan.md",
      interactive: true,
      useDashboard: false,
      fs,
      selectPrompt,
      runLoop: runLoopMock,
      now: () => 0,
      stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
      env: {}
    });

    expect(selectPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Select agent to run Superintendent builder with:"
      })
    );
    expect(result.builderAgent).toBe("codex");
  });

  it("cancels cleanly when builder agent selection is cancelled", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDocWithBuilderSection([
        "  prompt: |",
        "    Build {{plan.path}}"
      ])
    });
    const cancelled = Symbol("cancelled");
    const selectPrompt = vi.fn(async () => cancelled);
    const runLoopMock = vi.fn();
    vi.resetModules();
    vi.doMock("toolcraft-design", async () => {
      const actual = await vi.importActual<typeof import("toolcraft-design")>("toolcraft-design");
      return {
        ...actual,
        isCancel: (value: unknown) => value === cancelled
      };
    });

    try {
      const { runSuperintendentCommand } = await import("./run.js");

      await expect(
        runSuperintendentCommand({
          cwd: "/repo",
          homeDir: "/home/test",
          docPath: "/repo/docs/plans/plan.md",
          interactive: true,
          useDashboard: false,
          fs,
          selectPrompt,
          runLoop: runLoopMock,
          now: () => 0,
          stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
          env: {}
        })
      ).rejects.toThrow("Operation cancelled.");

      expect(runLoopMock).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("toolcraft-design");
      vi.resetModules();
    }
  });

  it("uses the configured default builder agent with --yes when flag and frontmatter are empty", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDocWithBuilderSection([
        "  prompt: |",
        "    Build {{plan.path}}"
      ])
    });
    const selectPrompt = vi.fn();
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
      docPath: "/repo/docs/plans/plan.md",
      configuredDefaultAgent: "codex",
      assumeYes: true,
      interactive: false,
      useDashboard: false,
      fs,
      selectPrompt,
      runLoop: runLoopMock,
      now: () => 0,
      stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
      env: {}
    });

    expect(selectPrompt).not.toHaveBeenCalled();
    expect(result.builderAgent).toBe("codex");
  });

  it("prompts for the builder agent when core.defaultAgent exists without --yes", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDocWithBuilderSection([
        "  prompt: |",
        "    Build {{plan.path}}"
      ])
    });
    const selectPrompt = vi.fn(async () => "goose");
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
      docPath: "/repo/docs/plans/plan.md",
      configuredDefaultAgent: "codex",
      interactive: true,
      useDashboard: false,
      fs,
      selectPrompt,
      runLoop: runLoopMock,
      now: () => 0,
      stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
      env: {}
    });

    expect(selectPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Select agent to run Superintendent builder with:"
      })
    );
    expect(result.builderAgent).toBe("goose");
  });

  it("falls back to claude-code with --yes when no builder agent is configured", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDocWithBuilderSection([
        "  prompt: |",
        "    Build {{plan.path}}"
      ])
    });
    const selectPrompt = vi.fn();
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
      docPath: "/repo/docs/plans/plan.md",
      assumeYes: true,
      interactive: false,
      useDashboard: false,
      fs,
      selectPrompt,
      runLoop: runLoopMock,
      now: () => 0,
      stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
      env: {}
    });

    expect(selectPrompt).not.toHaveBeenCalled();
    expect(result.builderAgent).toBe("claude-code");
  });

  it("prefers --agent over frontmatter and configured default", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDoc("goose")
    });
    const selectPrompt = vi.fn();
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
      docPath: "/repo/docs/plans/plan.md",
      builderAgent: "codex",
      configuredDefaultAgent: "claude-code",
      interactive: false,
      useDashboard: false,
      fs,
      selectPrompt,
      runLoop: runLoopMock,
      now: () => 0,
      stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
      env: {}
    });

    expect(selectPrompt).not.toHaveBeenCalled();
    expect(result.builderAgent).toBe("codex");
  });

  it("threads core.defaultAgent through runCommand", async () => {
    const volume = Volume.fromJSON(
      {
        "/repo/docs/plans/plan-a.md": createDocWithBuilderSection([
          "  prompt: |",
          "    Build {{plan.path}}"
        ]),
        "/repo/docs/plans/plan-b.md": createDocWithBuilderSection([
          "  prompt: |",
          "    Build {{plan.path}}"
        ]),
        "/home/test/.poe-code/config.json": JSON.stringify(
          { core: { defaultAgent: "codex" } },
          null,
          2
        )
      },
      "/"
    );
    const rawFs = createFsFromVolume(volume).promises;
    const runLoopMock = vi.fn(async () => ({
      state: "completed" as const,
      round: 0,
      reviewTurn: 0,
      maxRounds: 100,
      maxReviewTurns: 5,
      stopReason: "completed" as const
    }));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/repo");
    const originalArgv = process.argv;
    const originalHome = process.env.HOME;

    process.argv = ["node", "poe-code", "superintendent", "run", "--yes"];
    process.env.HOME = "/home/test";

    vi.resetModules();
    vi.doMock("node:fs/promises", () => rawFs);
    vi.doMock("../runtime/loop.js", async () => {
      const actual =
        await vi.importActual<typeof import("../runtime/loop.js")>("../runtime/loop.js");
      return {
        ...actual,
        runLoop: runLoopMock
      };
    });

    try {
      const { runCommand } = await import("./run.js");
      const result = await runCommand.handler({
        params: { docs: ["/repo/docs/plans/plan-a.md", "/repo/docs/plans/plan-b.md"] },
        secrets: {},
        fetch: globalThis.fetch,
        fs: rawFs as never,
        env: {
          get: vi.fn(() => undefined)
        },
        progress: vi.fn()
      });

      expect(result.builderAgent).toBe("codex");
      expect(runLoopMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.doUnmock("../runtime/loop.js");
      vi.resetModules();
      cwdSpy.mockRestore();
      process.argv = originalArgv;
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });

  it("threads core.defaultAgent through createRunMcpCommand", async () => {
    const volume = Volume.fromJSON(
      {
        "/repo/docs/plans/plan.md": createDocWithBuilderSection([
          "  prompt: |",
          "    Build {{plan.path}}"
        ]),
        "/home/test/.poe-code/config.json": JSON.stringify(
          { core: { defaultAgent: "codex" } },
          null,
          2
        )
      },
      "/"
    );
    const rawFs = createFsFromVolume(volume).promises;
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/repo");
    const originalHome = process.env.HOME;

    process.env.HOME = "/home/test";

    vi.resetModules();
    vi.doMock("node:fs/promises", () => rawFs);

    try {
      const { createRunMcpCommand } = await import("./run.js");
      const runLoopMock = vi.fn(async () => ({
        state: "completed" as const,
        round: 0,
        reviewTurn: 0,
        maxRounds: 100,
        maxReviewTurns: 5,
        stopReason: "completed" as const
      }));
      const command = createRunMcpCommand({ runLoop: runLoopMock });
      const result = await command.handler({
        params: { doc: "/repo/docs/plans/plan.md" },
        secrets: {},
        fetch: globalThis.fetch,
        fs: rawFs as never,
        env: {
          get: vi.fn(() => undefined)
        },
        progress: vi.fn()
      });

      expect(result.builderAgent).toBe("codex");
      expect(runLoopMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
      cwdSpy.mockRestore();
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });

  it("threads runnerSync through createRunMcpCommand", async () => {
    const volume = Volume.fromJSON({ "/repo/docs/plans/plan.md": createDoc("codex") }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/repo");
    const originalHome = process.env.HOME;
    const spawnMock = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    process.env.HOME = "/home/test";
    vi.resetModules();
    vi.doMock("node:fs/promises", () => rawFs);
    vi.doMock("@poe-code/agent-spawn", async () => {
      const actual =
        await vi.importActual<typeof import("@poe-code/agent-spawn")>("@poe-code/agent-spawn");
      return { ...actual, getSpawnConfig: () => undefined, spawn: spawnMock };
    });

    try {
      const { createRunMcpCommand } = await import("./run.js");
      const runLoopMock = vi.fn(async (options: RunLoopOptions) => {
        await options.runAgent?.({
          agent: "codex",
          prompt: "Build",
          cwd: "/repo"
        });
        return {
          state: "completed" as const,
          round: 0,
          reviewTurn: 0,
          maxRounds: 100,
          maxReviewTurns: 5,
          stopReason: "completed" as const
        };
      });
      const command = createRunMcpCommand({ runLoop: runLoopMock });
      await command.handler({
        params: { doc: "/repo/docs/plans/plan.md", runnerSync: "none" },
        secrets: {},
        fetch: globalThis.fetch,
        fs: rawFs as never,
        env: { get: vi.fn(() => undefined) },
        progress: vi.fn()
      });

      expect(spawnMock).toHaveBeenCalledWith(
        "codex",
        expect.objectContaining({
          runnerSync: "none"
        })
      );
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.doUnmock("@poe-code/agent-spawn");
      vi.resetModules();
      cwdSpy.mockRestore();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("rejects invalid config instead of falling back to defaults", async () => {
    const volume = Volume.fromJSON(
      {
        "/repo/docs/plans/plan.md": createDocWithBuilderSection([
          "  prompt: |",
          "    Build {{plan.path}}"
        ]),
        "/repo/.poe-code/config.json": "{"
      },
      "/"
    );
    const rawFs = createFsFromVolume(volume).promises;
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/repo");
    const originalArgv = process.argv;
    const originalHome = process.env.HOME;

    process.argv = ["node", "poe-code", "superintendent", "run", "--yes", "--dry-run"];
    process.env.HOME = "/home/test";
    vi.resetModules();
    vi.doMock("node:fs/promises", () => rawFs);

    try {
      const { runCommand } = await import("./run.js");
      await expect(
        runCommand.handler({
          params: { doc: "/repo/docs/plans/plan.md", dryRun: true },
          secrets: {},
          fetch: globalThis.fetch,
          fs: rawFs as never,
          env: { get: vi.fn(() => undefined) },
          progress: vi.fn()
        })
      ).rejects.toThrow(/config/i);
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
      cwdSpy.mockRestore();
      process.argv = originalArgv;
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("preserves a completed CLI run when integration shutdown fails", async () => {
    const volume = Volume.fromJSON({ "/repo/docs/plans/plan.md": createDoc("codex") }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/repo");
    const originalHome = process.env.HOME;
    const loadIntegrationsMock = vi.fn(async () => ({
      traceRun: async (_surface: string, _name: string, run: () => Promise<unknown>) => run(),
      shutdown: vi.fn(async () => {
        throw new Error("shutdown failed");
      })
    }));
    const runLoopMock = vi.fn(async () => ({
      state: "completed" as const,
      round: 0,
      reviewTurn: 0,
      maxRounds: 100,
      maxReviewTurns: 5,
      stopReason: "completed" as const
    }));

    process.env.HOME = "/home/test";
    vi.resetModules();
    vi.doMock("node:fs/promises", () => rawFs);
    vi.doMock("@poe-code/braintrust", () => ({ loadIntegrations: loadIntegrationsMock }));
    vi.doMock("../runtime/loop.js", async () => {
      const actual =
        await vi.importActual<typeof import("../runtime/loop.js")>("../runtime/loop.js");
      return { ...actual, runLoop: runLoopMock };
    });

    try {
      const { runCommand } = await import("./run.js");
      await expect(
        runCommand.handler({
          params: { doc: "/repo/docs/plans/plan.md" },
          secrets: {},
          fetch: globalThis.fetch,
          fs: rawFs as never,
          env: { get: vi.fn(() => undefined) },
          progress: vi.fn()
        })
      ).resolves.toMatchObject({ state: "completed", stopReason: "completed" });
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.doUnmock("@poe-code/braintrust");
      vi.doUnmock("../runtime/loop.js");
      vi.resetModules();
      cwdSpy.mockRestore();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("preserves a completed MCP run when integration shutdown fails", async () => {
    const volume = Volume.fromJSON({ "/repo/docs/plans/plan.md": createDoc("codex") }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/repo");
    const originalHome = process.env.HOME;
    const loadIntegrationsMock = vi.fn(async () => ({
      traceRun: async (_surface: string, _name: string, run: () => Promise<unknown>) => run(),
      shutdown: vi.fn(async () => {
        throw new Error("shutdown failed");
      })
    }));
    const runLoopMock = vi.fn(async () => ({
      state: "completed" as const,
      round: 0,
      reviewTurn: 0,
      maxRounds: 100,
      maxReviewTurns: 5,
      stopReason: "completed" as const
    }));

    process.env.HOME = "/home/test";
    vi.resetModules();
    vi.doMock("node:fs/promises", () => rawFs);
    vi.doMock("@poe-code/braintrust", () => ({ loadIntegrations: loadIntegrationsMock }));

    try {
      const { createRunMcpCommand } = await import("./run.js");
      const command = createRunMcpCommand({ runLoop: runLoopMock });
      await expect(
        command.handler({
          params: { doc: "/repo/docs/plans/plan.md" },
          secrets: {},
          fetch: globalThis.fetch,
          fs: rawFs as never,
          env: { get: vi.fn(() => undefined) },
          progress: vi.fn()
        })
      ).resolves.toMatchObject({ state: "completed", stopReason: "completed" });
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.doUnmock("@poe-code/braintrust");
      vi.resetModules();
      cwdSpy.mockRestore();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("captures ACP session logs and usage through shared middleware for CLI streaming agents", async () => {
    const applyMiddlewaresMock = vi.fn(async (middlewares, ctx) => {
      let index = -1;
      const dispatch = async (position: number): Promise<void> => {
        if (position <= index) throw new Error("next called multiple times");
        index = position;
        if (position === middlewares.length) return;
        await middlewares[position](ctx, () => dispatch(position + 1));
      };
      await dispatch(0);
    });
    const renderAcpStreamMock = vi.fn(async (events: AsyncIterable<unknown>) => {
      for await (const ignoredEvent of events) {
        void ignoredEvent;
        // exhaust stream
      }
    });
    const spawnStreamingMock = vi.fn(() =>
      createStreamingResult(
        [
          { event: "session_start", threadId: "thread-123" },
          { event: "agent_message", text: "builder summary" },
          {
            event: "tool_start",
            id: "tool-1",
            kind: "execute",
            title: "read_file",
            input: { path: "plan.md" }
          },
          {
            event: "tool_complete",
            id: "tool-1",
            kind: "execute",
            path: "plan.md"
          },
          {
            event: "usage",
            inputTokens: 21,
            outputTokens: 8,
            cachedTokens: 5
          }
        ],
        {
          stdout: "builder stdout\n",
          stderr: "",
          exitCode: 0,
          logFile: "/logs/builder.jsonl"
        }
      )
    );

    vi.resetModules();
    vi.doMock("@poe-code/agent-spawn", async () => {
      const actual =
        await vi.importActual<typeof import("@poe-code/agent-spawn")>("@poe-code/agent-spawn");
      return {
        ...actual,
        spawnStreaming: spawnStreamingMock,
        applyMiddlewares: applyMiddlewaresMock,
        renderAcpStream: renderAcpStreamMock
      };
    });

    const { runSuperintendentCommand } = await import("./run.js");
    const runLoopMock = vi.fn(async (options) => {
      const result = await options.runAgent!({
        agent: "claude-code",
        prompt: "Build the plan",
        cwd: "/repo",
        mode: "auto",
        logPath: "/logs/builder.jsonl"
      });
      expect(result).toMatchObject({
        exitCode: 0,
        stdout: "builder stdout\n",
        summary: "builder summary",
        logFile: "/logs/builder.jsonl",
        usage: {
          inputTokens: 21,
          outputTokens: 8,
          cachedTokens: 5
        },
        toolCalls: [{ title: "read_file", input: { path: "plan.md" } }]
      });
      return {
        state: "completed" as const,
        round: 1,
        reviewTurn: 0,
        maxRounds: 100,
        maxReviewTurns: 5,
        stopReason: "completed" as const
      };
    });

    const result = await runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/.poe-code/superintendent/plan.md",
      interactive: false,
      useDashboard: false,
      fs: createFs({
        "/repo/.poe-code/superintendent/plan.md": createDoc("claude-code")
      }),
      runLoop: runLoopMock,
      now: () => 0,
      stderr: { write: vi.fn() } as unknown as NodeJS.WritableStream,
      env: {}
    });

    expect(spawnStreamingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "claude-code",
        prompt: "Build the plan",
        cwd: "/repo",
        useStdin: true,
        mode: "auto"
      })
    );
    expect(applyMiddlewaresMock).toHaveBeenCalledTimes(1);
    expect(applyMiddlewaresMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        logPath: "/logs/builder.jsonl"
      })
    );
    expect(renderAcpStreamMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      docPath: "/repo/.poe-code/superintendent/plan.md",
      builderAgent: "claude-code",
      stopReason: "completed"
    });
  });

  it("wires loop callbacks to the dashboard", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDoc("claude-code")
    });
    const dashboardMock = createDashboardMock();
    const runLoopMock = vi.fn(
      async (options: {
        callbacks?: {
          onStateChange?: (state: {
            state: "in_progress" | "review" | "completed";
            round: number;
            reviewTurn: number;
            maxRounds: number;
            maxReviewTurns: number;
          }) => void;
          onBuilderStart?: () => void;
          onBuilderComplete?: (result: { summary: string; log: string }) => void;
          onInspectorStart?: (name: string) => void;
          onInspectorComplete?: (result: { name: string; summary: string }) => void;
          onSuperintendentStart?: () => void;
          onSuperintendentComplete?: (result: {
            summary: string;
            transition: { action: "request_review"; summary: string };
          }) => void;
          onOwnerStart?: () => void;
          onOwnerComplete?: (result: { transition: { action: "approve_completion" } }) => void;
          onRoundComplete?: (round: number) => void;
          onLoopComplete?: (result: {
            state: "completed";
            round: number;
            reviewTurn: number;
            maxRounds: number;
            maxReviewTurns: number;
            stopReason: "completed";
          }) => void;
        };
      }) => {
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
      }
    );

    const { runSuperintendentCommand } = await import("./run.js");
    const result = await runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/docs/plans/plan.md",
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
      builderAgent: "claude-code",
      state: "completed",
      stopReason: "completed"
    });
  });

  it("clears the active role when manual completion ends the loop", async () => {
    const fs = createFs({ "/repo/docs/plans/plan.md": createDoc("claude-code") });
    const dashboardMock = createDashboardMock();
    const runLoopMock = vi.fn(async (options: RunLoopOptions) => {
      options.callbacks?.onBuilderStart?.();
      const completed = {
        state: "completed" as const,
        round: 1,
        reviewTurn: 0,
        maxRounds: 100,
        maxReviewTurns: 5,
        stopReason: "completed" as const
      };
      options.callbacks?.onLoopComplete?.(completed);
      return completed;
    });
    const { runSuperintendentCommand } = await import("./run.js");
    await runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/docs/plans/plan.md",
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
    expect(dashboardMock.updateStats).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "done",
        currentAction: "state=completed · round=1"
      })
    );
    expect(dashboardMock.destroy).toHaveBeenCalledTimes(1);
  });

  it("runs integration superintendent callbacks after dashboard callbacks", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDoc("claude-code")
    });
    const calls: string[] = [];
    const dashboardMock = createDashboardMock();
    dashboardMock.appendOutput.mockImplementation((entry: { text?: string }) => {
      if (entry.text?.includes("Builder starting")) {
        calls.push("dashboard");
      }
    });
    const runLoopMock = vi.fn(async (options: RunLoopOptions) => {
      options.callbacks?.onBuilderStart?.();
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
      docPath: "/repo/docs/plans/plan.md",
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
      stderr: { write: () => true } as NodeJS.WritableStream,
      integrations: {
        superintendentCallbacks: {
          onBuilderStart: () => calls.push("integration")
        },
        traceRun: async (_surface, _name, run) => run(),
        shutdown: vi.fn(async () => undefined)
      }
    });

    expect(calls).toEqual(["dashboard", "integration"]);
  });

  it("streams agent stdout and stderr lines into the dashboard output", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDoc("codex")
    });
    const dashboardMock = createDashboardMock();
    const executeAgent = vi.fn(
      async (
        _agent: string,
        input: {
          onStdout?: (chunk: string) => void;
          onStderr?: (chunk: string) => void;
        }
      ) => {
        input.onStdout?.("thinking...\nplanning next step\npar");
        input.onStdout?.("tial line completes\n");
        input.onStderr?.("warning: low disk\n");
        return {
          stdout: "",
          stderr: "",
          exitCode: 0
        };
      }
    );
    const runLoopMock = vi.fn(
      async (options: {
        callbacks?: {
          onBuilderStart?: () => void;
          onBuilderComplete?: (result: { summary: string; log: string }) => void;
        };
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
      }
    );

    const { runSuperintendentCommand } = await import("./run.js");
    await runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/docs/plans/plan.md",
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
    const toolKind = outputs.find(
      (item: { kind: string; text: string }) =>
        item.kind === "tool" && item.text.includes("thinking...")
    );
    expect(toolKind).toBeDefined();
    const errKind = outputs.find(
      (item: { kind: string; text: string }) =>
        item.kind === "error" && item.text.includes("warning: low disk")
    );
    expect(errKind).toBeDefined();
  });

  it("routes poe-agent through shared ACP middleware and captures logs, usage, and tool calls", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDoc("poe-agent:openai/gpt-5.4")
    });
    const dashboardMock = createDashboardMock();

    const runLoopMock = vi.fn(async (options: RunLoopOptions) => {
      options.callbacks?.onBuilderStart?.();
      const result = await options.runAgent?.({
        agent: "claude-code",
        prompt: "Build",
        cwd: "/repo",
        logPath: "/logs/builder.jsonl"
      });
      options.callbacks?.onBuilderComplete?.({
        summary: "done",
        log: "",
        log_path: result?.logFile ?? ""
      });
      return {
        state: "completed" as const,
        round: 1,
        reviewTurn: 0,
        maxRounds: 100,
        maxReviewTurns: 5,
        stopReason: "completed" as const
      };
    });

    const executeAgentMock = vi.fn(
      async (
        agent: string,
        input: {
          prompt: string;
          cwd: string;
          onStdout?: (chunk: string) => void;
          onStderr?: (chunk: string) => void;
          logPath?: string;
        }
      ) => {
        expect(agent).toBe("poe-agent:openai/gpt-5.4");
        expect(input.prompt).toBe("Build");
        expect(input.cwd).toBe("/repo");
        expect(input.logPath).toBe("/logs/builder.jsonl");
        input.onStdout?.("thinking...\n");
        return {
          stdout: "thinking...",
          stderr: "",
          exitCode: 0,
          logFile: "/logs/builder.jsonl",
          usage: {
            inputTokens: 12,
            outputTokens: 4,
            cachedTokens: 2
          },
          toolCalls: [{ title: "read_file", input: { preserved: true } }]
        };
      }
    );

    const { runSuperintendentCommand } = await import("./run.js");
    await runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/docs/plans/plan.md",
      assumeYes: true,
      interactive: true,
      useDashboard: true,
      fs,
      createDashboard: () => dashboardMock.dashboard,
      runLoop: runLoopMock,
      executeAgent: executeAgentMock,
      now: () => 0,
      setInterval: (() => 0) as typeof global.setInterval,
      clearInterval: vi.fn(),
      openInEditor: vi.fn(),
      env: {}
    });

    expect(executeAgentMock).toHaveBeenCalledWith(
      "poe-agent:openai/gpt-5.4",
      expect.objectContaining({
        prompt: "Build",
        cwd: "/repo"
      })
    );
    expect(runLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callbacks: expect.any(Object),
        runAgent: expect.any(Function)
      })
    );
    const builderComplete = runLoopMock.mock.calls[0]?.[0]?.callbacks?.onBuilderComplete;
    expect(builderComplete).toBeTypeOf("function");

    const outputs = dashboardMock.appendOutput.mock.calls.map(([item]) => item);
    expect(
      outputs.some((item: { text: string }) => item.text.includes("[builder] thinking..."))
    ).toBe(true);
    expect(dashboardMock.updateStats).toHaveBeenCalledWith(
      expect.objectContaining({
        tokensIn: 12,
        tokensOut: 4
      })
    );
  });

  it("discovers superintendent docs from the shared docs/plans default", async () => {
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

  it("uses display paths for interactive plan choices and absolute paths for execution", async () => {
    const fs = createFs({
      "/home/test/plans/first.md": createDoc("codex"),
      "/home/test/plans/second.md": createDoc("claude-code")
    });
    const stat = fs.stat.bind(fs);
    vi.spyOn(fs, "stat").mockImplementation(async (filePath) => ({
      ...(await stat(filePath)),
      mtimeMs: filePath.endsWith("first.md") ? 2 : 1
    }));
    const dashboardMock = createDashboardMock();
    const selectPrompt = vi.fn(async () => "/home/test/plans/second.md");
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
      planDirectory: "~/plans",
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

    expect(selectPrompt).toHaveBeenCalledWith({
      message: "Select superintendent document",
      options: [
        { label: "~/plans/first.md", value: "/home/test/plans/first.md" },
        { label: "~/plans/second.md", value: "/home/test/plans/second.md" }
      ],
      initialValue: "/home/test/plans/first.md"
    });
    expect(runLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        docPath: "/home/test/plans/second.md"
      })
    );
    expect(result).toMatchObject({
      docPath: "/home/test/plans/second.md",
      builderAgent: "claude-code"
    });
  });

  it("respects POE_PLAN_DIRECTORY when discovery defaults are resolved", async () => {
    const fs = createFs({
      "/repo/docs/plans/should-be-ignored.md": createDoc("codex"),
      "/repo/custom/plans/expected.md": createDoc("claude-code")
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
      env: { POE_PLAN_DIRECTORY: "custom/plans" }
    });

    expect(runLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        docPath: "/repo/custom/plans/expected.md"
      })
    );
    expect(result).toMatchObject({
      docPath: "/repo/custom/plans/expected.md",
      builderAgent: "claude-code"
    });
  });

  it("uses plan.plan_directory from shared config during discovery", async () => {
    const fs = createFs({
      "/repo/.poe-code/config.json": JSON.stringify(
        {
          plan: {
            plan_directory: "custom/plans"
          }
        },
        null,
        2
      ),
      "/repo/.poe-code/superintendent/legacy.md": createDoc("codex"),
      "/repo/custom/plans/expected.md": createDoc("claude-code")
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
        docPath: "/repo/custom/plans/expected.md"
      })
    );
    expect(result).toMatchObject({
      docPath: "/repo/custom/plans/expected.md",
      builderAgent: "claude-code"
    });
  });

  it("does not fall back to .poe-code/superintendent when default discovery finds nothing", async () => {
    const fs = createFs({
      "/repo/.poe-code/superintendent/legacy.md": createDoc("codex")
    });

    const { runSuperintendentCommand } = await import("./run.js");

    await expect(
      runSuperintendentCommand({
        cwd: "/repo",
        homeDir: "/home/test",
        assumeYes: true,
        interactive: true,
        useDashboard: false,
        fs,
        selectPrompt: vi.fn(),
        now: () => 0,
        env: {}
      })
    ).rejects.toThrow("No superintendent documents found.");
  });

  it("writes the loop error to stderr after the dashboard tears down", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDoc("claude-code")
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
        docPath: "/repo/docs/plans/plan.md",
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

  it("kills the process with exit code 130 on SIGINT after aborting in-flight spawns and restoring the terminal", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDoc("claude-code")
    });
    const dashboardMock = createDashboardMock();

    let capturedSignal: AbortSignal | undefined;
    let rejectLoop: (error: Error) => void = () => {};
    const runLoopMock = vi.fn((options: { signal?: AbortSignal }) => {
      capturedSignal = options.signal;
      return new Promise<never>((_, reject) => {
        rejectLoop = reject;
      });
    });

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
      docPath: "/repo/docs/plans/plan.md",
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

    expect(capturedSignal?.aborted).toBe(true);
    expect(exitMock).toHaveBeenCalledWith(130);
    expect(dashboardMock.destroy).toHaveBeenCalled();
    expect(callOrder.indexOf("destroy")).toBeLessThan(callOrder.indexOf("exit:130"));
  });

  it("immediately terminates on forceQuit dashboard command by aborting the loop signal and exiting 130", async () => {
    const fs = createFs({
      "/repo/docs/plans/plan.md": createDoc("claude-code")
    });

    let commandHandler: ((command: string) => void) | undefined;
    const dashboardMock = createDashboardMock();
    dashboardMock.onCommand.mockImplementation((handler: (command: string) => void) => {
      commandHandler = handler;
    });

    let capturedSignal: AbortSignal | undefined;
    let rejectLoop: (error: Error) => void = () => {};
    const runLoopMock = vi.fn((options: { signal?: AbortSignal }) => {
      capturedSignal = options.signal;
      return new Promise<never>((_, reject) => {
        rejectLoop = reject;
      });
    });

    const callOrder: string[] = [];
    dashboardMock.destroy.mockImplementation(() => {
      callOrder.push("destroy");
    });
    const exitMock = vi.fn((code: number) => {
      callOrder.push(`exit:${code}`);
      rejectLoop(new Error("__force_quit_exit__"));
      return undefined as never;
    });

    const { runSuperintendentCommand } = await import("./run.js");
    const promise = runSuperintendentCommand({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/docs/plans/plan.md",
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
    commandHandler?.("forceQuit");

    await expect(promise).rejects.toThrow("__force_quit_exit__");

    expect(capturedSignal?.aborted).toBe(true);
    expect(exitMock).toHaveBeenCalledWith(130);
    expect(dashboardMock.destroy).toHaveBeenCalled();
    expect(callOrder.indexOf("destroy")).toBeLessThan(callOrder.indexOf("exit:130"));
  });

  describe("edit command", () => {
    type EditHarness = {
      commandHandler: () => (command: string) => void;
      dashboardMock: ReturnType<typeof createDashboardMock>;
      openInEditor: ReturnType<typeof vi.fn>;
      shouldPause: () => boolean;
      promise: Promise<unknown>;
      finish: () => Promise<void>;
    };

    const setupEditHarness = async (
      env: Record<string, string | undefined>
    ): Promise<EditHarness> => {
      const docPath = "/repo/docs/plans/plan.md";
      const fs = createFs({ [docPath]: createDoc("claude-code") });

      let capturedHandler: ((command: string) => void) | undefined;
      const dashboardMock = createDashboardMock();
      dashboardMock.onCommand.mockImplementation((handler: (command: string) => void) => {
        capturedHandler = handler;
      });

      type LoopResult = {
        state: "in_progress" | "review" | "completed";
        round: number;
        reviewTurn: number;
        maxRounds: number;
        maxReviewTurns: number;
        stopReason: "completed";
      };
      let resolveLoop: (value: LoopResult) => void = () => {};
      let capturedShouldPause: (() => boolean) | undefined;
      const runLoopMock = vi.fn((options: { callbacks?: { shouldPause?: () => boolean } }) => {
        capturedShouldPause = options.callbacks?.shouldPause;
        return new Promise<LoopResult>((resolve) => {
          resolveLoop = resolve;
        });
      });
      const openInEditor = vi.fn();

      const { runSuperintendentCommand } = await import("./run.js");
      const promise = runSuperintendentCommand({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath,
        assumeYes: true,
        interactive: true,
        useDashboard: true,
        fs,
        createDashboard: () => dashboardMock.dashboard,
        runLoop: runLoopMock,
        now: () => 0,
        setInterval: (() => 0) as typeof global.setInterval,
        clearInterval: vi.fn(),
        openInEditor,
        env,
        stderr: { write: () => true } as NodeJS.WritableStream
      });

      await new Promise((resolve) => setImmediate(resolve));

      return {
        commandHandler: () => {
          if (!capturedHandler) throw new Error("command handler not registered");
          return capturedHandler;
        },
        dashboardMock,
        openInEditor,
        shouldPause: () => {
          if (!capturedShouldPause) throw new Error("shouldPause not captured");
          return capturedShouldPause();
        },
        promise,
        finish: async () => {
          resolveLoop({
            state: "completed",
            round: 0,
            reviewTurn: 0,
            maxRounds: 100,
            maxReviewTurns: 5,
            stopReason: "completed"
          });
          await promise;
        }
      };
    };

    it("pauses the dashboard and the loop for a TTY editor and opens it immediately", async () => {
      const docPath = "/repo/docs/plans/plan.md";
      const harness = await setupEditHarness({ EDITOR: "vi" });

      expect(harness.shouldPause()).toBe(false);
      harness.commandHandler()("edit");

      expect(harness.openInEditor).toHaveBeenCalledWith(docPath, { EDITOR: "vi" });
      expect(harness.dashboardMock.stop).toHaveBeenCalled();
      expect(harness.dashboardMock.start).toHaveBeenCalled();
      expect(harness.shouldPause()).toBe(true);
      expect(harness.dashboardMock.appendOutput).not.toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Edit requested after current agent")
        })
      );
      expect(harness.dashboardMock.appendOutput).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("Plan reopened in $EDITOR") })
      );

      await harness.finish();
    });

    it("leaves the dashboard and loop running when EDITOR is a GUI editor", async () => {
      const docPath = "/repo/docs/plans/plan.md";
      const harness = await setupEditHarness({ EDITOR: "code --wait" });
      harness.dashboardMock.stop.mockClear();

      harness.commandHandler()("edit");

      expect(harness.openInEditor).toHaveBeenCalledWith(docPath, { EDITOR: "code --wait" });
      expect(harness.dashboardMock.stop).not.toHaveBeenCalled();
      expect(harness.shouldPause()).toBe(false);

      await harness.finish();
    });

    it("defaults to code (GUI) when running inside a VSCode terminal with no EDITOR", async () => {
      const docPath = "/repo/docs/plans/plan.md";
      const harness = await setupEditHarness({ TERM_PROGRAM: "vscode" });
      harness.dashboardMock.stop.mockClear();

      harness.commandHandler()("edit");

      expect(harness.openInEditor).toHaveBeenCalledWith(docPath, { TERM_PROGRAM: "vscode" });
      expect(harness.dashboardMock.stop).not.toHaveBeenCalled();
      expect(harness.shouldPause()).toBe(false);

      await harness.finish();
    });
  });
});
