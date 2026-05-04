import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSpawnSession } from "./spawn-session.js";
import type { OpenSpec } from "@poe-code/agent-harness-tools";
import type { AcpMiddleware } from "./acp/middleware.js";

const createPoeCommandSessionMock = vi.hoisted(() => vi.fn());
const resolvePoeCommandExecutionMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/agent-harness-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-harness-tools")>();
  return {
    ...actual,
    createPoeCommandSession: createPoeCommandSessionMock,
    resolvePoeCommandExecution: resolvePoeCommandExecutionMock
  };
});

describe("createSpawnSession", () => {
  beforeEach(() => {
    createPoeCommandSessionMock.mockReset();
    resolvePoeCommandExecutionMock.mockReset();
  });

  it("rejects detached sessions at construction time", () => {
    expect(() =>
      createSpawnSession({
        service: "claude-code",
        detach: true
      })
    ).toThrow(/detach.*spawn\(\.\.\.\)/i);

    expect(resolvePoeCommandExecutionMock).not.toHaveBeenCalled();
    expect(createPoeCommandSessionMock).not.toHaveBeenCalled();
  });

  it("resolves the runtime once and reuses the command session for runs", async () => {
    const run = vi.fn().mockResolvedValue({
      kind: "sync",
      exitCode: 0,
      stdout: "done",
      stderr: "",
      download: { files: 1, bytes: 2, conflicts: [] }
    });
    const syncBack = vi.fn().mockResolvedValue({ files: 2, bytes: 4, conflicts: [] });
    const close = vi.fn().mockResolvedValue(undefined);
    const factory = { type: "e2b" };
    const state = { jobs: {} };
    const onProgress = vi.fn();
    const baseOpenSpec = createBaseOpenSpec(onProgress);

    resolvePoeCommandExecutionMock.mockReturnValue({
      factory,
      state,
      detach: false,
      openSpec: baseOpenSpec
    });
    createPoeCommandSessionMock.mockReturnValue({ run, syncBack, close });

    const session = createSpawnSession({
      service: "claude-code",
      cwd: "/repo",
      runtime: "e2b",
      runtimeTemplate: "tmpl_base",
      runtimeConfigCwd: "/config",
      model: "base-model",
      mode: "read",
      downloadConflict: "overwrite",
      onProgress
    });

    await expect(
      session.run({
        prompt: "fix bug",
        agent: "codex",
        model: "gpt-5",
        cwd: "/repo/pkg",
        syncBack: true
      })
    ).resolves.toEqual({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
    await expect(session.syncBack()).resolves.toEqual({ files: 2, bytes: 4, conflicts: [] });
    await session.close();

    expect(resolvePoeCommandExecutionMock).toHaveBeenCalledTimes(1);
    expect(resolvePoeCommandExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        runtimeConfigCwd: "/config",
        tool: "claude-code",
        runtime: expect.objectContaining({
          runtime: "e2b",
          runtimeTemplate: "tmpl_base"
        }),
        openSpec: expect.objectContaining({
          onProgress
        })
      })
    );
    expect(createPoeCommandSessionMock).toHaveBeenCalledTimes(1);
    expect(createPoeCommandSessionMock).toHaveBeenCalledWith({ factory, state });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        ...baseOpenSpec,
        cwd: "/repo/pkg",
        onProgress,
        env: expect.objectContaining(process.env),
        runner: expect.objectContaining({
          download_conflict: "overwrite",
          workspace: { exclude: ["node_modules"] }
        }),
        jobLabel: {
          tool: "codex",
          argv: expect.arrayContaining(["codex", "exec", "fix bug"])
        },
        execution: expect.objectContaining({
          wrapForLogTee: false,
          stdout: "pipe",
          stderr: "pipe",
          captureOutput: true,
          env: expect.objectContaining(process.env)
        })
      }),
      undefined,
      { syncBack: true }
    );
    expect(syncBack).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("uses the constructor signal when a run does not provide one", async () => {
    const signal = new AbortController().signal;
    const run = vi.fn().mockResolvedValue({ kind: "sync", exitCode: 0 });
    resolvePoeCommandExecutionMock.mockReturnValue({
      factory: { type: "host" },
      state: { jobs: {} },
      detach: false,
      openSpec: createBaseOpenSpec()
    });
    createPoeCommandSessionMock.mockReturnValue({
      run,
      syncBack: vi.fn(),
      close: vi.fn()
    });

    const session = createSpawnSession({ service: "claude-code", signal });
    await session.run({ prompt: "hello" });

    expect(run.mock.calls[0]?.[1]).toBe(signal);
  });

  it("uses a per-run signal over the constructor signal", async () => {
    const constructorSignal = new AbortController().signal;
    const runSignal = new AbortController().signal;
    const run = vi.fn().mockResolvedValue({ kind: "sync", exitCode: 0 });
    resolvePoeCommandExecutionMock.mockReturnValue({
      factory: { type: "host" },
      state: { jobs: {} },
      detach: false,
      openSpec: createBaseOpenSpec()
    });
    createPoeCommandSessionMock.mockReturnValue({
      run,
      syncBack: vi.fn(),
      close: vi.fn()
    });

    const session = createSpawnSession({ service: "claude-code", signal: constructorSignal });
    await session.run({ prompt: "hello", signal: runSignal });

    expect(run.mock.calls[0]?.[1]).toBe(runSignal);
  });

  it("passes stdin-mode prompts through execution input instead of argv", async () => {
    const run = vi.fn().mockResolvedValue({
      kind: "sync",
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    });
    resolvePoeCommandExecutionMock.mockReturnValue({
      factory: { type: "host" },
      state: { jobs: {} },
      detach: false,
      openSpec: createBaseOpenSpec()
    });
    createPoeCommandSessionMock.mockReturnValue({
      run,
      syncBack: vi.fn(),
      close: vi.fn()
    });

    const session = createSpawnSession({ service: "codex", useStdin: true });
    await session.run({ prompt: "stdin prompt" });

    const openSpec = run.mock.calls[0]?.[0] as OpenSpec;
    expect(openSpec.jobLabel.argv).toContain("-");
    expect(openSpec.jobLabel.argv).not.toContain("stdin prompt");
    expect(openSpec.execution).toEqual(
      expect.objectContaining({
        stdin: "pipe",
        input: "stdin prompt"
      })
    );
  });

  it("runs configured middlewares around each command with the populated spawn context", async () => {
    const run = vi.fn().mockResolvedValue({
      kind: "sync",
      exitCode: 0,
      stdout: "agent output",
      stderr: "tool warning"
    });
    resolvePoeCommandExecutionMock.mockReturnValue({
      factory: { type: "host" },
      state: { jobs: {} },
      detach: false,
      openSpec: createBaseOpenSpec()
    });
    createPoeCommandSessionMock.mockReturnValue({
      run,
      syncBack: vi.fn(),
      close: vi.fn()
    });

    const calls: string[] = [];
    const middleware: AcpMiddleware = vi.fn(async (ctx, next) => {
      calls.push(`before:${ctx.agent}:${ctx.model}:${ctx.prompt}`);
      await next();
      calls.push(`after:${ctx.sessionResult?.output}:${ctx.events.length}`);
    });
    const session = createSpawnSession({
      service: "claude-code",
      model: "base-model",
      middlewares: [middleware]
    });

    await session.run({
      agent: "codex",
      prompt: "fix bug",
      model: "gpt-5"
    });

    expect(middleware).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["before:codex:gpt-5:fix bug", "after:agent output:2"]);
    expect(middleware).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "spawn-session",
        agent: "codex",
        prompt: "fix bug",
        model: "gpt-5",
        cwd: expect.any(String),
        sessionResult: {
          output: "agent output",
          messages: ["agent output"],
          toolCalls: []
        },
        events: [
          { event: "agent_message", text: "agent output" },
          { event: "error", message: "tool warning" }
        ]
      }),
      expect.any(Function)
    );
  });

  it("can run a command in streaming mode while reusing the command session", async () => {
    const run = vi.fn(async (openSpec: OpenSpec) => {
      openSpec.execution?.onStdout?.(
        `${JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "streamed output" }
        })}\n`
      );
      openSpec.execution?.onStderr?.("warning\n");
      return {
        kind: "sync",
        exitCode: 0,
        stdout: "captured stdout",
        stderr: "warning\n"
      };
    });
    resolvePoeCommandExecutionMock.mockReturnValue({
      factory: { type: "host" },
      state: { jobs: {} },
      detach: false,
      openSpec: createBaseOpenSpec()
    });
    createPoeCommandSessionMock.mockReturnValue({
      run,
      syncBack: vi.fn(),
      close: vi.fn()
    });

    const stderrChunks: string[] = [];
    const session = createSpawnSession({
      service: "codex",
      tee: {
        stderr: {
          write(chunk: string) {
            stderrChunks.push(chunk);
          }
        }
      }
    });

    const { events, result } = session.run(
      {
        prompt: "fix bug",
        syncBack: false
      },
      { streaming: true }
    );

    await expect(Promise.all([collect(events), result])).resolves.toEqual([
      [{ event: "agent_message", text: "streamed output" }],
      expect.objectContaining({ stdout: "captured stdout", stderr: "warning\n", exitCode: 0 })
    ]);
    expect(run).toHaveBeenCalledWith(expect.any(Object), undefined, { syncBack: false });
    expect(stderrChunks).toEqual(["warning\n"]);
  });
});

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function createBaseOpenSpec(onProgress?: OpenSpec["onProgress"]): OpenSpec {
  return {
    cwd: "/repo",
    runtimeCwd: "/config",
    runtime: { type: "host", mounts: [] },
    runner: {
      detach: false,
      sync: "both",
      workspace: { exclude: ["node_modules"] },
      upload_max_file_mb: 100,
      download_conflict: "refuse"
    },
    state: undefined,
    env: { BASE: "1" },
    uploadIgnoreFiles: [],
    jobLabel: {
      tool: "claude-code",
      argv: ["claude", "-p", ""]
    },
    ...(onProgress ? { onProgress } : {}),
    execution: {
      stdout: "pipe",
      stderr: "pipe",
      captureOutput: true
    }
  };
}
