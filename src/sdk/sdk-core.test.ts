import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { ExperimentRunOptions } from "@poe-code/experiment-loop";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { resolveConfigPath } from "@poe-code/poe-code-config/core";
import { createCliContainer, type CliDependencies } from "../cli/container.js";
import type { FileSystem } from "../utils/file-system.js";
import type {
  CommandRunner,
  CommandRunnerOptions,
  CommandRunnerResult
} from "../utils/command-checks.js";

// container.test.ts
const createSecretStoreMock = vi.hoisted(() => vi.fn());
const createOptionResolversMock = vi.hoisted(() => vi.fn());

// launch.test.ts
const {
  followManagedLogsMock,
  listManagedProcessesMock,
  readManagedLogsMock,
  removeManagedProcessMock,
  restartManagedProcessMock,
  runManagedProcessMock,
  startManagedProcessMock,
  stopManagedProcessMock
} = vi.hoisted(() => ({
  followManagedLogsMock: vi.fn(),
  listManagedProcessesMock: vi.fn(),
  readManagedLogsMock: vi.fn(),
  removeManagedProcessMock: vi.fn(),
  restartManagedProcessMock: vi.fn(),
  runManagedProcessMock: vi.fn(),
  startManagedProcessMock: vi.fn(),
  stopManagedProcessMock: vi.fn()
}));

// spawn-core.test.ts
const resolveWorkspaceMock = vi.hoisted(() => vi.fn());
const hostRunnerExecMock = vi.hoisted(() => vi.fn(() => ({ pid: 42 })));

// experiment.test.ts
const runExperimentLoopMock = vi.hoisted(() => vi.fn());
const spawnAutonomousMock = vi.hoisted(() => vi.fn());
const runWithOptionalWorktreeMock = vi.hoisted(() => vi.fn());

vi.mock("auth-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("auth-store")>();
  return {
    ...actual,
    createSecretStore: createSecretStoreMock
  };
});

vi.mock("../cli/options.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cli/options.js")>();
  return {
    ...actual,
    createOptionResolvers: createOptionResolversMock
  };
});

vi.mock("@poe-code/process-launcher", () => ({
  followManagedLogs: followManagedLogsMock,
  listManagedProcesses: listManagedProcessesMock,
  readManagedLogs: readManagedLogsMock,
  removeManagedProcess: removeManagedProcessMock,
  restartManagedProcess: restartManagedProcessMock,
  runManagedProcess: runManagedProcessMock,
  startManagedProcess: startManagedProcessMock,
  stopManagedProcess: stopManagedProcessMock
}));

vi.mock("@poe-code/workspace-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/workspace-resolver")>();
  return {
    ...actual,
    resolveWorkspace: resolveWorkspaceMock
  };
});

vi.mock("@poe-code/process-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/process-runner")>();
  return {
    ...actual,
    createHostRunner: () => ({ exec: hostRunnerExecMock })
  };
});

vi.mock("@poe-code/experiment-loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/experiment-loop")>();
  return {
    ...actual,
    runExperimentLoop: runExperimentLoopMock
  };
});

vi.mock("./spawn.js", () => ({
  spawn: Object.assign(vi.fn(), {
    autonomous: spawnAutonomousMock
  })
}));

vi.mock("./worktree.js", () => ({
  runWithOptionalWorktree: runWithOptionalWorktreeMock
}));

import { createSdkContainer } from "./container.js";
import {
  followLaunchLogs,
  listLaunches,
  readLaunchLogs,
  removeLaunch,
  restartLaunch,
  runLaunchDaemon,
  startLaunch,
  stopLaunch
} from "./launch.js";
import { resolveWorkspace } from "@poe-code/workspace-resolver";
import { DEFAULT_SPAWN_MODE } from "@poe-code/agent-spawn";
import { resolveConfiguredModel, spawnCore } from "./spawn-core.js";
import { runExperiment } from "./experiment.js";

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

// ─── container.test.ts ───────────────────────────────────────────────────────

