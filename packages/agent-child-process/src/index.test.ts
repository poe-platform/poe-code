import { EventEmitter } from "node:events";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import * as api from "./index.js";
import {
  exec,
  execFile,
  spawn,
  AgentChildProcessError,
  type AgentChildProcessAttempt,
  type AgentChildProcessFollowUp,
  type AgentChildProcessHandle,
  type AgentChildProcessKind,
  type AgentChildProcessOptions,
  type AgentChildProcessResult,
  type AgentChildProcessRunAgent,
  type AgentExitPolicy,
  type SpawnProcess
} from "./index.js";

const spawnAgentMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/agent-spawn", () => ({
  spawn: spawnAgentMock
}));

type SpawnCall = Parameters<SpawnProcess>;

interface FakeChild extends EventEmitter {
  pid: number;
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill: ReturnType<typeof vi.fn>;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 123;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

function createSpawnHarness() {
  const children: FakeChild[] = [];
  const spawnProcess = vi.fn((() => {
    const child = createFakeChild();
    children.push(child);
    return child as unknown as ChildProcess;
  }) as SpawnProcess);

  return { children, spawnProcess };
}

function finish(
  child: FakeChild,
  options: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    signal?: NodeJS.Signals | null;
  } = {}
) {
  child.stdout.push(options.stdout ?? "");
  child.stderr.push(options.stderr ?? "");
  child.emit("close", options.exitCode ?? 0, options.signal ?? null);
  child.stdout.push(null);
  child.stderr.push(null);
}