describe("createSdkContainer", () => {
  beforeEach(() => {
    createSecretStoreMock.mockReset();
    createOptionResolversMock.mockReset();
    createOptionResolversMock.mockReturnValue({
      ensure: vi.fn(),
      resolveModel: vi.fn(),
      resolveReasoning: vi.fn(),
      resolveConfigName: vi.fn(),
      resolveApiKey: vi.fn()
    });
  });

  it("uses auth store for SDK apiKeyStore read and write", async () => {
    const authStore = {
      get: vi.fn<() => Promise<string | null>>().mockResolvedValue("stored-key"),
      set: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      delete: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };

    createSecretStoreMock.mockReturnValue({
      backend: "file",
      store: authStore
    });

    const variables = { POE_AUTH_BACKEND: "file" };
    createSdkContainer({
      homeDir: "/sdk-home",
      variables
    });

    expect(createSecretStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({
        env: variables,
        platform: process.platform
      })
    );

    const createOptionResolversInput = createOptionResolversMock.mock.calls[0]?.[0];
    expect(createOptionResolversInput).toBeDefined();

    const storedKey = await createOptionResolversInput.apiKeyStore.read();
    expect(storedKey).toBe("stored-key");
    expect(authStore.get).toHaveBeenCalledTimes(1);

    await createOptionResolversInput.apiKeyStore.write("new-key");
    expect(authStore.set).toHaveBeenCalledWith("new-key");
  });
});

// ─── launch.test.ts ──────────────────────────────────────────────────────────

describe("launch sdk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostRunnerExecMock.mockReturnValue({ pid: 42 });
  });

  it("forwards start options to the process-launcher package", async () => {
    startManagedProcessMock.mockResolvedValue({ id: "api" });

    await startLaunch({
      cwd: "/repo",
      homeDir: "/home/test",
      spec: {
        id: "api",
        command: "npm",
        args: ["run", "dev"],
        restart: "on-failure"
      }
    });

    expect(startManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseDir: "/home/test/.poe-code/launch",
        spec: expect.objectContaining({
          command: "npm",
          id: "api"
        }),
        spawnDaemon: expect.any(Function)
      })
    );
  });

  it("resolves relative local spec.cwd before persisting the launch spec", async () => {
    startManagedProcessMock.mockResolvedValue({ id: "api" });

    await startLaunch({
      cwd: "/repo",
      homeDir: "/home/test",
      spec: {
        id: "api",
        command: "npm",
        args: ["run", "dev"],
        cwd: "./apps/api",
        restart: "on-failure"
      }
    });

    expect(startManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          cwd: "/repo/apps/api"
        })
      })
    );
  });

  it("preserves prototype-named daemon environment variables", async () => {
    startManagedProcessMock.mockImplementation(async (options: { spawnDaemon(id: string): Promise<number | null> }) => {
      await options.spawnDaemon("api");
      return { id: "api" } as never;
    });

    await startLaunch({
      cwd: "/repo",
      homeDir: "/home/test",
      variables: JSON.parse('{"__proto__":"visible"}') as Record<string, string>,
      spec: { id: "api", command: "npm", args: ["start"], restart: "never" }
    });

    const request = hostRunnerExecMock.mock.calls[0]?.[0];
    expect(Object.hasOwn(request.env, "__proto__")).toBe(true);
    expect(request.env.__proto__).toBe("visible");
  });

  it("preserves remote workspace locators in the persisted launch spec", async () => {
    startManagedProcessMock.mockResolvedValue({ id: "api" });

    await startLaunch({
      cwd: "/repo",
      homeDir: "/home/test",
      spec: {
        id: "api",
        command: "npm",
        args: ["run", "dev"],
        cwd: "github://poe-platform/poe-code",
        restart: "on-failure"
      }
    });

    expect(startManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          cwd: "github://poe-platform/poe-code"
        })
      })
    );
  });

  it("forwards the remaining launch operations", async () => {
    await stopLaunch({ homeDir: "/home/test", id: "api" });
    await restartLaunch({ homeDir: "/home/test", id: "api" });
    await listLaunches({ homeDir: "/home/test" });
    await readLaunchLogs({ homeDir: "/home/test", id: "api" });
    followLaunchLogs({ homeDir: "/home/test", id: "api" });
    await removeLaunch({ homeDir: "/home/test", id: "api" });
    await runLaunchDaemon({ homeDir: "/home/test", id: "api" });

    expect(stopManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
    expect(restartManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
    expect(listManagedProcessesMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch" })
    );
    expect(readManagedLogsMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
    expect(followManagedLogsMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
    expect(removeManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
    expect(runManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
  });

  it("falls back to direct pid signaling when the detached process group is missing", async () => {
    await stopLaunch({ homeDir: "/home/test", id: "api" });

    const stopOptions = stopManagedProcessMock.mock.calls[0]?.[0];
    expect(stopOptions?.signalProcess).toBeTypeOf("function");

    const error = new Error("kill ESRCH") as Error & { code?: string };
    error.code = "ESRCH";
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockImplementationOnce(() => true);

    stopOptions.signalProcess(123, "SIGTERM");

    expect(killSpy).toHaveBeenNthCalledWith(1, -123, "SIGTERM");
    expect(killSpy).toHaveBeenNthCalledWith(2, 123, "SIGTERM");
  });

  it("does not fall back when process group errors only inherit ESRCH", async () => {
    await stopLaunch({ homeDir: "/home/test", id: "api" });

    const stopOptions = stopManagedProcessMock.mock.calls[0]?.[0];
    expect(stopOptions?.signalProcess).toBeTypeOf("function");

    const error = new Error("kill denied");
    const killSpy = vi.spyOn(process, "kill").mockImplementationOnce(() => {
      throw error;
    });

    await withObjectPrototypeCode("ESRCH", async () => {
      expect(() => stopOptions.signalProcess(123, "SIGTERM")).toThrow(error);
    });

    expect(killSpy).toHaveBeenCalledOnce();
    expect(killSpy).toHaveBeenCalledWith(-123, "SIGTERM");
  });
});

// ─── spawn-core.test.ts ───────────────────────────────────────────────────────

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

interface CommandCall {
  command: string;
  args: string[];
  options?: CommandRunnerOptions;
}

function createCommandRunnerStub(
  result: CommandRunnerResult = { stdout: "", stderr: "", exitCode: 0 }
): { runner: CommandRunner; calls: CommandCall[] } {
  const calls: CommandCall[] = [];
  const runner: CommandRunner = async (command, args, options) => {
    const call: CommandCall = { command, args };
    if (options) {
      call.options = options;
    }
    calls.push(call);
    return { ...result };
  };
  return { runner, calls };
}

function createContainerWithDependencies(overrides: Partial<CliDependencies> = {}): {
  container: ReturnType<typeof createCliContainer>;
  logs: string[];
  commandCalls: CommandCall[];
} {
  const logs: string[] = [];
  const { runner, calls } = createCommandRunnerStub();
  const container = createCliContainer({
    fs: overrides.fs ?? createMemFs(),
    prompts: overrides.prompts ?? vi.fn().mockResolvedValue({}),
    env: overrides.env ?? { cwd, homeDir },
    commandRunner: overrides.commandRunner ?? runner,
    logger:
      overrides.logger ??
      ((message) => {
        logs.push(message);
      })
  });
  return { container, logs, commandCalls: calls };
}

describe("spawnCore", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createMemFs();
    vi.clearAllMocks();
    vi.mocked(resolveWorkspace).mockReset();
    vi.mocked(resolveWorkspace).mockImplementation(async (input, options) => ({
      cwd: path.isAbsolute(input) ? input : path.join(options.baseDir, input),
      locator: { scheme: "local", path: input }
    }));
  });

  it("prefers explicit model over configured values", async () => {
    await fs.writeFile(
      resolveConfigPath(homeDir),
      `${JSON.stringify({ models: { default: "anthropic/claude-opus-4.7", opencode: "openai/gpt-5.4" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const { container } = createContainerWithDependencies({ fs });

    await expect(
      resolveConfiguredModel(container, "opencode", "google/gemini-3-pro")
    ).resolves.toBe("google/gemini-3-pro");
  });

  it("ignores the global configured model when no explicit model exists", async () => {
    await fs.writeFile(
      resolveConfigPath(homeDir),
      `${JSON.stringify({ models: { default: "anthropic/claude-opus-4.7" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const { container } = createContainerWithDependencies({ fs });

    await expect(resolveConfiguredModel(container, "opencode")).resolves.toBeUndefined();
  });

  it("leaves the model unset when no explicit or configured model exists", async () => {
    const { container } = createContainerWithDependencies({ fs });

    await expect(resolveConfiguredModel(container, "opencode")).resolves.toBeUndefined();
  });

  async function ensureIsolatedConfig(service: string): Promise<void> {
    if (service === "codex") {
      await fs.mkdir(`${homeDir}/.poe-code/codex`, { recursive: true });
      await fs.writeFile(`${homeDir}/.poe-code/codex/config.toml`, "", { encoding: "utf8" });
      return;
    }
    if (service === "opencode") {
      await fs.mkdir(`${homeDir}/.poe-code/opencode/.config/opencode`, {
        recursive: true
      });
      await fs.writeFile(`${homeDir}/.poe-code/opencode/.config/opencode/config.json`, "{}", {
        encoding: "utf8"
      });
    }
  }

  it("throws error for unknown agent", async () => {
    const { container } = createContainerWithDependencies({ fs });

    await expect(spawnCore(container, "unknown-service", { prompt: "test" })).rejects.toThrow(
      /^Unknown agent "unknown-service"\. Agents supporting spawn: /
    );
  });

  it("returns SpawnResult with stdout, stderr, exitCode", async () => {
    const { runner } = createCommandRunnerStub({
      stdout: "output text",
      stderr: "error text",
      exitCode: 0
    });
    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    const result = await spawnCore(container, "opencode", {
      prompt: "test prompt"
    });

    expect(result).toEqual({
      stdout: "output text",
      stderr: "error text",
      exitCode: 0
    });
  });

  it("does not pass the configured model when no explicit model is provided", async () => {
    const { runner, calls } = createCommandRunnerStub({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    await fs.writeFile(
      resolveConfigPath(homeDir),
      `${JSON.stringify({ models: { opencode: "openai/gpt-5.4" } }, null, 2)}\n`,
      { encoding: "utf8" }
    );

    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    await spawnCore(container, "opencode", {
      prompt: "test prompt"
    });

    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall.args).not.toContain("poe/openai/gpt-5.4");
  });

  it("passes prompt and args to provider", async () => {
    const { runner, calls } = createCommandRunnerStub({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    await spawnCore(container, "opencode", {
      prompt: "fix the bug",
      args: ["--extra", "arg"]
    });

    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall.args).toContain("fix the bug");
    expect(lastCall.args).toContain("--extra");
    expect(lastCall.args).toContain("arg");
  });

  it("passes per-invocation environment overrides to providers", async () => {
    const { runner, calls } = createCommandRunnerStub();
    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    await spawnCore(container, "opencode", {
      prompt: "test prompt",
      env: { WORKSPACE_ID: "workspace-1" }
    });

    expect(calls.at(-1)?.options?.env).toMatchObject({ WORKSPACE_ID: "workspace-1" });
  });

  it("handles dry run mode", async () => {
    const { container, logs } = createContainerWithDependencies({ fs });
    await ensureIsolatedConfig("opencode");
    const prompt = "investigate token=sk-dry-run-secret";

    const result = await spawnCore(
      container,
      "codex",
      { prompt },
      { dryRun: true, verbose: false }
    );

    expect(result).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const joinedLogs = logs.join("\n");
    expect(joinedLogs).toContain("Dry run");
    expect(joinedLogs).toContain("[prompt redacted]");
    expect(joinedLogs).not.toContain("sk-dry-run-secret");
  });

  it("does not resolve workspace locators during dry run", async () => {
    const { container, logs } = createContainerWithDependencies({ fs });
    await ensureIsolatedConfig("opencode");

    const result = await spawnCore(
      container,
      "codex",
      {
        prompt: "test prompt",
        cwd: "github://poe-platform/poe-code"
      },
      { dryRun: true, verbose: false }
    );

    expect(result).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    expect(resolveWorkspace).not.toHaveBeenCalled();
    expect(logs.some((log) => log.includes("github://poe-platform/poe-code"))).toBe(true);
  });

  it("resolves relative cwd to absolute path", async () => {
    const { runner, calls } = createCommandRunnerStub({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    await spawnCore(container, "opencode", {
      prompt: "test",
      cwd: "subdir"
    });

    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall.options?.cwd).toBe("/repo/subdir");
  });

  it("preserves absolute cwd path", async () => {
    const { runner, calls } = createCommandRunnerStub({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    await spawnCore(container, "opencode", {
      prompt: "test",
      cwd: "/absolute/path"
    });

    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall.options?.cwd).toBe("/absolute/path");
  });

  it("resolves workspace locators before invoking providers", async () => {
    vi.mocked(resolveWorkspace).mockResolvedValue({
      cwd: "/tmp/workspaces/poe-code",
      locator: { scheme: "github", owner: "poe-platform", repo: "poe-code" }
    });
    const { runner, calls } = createCommandRunnerStub({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    const { container } = createContainerWithDependencies({
      fs,
      commandRunner: runner
    });
    await ensureIsolatedConfig("opencode");

    await spawnCore(container, "opencode", {
      prompt: "test",
      cwd: "github://poe-platform/poe-code",
      mode: "read"
    });

    expect(resolveWorkspace).toHaveBeenCalledWith(
      "github://poe-platform/poe-code",
      expect.objectContaining({
        baseDir: cwd,
        homeDir
      })
    );
    expect(calls.at(-1)?.options?.cwd).toBe("/tmp/workspaces/poe-code");
  });

  it("resolves an omitted mode before workspace resolution", async () => {
    vi.mocked(resolveWorkspace).mockResolvedValue({
      cwd: "/tmp/workspaces/poe-code",
      locator: { scheme: "github", owner: "poe-platform", repo: "poe-code" }
    });
    const { runner } = createCommandRunnerStub();
    const { container } = createContainerWithDependencies({ fs, commandRunner: runner });
    await ensureIsolatedConfig("opencode");

    await spawnCore(container, "opencode", {
      prompt: "test",
      cwd: "github://poe-platform/poe-code"
    });

    expect(resolveWorkspace).toHaveBeenCalledWith(
      "github://poe-platform/poe-code",
      expect.objectContaining({ mode: DEFAULT_SPAWN_MODE })
    );
  });

  it("preserves successful provider output when workspace cleanup fails", async () => {
    vi.mocked(resolveWorkspace).mockResolvedValue({
      cwd: "/tmp/workspaces/poe-code",
      cleanup: vi.fn(async () => {
        throw new Error("workspace cleanup denied");
      }),
      locator: { scheme: "github", owner: "poe-platform", repo: "poe-code" }
    });
    const { runner } = createCommandRunnerStub({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
    const { container } = createContainerWithDependencies({ fs, commandRunner: runner });
    await ensureIsolatedConfig("opencode");

    await expect(
      spawnCore(container, "opencode", {
        prompt: "test",
        cwd: "github://poe-platform/poe-code",
        mode: "edit"
      })
    ).resolves.toEqual({ stdout: "done", stderr: "", exitCode: 0 });
  });

  it("returns empty result when provider returns void", async () => {
    const { container } = createContainerWithDependencies({ fs });

    const originalGet = container.registry.get.bind(container.registry);
    vi.spyOn(container.registry, "get").mockImplementation((name) => {
      const adapter = originalGet(name);
      if (adapter && name === "opencode") {
        return {
          ...adapter,
          spawn: async () => undefined
        };
      }
      return adapter;
    });
    await ensureIsolatedConfig("opencode");

    const result = await spawnCore(container, "opencode", {
      prompt: "test"
    });

    expect(result).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
  });
});

// ─── experiment.test.ts ───────────────────────────────────────────────────────

describe("SDK experiment", () => {
  beforeEach(() => {
    runExperimentLoopMock.mockReset();
    spawnAutonomousMock.mockReset();
    runWithOptionalWorktreeMock.mockReset();
    runWithOptionalWorktreeMock.mockImplementation(async (input) => ({
      value: await input.run({
        sourceCwd: input.cwd,
        worktreeCwd: "/repo/.poe-code/worktrees/experiment-wt",
        worktree: {
          name: "experiment-wt",
          path: "/repo/.poe-code/worktrees/experiment-wt",
          branch: "poe-code/experiment-wt",
          baseBranch: "HEAD",
          createdAt: "2026-06-24T00:00:00.000Z",
          source: "sdk",
          agent: input.selectedAgent,
          status: "active",
          sourceCwd: input.cwd
        }
      })
    }));
  });

  it("forwards CLI-parity options and wires the default agent runner", async () => {
    const expectedResult = {
      stopReason: "max_experiments" as const,
      docPath: "docs/loop.md",
      experimentsCompleted: 3,
      experimentsKept: 2,
      totalDurationMs: 1200
    };
    const onExperimentStart = vi.fn();
    const onExperimentComplete = vi.fn();
    let capturedOptions: ExperimentRunOptions | undefined;

    runExperimentLoopMock.mockImplementationOnce(async (options: ExperimentRunOptions) => {
      capturedOptions = options;
      return expectedResult;
    });

    spawnAutonomousMock.mockResolvedValue({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });

    const result = await runExperiment({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "docs/loop.md",
      agent: "codex",
      model: "gpt-5.2",
      runtime: "docker",
      mountPoeCode: true,
      maxExperiments: 3,
      onExperimentStart,
      onExperimentComplete
    });

    expect(result).toEqual(expectedResult);
    expect(capturedOptions).toEqual(
      expect.objectContaining({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: "docs/loop.md",
        agent: "codex",
        model: "gpt-5.2",
        maxExperiments: 3,
        onExperimentStart,
        onExperimentComplete,
        runAgent: expect.any(Function)
      })
    );

    const agentResult = await capturedOptions?.runAgent?.({
      agent: "codex",
      prompt: "Improve the metric",
      cwd: "/repo",
      model: "gpt-5.2"
    });

    expect(spawnAutonomousMock).toHaveBeenCalledWith("codex", {
      prompt: "Improve the metric",
      cwd: "/repo",
      model: "gpt-5.2",
      runtime: "docker",
      mountPoeCode: true,
      worktree: false
    });
    expect(spawnAutonomousMock.mock.calls[0]?.[1]).not.toHaveProperty("mode");
    expect(agentResult).toEqual({
      stdout: "done",
      stderr: "",
      exitCode: 0
    });
  });

  it("preserves a caller-provided experiment agent runner", async () => {
    const runAgent = vi.fn().mockResolvedValue({ stdout: "custom", stderr: "", exitCode: 0 });
    runExperimentLoopMock.mockImplementationOnce(async (options: ExperimentRunOptions) => {
      await options.runAgent?.({ agent: "codex", prompt: "custom", cwd: "/repo" });
      return {
        stopReason: "max_experiments",
        docPath: "docs/loop.md",
        experimentsCompleted: 1,
        experimentsKept: 0,
        totalDurationMs: 1
      };
    });

    await runExperiment({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "docs/loop.md",
      runAgent
    });

    expect(runAgent).toHaveBeenCalledOnce();
    expect(spawnAutonomousMock).not.toHaveBeenCalled();
  });

  it("forwards per-attempt log routing to autonomous spawn", async () => {
    runExperimentLoopMock.mockImplementationOnce(async (options: ExperimentRunOptions) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "log attempt",
        cwd: "/repo",
        logDir: "/tmp/experiment/logs",
        logFileName: "attempt.jsonl"
      });
      return {
        stopReason: "max_experiments",
        docPath: "docs/loop.md",
        experimentsCompleted: 1,
        experimentsKept: 0,
        totalDurationMs: 1
      };
    });
    spawnAutonomousMock.mockResolvedValue({ stdout: "done", stderr: "", exitCode: 0 });

    await runExperiment({ cwd: "/repo", homeDir: "/home/test", docPath: "docs/loop.md" });

    expect(spawnAutonomousMock).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        logDir: "/tmp/experiment/logs",
        logFileName: "attempt.jsonl"
      })
    );
  });

  it("wraps the whole experiment run in one worktree when enabled", async () => {
    runExperimentLoopMock.mockImplementationOnce(async (options: ExperimentRunOptions) => ({
      stopReason: "max_experiments",
      docPath: options.docPath,
      experimentsCompleted: 1,
      experimentsKept: 1,
      totalDurationMs: 1
    }));

    const result = await runExperiment({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/docs/plans/experiment.md",
      agent: "codex",
      worktree: true
    });

    expect(runWithOptionalWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        selectedAgent: "codex",
        worktree: true,
        run: expect.any(Function)
      })
    );
    expect(runExperimentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo/.poe-code/worktrees/experiment-wt",
        docPath: "/repo/docs/plans/experiment.md"
      })
    );
    expect(result).toMatchObject({
      stopReason: "max_experiments",
      experimentsCompleted: 1,
      experimentsKept: 1
    });
  });
});