describe("@poe-code/agent-child-process", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    spawnAgentMock.mockReset();
  });

  it("exports only the package root API", () => {
    expect(Object.keys(api).sort()).toEqual([
      "AgentChildProcessError",
      "exec",
      "execFile",
      "spawn"
    ]);
  });

  it("keeps public types available from the root", () => {
    expectTypeOf<SpawnProcess>().toEqualTypeOf<typeof nodeSpawn>();
    expectTypeOf<AgentChildProcessKind>().toEqualTypeOf<"exec" | "execFile" | "spawn">();
    expectTypeOf<AgentChildProcessAttempt>().toEqualTypeOf<{
      kind: AgentChildProcessKind;
      command: string;
      args: string[];
      cwd?: string;
      exitCode: number;
      signal?: NodeJS.Signals;
      stdout: string;
      stderr: string;
    }>();
    expectTypeOf<AgentChildProcessFollowUp>().toHaveProperty("agent").toEqualTypeOf<string>();
    expectTypeOf<AgentChildProcessResult>()
      .toHaveProperty("attempts")
      .toEqualTypeOf<[AgentChildProcessAttempt]>();
    expectTypeOf<AgentExitPolicy>()
      .toHaveProperty("when")
      .toEqualTypeOf<
        ((attempt: AgentChildProcessAttempt) => boolean | Promise<boolean>) | undefined
      >();
    expectTypeOf<AgentChildProcessOptions>().toHaveProperty("spawnProcess");
    expectTypeOf<AgentChildProcessOptions>().toHaveProperty("runAgent");
    expectTypeOf<AgentChildProcessOptions>().toHaveProperty("cwd");
    expectTypeOf<AgentChildProcessOptions>().toHaveProperty("env");
    expectTypeOf<AgentChildProcessOptions>().toHaveProperty("signal");
    expectTypeOf<AgentChildProcessOptions>().toHaveProperty("rejectOnNonZeroExit");
    expectTypeOf<AgentChildProcessOptions>().toHaveProperty("context");
    expectTypeOf<AgentChildProcessOptions>().toHaveProperty("onExit");
    expectTypeOf<AgentChildProcessOptions>().not.toHaveProperty("agent");
    expectTypeOf<AgentChildProcessOptions>().not.toHaveProperty("onFailure");
    expectTypeOf<AgentChildProcessOptions>().not.toHaveProperty("onSuccess");
    expectTypeOf<AgentChildProcessRunAgent>().parameters.toEqualTypeOf<
      [
        {
          agent: string;
          prompt: string;
          cwd?: string;
          model?: string;
          signal?: AbortSignal;
        }
      ]
    >();
    expectTypeOf<AgentChildProcessHandle>()
      .toHaveProperty("result")
      .toEqualTypeOf<Promise<AgentChildProcessResult>>();
    expectTypeOf(AgentChildProcessError).toBeConstructibleWith(
      "failed",
      {} as AgentChildProcessResult
    );
  });

  it("execFile delegates to the injected spawnProcess", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = execFile("npm", ["test"], { spawnProcess });

    finish(children[0]!);

    await expect(resultPromise).resolves.toMatchObject({
      kind: "execFile",
      command: "npm",
      args: ["test"],
      exitCode: 0
    });
    expect(spawnProcess).toHaveBeenCalledWith("npm", ["test"], {
      cwd: undefined,
      env: undefined,
      stdio: ["ignore", "pipe", "pipe"],
      signal: undefined
    });
  });

  it("execFile supports omitting args", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = execFile("node", { spawnProcess });

    finish(children[0]!);

    await expect(resultPromise).resolves.toMatchObject({
      kind: "execFile",
      command: "node",
      args: []
    });
    expect(spawnProcess).toHaveBeenCalledWith("node", [], {
      cwd: undefined,
      env: undefined,
      stdio: ["ignore", "pipe", "pipe"],
      signal: undefined
    });
  });

  it("rejects empty and whitespace-only command inputs before spawning", async () => {
    const spawnProcess = vi.fn((() => {
      throw new Error("spawn should not be called");
    }) as SpawnProcess);

    await expect(exec("", { spawnProcess })).rejects.toThrow("command must not be empty");
    await expect(exec("  ", { spawnProcess })).rejects.toThrow("command must not be empty");
    await expect(execFile("", { spawnProcess })).rejects.toThrow("file must not be empty");
    await expect(execFile("  ", { spawnProcess })).rejects.toThrow("file must not be empty");

    const handle = spawn("  ", { spawnProcess });
    await expect(handle.result).rejects.toThrow("file must not be empty");
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("captures stdout and stderr", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = execFile("npm", ["test"], { spawnProcess });

    finish(children[0]!, { stdout: "ok", stderr: "warn" });

    await expect(resultPromise).resolves.toMatchObject({
      stdout: "ok",
      stderr: "warn",
      attempts: [
        {
          stdout: "ok",
          stderr: "warn"
        }
      ]
    });
  });

  it("waits for late stdout after close before resolving", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = execFile("npm", ["test"], { spawnProcess });
    const child = children[0]!;

    child.emit("close", 0, null);
    child.stdout.push("late output");
    child.stdout.push(null);
    child.stderr.push(null);

    await expect(resultPromise).resolves.toMatchObject({ stdout: "late output", exitCode: 0 });
  });

  it("preserves UTF-8 characters split across stream chunks", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = execFile("npm", ["test"], { spawnProcess });
    const emoji = Buffer.from("🙂", "utf8");

    children[0]!.stdout.emit("data", emoji.subarray(0, 2));
    children[0]!.stdout.emit("data", emoji.subarray(2));
    children[0]!.stderr.emit("data", emoji.subarray(0, 1));
    children[0]!.stderr.emit("data", emoji.subarray(1));
    children[0]!.emit("close", 0, null);
    children[0]!.stdout.push(null);
    children[0]!.stderr.push(null);

    await expect(resultPromise).resolves.toMatchObject({
      stdout: "🙂",
      stderr: "🙂"
    });
  });

  it("resolves non-zero exits by default", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = execFile("npm", ["test"], { spawnProcess });

    finish(children[0]!, { exitCode: 2 });

    await expect(resultPromise).resolves.toMatchObject({ exitCode: 2 });
  });

  it("rejects non-zero exits when requested", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      rejectOnNonZeroExit: true
    });

    finish(children[0]!, { stderr: "failed", exitCode: 2 });

    await expect(resultPromise).rejects.toMatchObject({
      name: "AgentChildProcessError",
      result: {
        stderr: "failed",
        exitCode: 2
      }
    });
  });

  it("passes cwd, env, and signal through to spawnProcess", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const signal = new AbortController().signal;
    const env = { PATH: "/bin" };
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      cwd: "/repo",
      env,
      signal
    });

    finish(children[0]!);

    await resultPromise;
    const call = spawnProcess.mock.calls[0] as SpawnCall;
    expect(call[2]).toEqual({
      cwd: "/repo",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      signal
    });
  });

  it("exec maps to the platform shell and preserves the original command", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = exec("npm test", { spawnProcess });

    finish(children[0]!);

    const call = spawnProcess.mock.calls[0] as SpawnCall;
    if (process.platform === "win32") {
      expect(call[0]).toBe(process.env.ComSpec ?? "cmd.exe");
      expect(call[1]).toEqual(["/d", "/s", "/c", "npm test"]);
    } else {
      expect(call[0]).toBe(process.env.SHELL ?? "sh");
      expect(call[1]).toEqual(["-c", "npm test"]);
    }
    expect(call[2]).toMatchObject({
      stdio: ["ignore", "pipe", "pipe"]
    });
    await expect(resultPromise).resolves.toMatchObject({
      kind: "exec",
      command: "npm test",
      args: []
    });
  });

  it("exec uses the shell from the supplied child environment", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const env =
      process.platform === "win32"
        ? { ComSpec: "C:\\custom\\cmd.exe", PATH: "C:\\Windows" }
        : { SHELL: "/custom/shell", PATH: "/bin" };
    const resultPromise = exec("echo hi", { spawnProcess, env });

    finish(children[0]!);

    const call = spawnProcess.mock.calls[0] as SpawnCall;
    expect(call[0]).toBe(process.platform === "win32" ? env.ComSpec : env.SHELL);
    await resultPromise;
  });

  it("exec uses the documented shell fallback when the platform env var is absent", async () => {
    const { children, spawnProcess } = createSpawnHarness();

    if (process.platform === "win32") {
      vi.stubEnv("ComSpec", undefined);
    } else {
      vi.stubEnv("SHELL", undefined);
    }

    const resultPromise = exec("echo fallback", { spawnProcess });

    finish(children[0]!);

    const call = spawnProcess.mock.calls[0] as SpawnCall;
    if (process.platform === "win32") {
      expect(call[0]).toBe("cmd.exe");
      expect(call[1]).toEqual(["/d", "/s", "/c", "echo fallback"]);
    } else {
      expect(call[0]).toBe("sh");
      expect(call[1]).toEqual(["-c", "echo fallback"]);
    }
    await expect(resultPromise).resolves.toMatchObject({
      command: "echo fallback",
      args: []
    });
  });

  it("spawn returns a handle and delegates kill", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const handle = spawn("npm", ["test"], { spawnProcess });
    const stdoutChunks: string[] = [];

    handle.stdout?.on("data", (chunk) => stdoutChunks.push(String(chunk)));
    finish(children[0]!, { stdout: "ok" });

    expect(handle.pid).toBe(123);
    expect(handle.stdin).toBe(children[0]!.stdin);
    expect(handle.stdout).not.toBeNull();
    expect(handle.stderr).not.toBeNull();
    expect(handle.kill("SIGTERM")).toBe(true);
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
    expect(spawnProcess).toHaveBeenCalledWith("npm", ["test"], {
      cwd: undefined,
      env: undefined,
      stdio: ["pipe", "pipe", "pipe"],
      signal: undefined
    });
    await expect(handle.result).resolves.toMatchObject({ stdout: "ok" });
    expect(stdoutChunks.join("")).toBe("ok");
  });

  it("buffers spawned stdout and stderr for callers that attach listeners after early output", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const handle = spawn("worker", [], { spawnProcess });
    const child = children[0]!;

    child.stdout.push("early-out");
    child.stderr.push("early-err");

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    handle.stdout?.on("data", (chunk) => stdoutChunks.push(String(chunk)));
    handle.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));

    child.emit("close", 0, null);
    child.stdout.push(null);
    child.stderr.push(null);

    await expect(handle.result).resolves.toMatchObject({
      stdout: "early-out",
      stderr: "early-err"
    });
    expect(stdoutChunks.join("")).toBe("early-out");
    expect(stderrChunks.join("")).toBe("early-err");
  });

  it("spawn supports omitting args", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const handle = spawn("node", { spawnProcess });

    finish(children[0]!);

    const call = spawnProcess.mock.calls[0] as SpawnCall;
    expect(call[0]).toBe("node");
    expect(call[1]).toEqual([]);
    await expect(handle.result).resolves.toMatchObject({
      kind: "spawn",
      command: "node",
      args: []
    });
  });

  it("does not call an agent without onExit", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>();
    const resultPromise = execFile("npm", ["test"], { spawnProcess, runAgent });

    finish(children[0]!);

    await resultPromise;
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("calls the injected agent runner when onExit matches", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "agent out",
      stderr: "",
      exitCode: 0,
      threadId: "thread-1",
      usage: { inputTokens: 1, outputTokens: 2 },
      logFile: "/tmp/log"
    });
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      runAgent,
      cwd: "/repo",
      signal: new AbortController().signal,
      onExit: {
        agent: "codex",
        model: "gpt-5.2",
        prompt: "Fix this"
      }
    });

    finish(children[0]!, { stdout: "ok", stderr: "warn", exitCode: 2 });

    const result = await resultPromise;
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        model: "gpt-5.2",
        cwd: "/repo"
      })
    );
    expect(result).toMatchObject({
      exitCode: 2,
      agent: {
        agent: "codex",
        model: "gpt-5.2",
        stdout: "agent out",
        exitCode: 0,
        threadId: "thread-1",
        usage: { inputTokens: 1, outputTokens: 2 },
        logFile: "/tmp/log"
      }
    });
  });

  it("passes agent and model policy values directly without parsing agent:model locally", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const signal = new AbortController().signal;
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      runAgent,
      cwd: "/repo",
      signal,
      onExit: {
        agent: "codex:gpt-5.2",
        model: "openai/gpt-5.2",
        prompt: "Fix this"
      }
    });

    finish(children[0]!, { exitCode: 1 });
    await resultPromise;

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex:gpt-5.2",
        model: "openai/gpt-5.2",
        cwd: "/repo",
        signal
      })
    );
  });

  it("omits the agent model option when the policy does not provide a model", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      runAgent,
      onExit: {
        agent: "codex",
        prompt: "Fix this"
      }
    });

    finish(children[0]!, { exitCode: 1 });
    await resultPromise;

    expect(Object.hasOwn(runAgent.mock.calls[0]![0], "model")).toBe(false);
  });

  it("uses @poe-code/agent-spawn as the default agent runner", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const signal = new AbortController().signal;
    spawnAgentMock.mockResolvedValue({
      stdout: "agent out",
      stderr: "",
      exitCode: 0
    });
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      cwd: "/repo",
      signal,
      onExit: {
        agent: "codex",
        prompt: "Fix this"
      }
    });

    finish(children[0]!, { exitCode: 1 });
    await expect(resultPromise).resolves.toMatchObject({
      agent: {
        agent: "codex",
        stdout: "agent out",
        exitCode: 0
      }
    });
    expect(spawnAgentMock).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        cwd: "/repo",
        signal
      })
    );
    expect(Object.hasOwn(spawnAgentMock.mock.calls[0]![1], "model")).toBe(false);
  });

  it("skips the agent when when returns false", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>();
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      runAgent,
      onExit: {
        agent: "codex",
        prompt: "Fix this",
        when: () => false
      }
    });

    finish(children[0]!, { exitCode: 1 });

    await resultPromise;
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("supports async when policies", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      runAgent,
      onExit: {
        agent: "codex",
        prompt: "Fix this",
        when: async () => true
      }
    });

    finish(children[0]!, { exitCode: 1 });

    await resultPromise;
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("turns policy evaluation failures into AgentChildProcessError", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      onExit: {
        agent: "codex",
        prompt: "Fix this",
        when: () => {
          throw new Error("policy failed");
        }
      }
    });

    finish(children[0]!, { exitCode: 1 });

    await expect(resultPromise).rejects.toMatchObject({
      name: "AgentChildProcessError",
      message: "Agent exit policy evaluation failed",
      result: {
        attempts: [
          {
            command: "npm",
            exitCode: 1
          }
        ]
      }
    });
  });

  it("rejects blank agent exit policy fields before invoking the agent", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      runAgent,
      onExit: {
        agent: "   ",
        prompt: "   "
      }
    });

    finish(children[0]!, { stdout: "failed", stderr: "error", exitCode: 1 });

    await expect(resultPromise).rejects.toMatchObject({
      name: "AgentChildProcessError",
      message: "Agent exit policy is invalid",
      result: {
        command: "npm",
        exitCode: 1
      }
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("turns rejected async policy evaluation into AgentChildProcessError", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      onExit: {
        agent: "codex",
        prompt: "Fix this",
        when: async () => {
          throw new Error("policy rejected");
        }
      }
    });

    finish(children[0]!, { exitCode: 1 });

    await expect(resultPromise).rejects.toMatchObject({
      name: "AgentChildProcessError",
      message: "Agent exit policy evaluation failed",
      result: {
        attempts: [
          {
            command: "npm",
            exitCode: 1
          }
        ]
      }
    });
  });

  it("preserves command diagnostics when the agent follow-up rejects", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi
      .fn<AgentChildProcessRunAgent>()
      .mockRejectedValue(new Error("agent unavailable"));
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      runAgent,
      onExit: {
        agent: "codex",
        prompt: "Fix this"
      }
    });

    finish(children[0]!, { stderr: "original failure", exitCode: 1 });

    await expect(resultPromise).rejects.toMatchObject({
      name: "AgentChildProcessError",
      message: "Agent follow-up failed",
      result: {
        exitCode: 1,
        stderr: "original failure"
      },
      cause: {
        message: "agent unavailable"
      }
    });
  });

  it("keeps agent non-zero exits separate from the command exit code", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "agent",
      stderr: "agent failed",
      exitCode: 7
    });
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      runAgent,
      onExit: {
        agent: "codex",
        prompt: "Fix this"
      }
    });

    finish(children[0]!, { exitCode: 2 });

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 2,
      agent: {
        exitCode: 7,
        stderr: "agent failed"
      }
    });
  });

  it("rejectOnNonZeroExit rejects after attaching a matching agent follow-up", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "agent fixed files",
      stderr: "",
      exitCode: 0
    });
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      runAgent,
      rejectOnNonZeroExit: true,
      onExit: {
        agent: "codex",
        prompt: "Fix this"
      }
    });

    finish(children[0]!, { stderr: "failed", exitCode: 2 });

    await expect(resultPromise).rejects.toMatchObject({
      name: "AgentChildProcessError",
      result: {
        command: "npm",
        exitCode: 2,
        stderr: "failed",
        agent: {
          agent: "codex",
          stdout: "agent fixed files",
          exitCode: 0
        }
      }
    });
  });

  it("builds a structured follow-up prompt", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const resultPromise = execFile("npm", ["test"], {
      spawnProcess,
      runAgent,
      cwd: "/repo",
      context: "Package install failed after a dependency update.",
      onExit: {
        agent: "codex",
        prompt: "Fix the failing command."
      }
    });

    finish(children[0]!, { stdout: "out", stderr: "err", exitCode: 1 });
    await resultPromise;

    const prompt = runAgent.mock.calls[0]?.[0].prompt;
    expect(prompt).toContain("Fix the failing command.");
    expect(prompt).toContain("Kind: execFile");
    expect(prompt).toContain("Command file: npm");
    expect(prompt).toContain('Argv: ["test"]');
    expect(prompt).toContain("Cwd: /repo");
    expect(prompt).toContain("Exit code: 1");
    expect(prompt).toContain("out");
    expect(prompt).toContain("err");
    expect(prompt).toContain("Package install failed after a dependency update.");
    expect(prompt).toContain("historical facts from the original attempt");
  });

  it("builds an exec follow-up prompt with the original command string and empty argv", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const resultPromise = exec("npm test -- --runInBand", {
      spawnProcess,
      runAgent,
      onExit: {
        agent: "codex",
        prompt: "Explain the failure."
      }
    });

    finish(children[0]!, { stdout: "test output", stderr: "test error", exitCode: 1 });
    await resultPromise;

    const prompt = runAgent.mock.calls[0]?.[0].prompt;
    expect(prompt).toContain("Kind: exec");
    expect(prompt).toContain("Command string: npm test -- --runInBand");
    expect(prompt).toContain("Argv: []");
    expect(prompt).toContain("Stdout:\ntest output");
    expect(prompt).toContain("Stderr:\ntest error");
  });

  it("builds a spawn follow-up prompt with the original file and argv", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "agent output",
      stderr: "",
      exitCode: 0
    });
    const handle = spawn("npm", ["run", "build"], {
      spawnProcess,
      runAgent,
      onExit: {
        agent: "codex",
        prompt: "Inspect the spawned command."
      }
    });

    finish(children[0]!, { stdout: "build output", stderr: "build error", exitCode: 1 });
    const result = await handle.result;

    const prompt = runAgent.mock.calls[0]?.[0].prompt;
    expect(prompt).toContain("Kind: spawn");
    expect(prompt).toContain("Command file: npm");
    expect(prompt).toContain('Argv: ["run","build"]');
    expect(result.stdout).toBe("build output");
    expect(result.stderr).toBe("build error");
  });

  it("does not rerun the command or rewrite original output around follow-up", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "agent verification output",
      stderr: "agent verification error",
      exitCode: 0
    });
    const resultPromise = execFile("npm", ["test", "--", "--runInBand"], {
      spawnProcess,
      runAgent,
      onExit: {
        agent: "codex",
        prompt: "Diagnose the failing test command."
      }
    });

    finish(children[0]!, {
      stdout: "original stdout",
      stderr: "original stderr",
      exitCode: 1
    });

    const result = await resultPromise;
    const prompt = runAgent.mock.calls[0]?.[0].prompt;

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(result.stdout).toBe("original stdout");
    expect(result.stderr).toBe("original stderr");
    expect(result.agent).toMatchObject({
      stdout: "agent verification output",
      stderr: "agent verification error"
    });
    expect(prompt).toContain(
      "The stdout and stderr below are historical facts from the original attempt and must not be rewritten by this library."
    );
    expect(prompt).toContain("If verification or a rerun is needed, run commands yourself.");
  });

  it("converts child error events into failed attempts", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = execFile("missing", [], { spawnProcess });

    children[0]!.pid = undefined as unknown as number;
    children[0]!.emit("error", new Error("spawn failed"));
    children[0]!.stdout.push(null);
    children[0]!.stderr.push(null);

    await expect(resultPromise).resolves.toMatchObject({
      command: "missing",
      exitCode: 1,
      stderr: "spawn failed"
    });
  });

  it("does not settle on a nonterminal process error", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const handle = spawn("worker", [], { spawnProcess });
    const child = children[0]!;

    child.emit("error", new Error("kill failed"));
    child.stdout.push("still running output");
    finish(child);

    await expect(handle.result).resolves.toMatchObject({
      exitCode: 0,
      stdout: "still running output",
      stderr: "kill failed"
    });
  });

  it("turns stdout stream errors into failed attempts", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const resultPromise = execFile("command", [], { spawnProcess });
    const child = children[0]!;

    child.stdout.emit("error", new Error("stdout pipe failed"));
    child.emit("close", 0, null);
    child.stderr.push(null);

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 1,
      stderr: "stdout pipe failed"
    });
  });

  it("preserves the signal that terminated a child", async () => {
    const { children, spawnProcess } = createSpawnHarness();
    const handle = spawn("worker", [], { spawnProcess });

    finish(children[0]!, { exitCode: 1, signal: "SIGTERM" });

    await expect(handle.result).resolves.toMatchObject({ signal: "SIGTERM" });
  });

  it("rejects synchronous spawn failures because no attempt exists", async () => {
    const spawnProcess = vi.fn((() => {
      throw new Error("bad spawn");
    }) as SpawnProcess);

    await expect(execFile("missing", [], { spawnProcess })).rejects.toThrow("bad spawn");
  });

  it("returns a spawn handle whose result rejects for synchronous spawn failures", async () => {
    const spawnProcess = vi.fn((() => {
      throw new Error("bad spawn");
    }) as SpawnProcess);

    const handle = spawn("missing", [], { spawnProcess });

    expect(handle.pid).toBeUndefined();
    expect(handle.stdin).toBeNull();
    expect(handle.stdout).toBeNull();
    expect(handle.stderr).toBeNull();
    expect(handle.kill()).toBe(false);
    await expect(handle.result).rejects.toThrow("bad spawn");
  });

  it("runs fast real child processes", async () => {
    const success = await execFile(
      process.execPath,
      ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
      { spawnProcess: nodeSpawn }
    );

    const failure = await execFile(process.execPath, ["-e", "process.exit(3)"], {
      spawnProcess: nodeSpawn
    });

    expect(success).toMatchObject({ stdout: "out", stderr: "err", exitCode: 0 });
    expect(failure).toMatchObject({ exitCode: 3 });
  });

  it("runs a real child process and uses an injected agent follow-up", async () => {
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "agent follow-up",
      stderr: "",
      exitCode: 0
    });

    const result = await execFile(
      process.execPath,
      ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(4)"],
      {
        spawnProcess: nodeSpawn,
        runAgent,
        context: "Integration follow-up context.",
        onExit: {
          agent: "codex",
          prompt: "Inspect the failed command."
        }
      }
    );

    expect(result).toMatchObject({
      stdout: "out",
      stderr: "err",
      exitCode: 4,
      agent: {
        agent: "codex",
        stdout: "agent follow-up",
        stderr: "",
        exitCode: 0
      }
    });
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        prompt: expect.stringContaining("Integration follow-up context.")
      })
    );
  });

  it("passes env exactly to real child processes without merging process.env", async () => {
    const result = await execFile(
      process.execPath,
      [
        "-e",
        [
          "process.stdout.write(JSON.stringify({",
          "exact: process.env.EXACT_ONLY,",
          "path: process.env.PATH ?? null",
          "}));"
        ].join("")
      ],
      {
        spawnProcess: nodeSpawn,
        env: { EXACT_ONLY: "yes" }
      }
    );

    expect(JSON.parse(result.stdout)).toEqual({
      exact: "yes",
      path: null
    });
  });

  it("supports stdin for real spawned child processes", async () => {
    const handle = spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
      spawnProcess: nodeSpawn
    });

    expect(handle.stdin).not.toBeNull();
    handle.stdin!.end("input");

    await expect(handle.result).resolves.toMatchObject({
      stdout: "input",
      exitCode: 0
    });
  });

  it("keeps real spawned stdout readable while also capturing the result", async () => {
    const handle = spawn(
      process.execPath,
      ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
      { spawnProcess: nodeSpawn }
    );
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    handle.stdout?.on("data", (chunk) => stdoutChunks.push(String(chunk)));
    handle.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));

    await expect(handle.result).resolves.toMatchObject({
      stdout: "out",
      stderr: "err",
      exitCode: 0
    });
    expect(stdoutChunks.join("")).toBe("out");
    expect(stderrChunks.join("")).toBe("err");
  });

  it("turns real abort signal errors into failed attempts", async () => {
    const controller = new AbortController();
    const resultPromise = execFile(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
      spawnProcess: nodeSpawn,
      signal: controller.signal
    });

    controller.abort();

    await expect(resultPromise).resolves.toMatchObject({
      command: process.execPath,
      exitCode: 1
    });
    await expect(resultPromise).resolves.toHaveProperty("stderr", expect.any(String));
  });
});
