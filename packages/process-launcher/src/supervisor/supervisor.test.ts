import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Volume, createFsFromVolume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";
import type {
  LauncherFileSystem,
  ProcessSpec,
  ProcessState,
  SupervisorOptions
} from "../types.js";

const resolveWorkspaceMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

vi.mock("@poe-code/workspace-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/workspace-resolver")>();
  return {
    ...actual,
    resolveWorkspace: resolveWorkspaceMock
  };
});

import { createSupervisor } from "./supervisor.js";
import { createSupervisor as createSupervisorFromIndex } from "../index.js";

type TestSupervisorOptions = Partial<SupervisorOptions> & {
  readyChecker?: (check: ReadyCheck, options: { signal?: AbortSignal }) => Promise<boolean>;
  spec?: Partial<ProcessSpec>;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resolveWorkspaceMock.mockReset();
  spawnMock.mockReset();
});

async function withObjectPrototypeProperties(
  properties: Record<string, unknown>,
  callback: () => Promise<void>
): Promise<void> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value
    });
  }

  try {
    await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("createSupervisor", () => {
  it("is exported from the package entrypoint", () => {
    expect(createSupervisorFromIndex).toBe(createSupervisor);
  });

  it("start() transitions to running and calls onStatusChange", async () => {
    const changes: ProcessState[] = [];
    const supervisor = createTestSupervisor({
      runner: createMockRunner([{ pid: 123, exitCode: 0, exitAfterMs: 10_000 }]),
      onStatusChange: state => {
        changes.push(state);
      }
    });

    await supervisor.start();

    expect(supervisor.getState()).toMatchObject({
      pid: 123,
      restartCount: 0,
      status: "running"
    });
    expect(changes.map(state => state.status)).toEqual(["running"]);

    await supervisor.stop();
  });

  it("persists the exit that killed a process before it could report running", async () => {
    vi.useFakeTimers();
    const changes: ProcessState[] = [];
    const { fs } = createMemFs();
    const supervisor = createSupervisor({
      fs,
      onStatusChange: state => {
        changes.push(state);
      },
      runner: createMockRunner([{ pid: 321, exitCode: 3, exitAfterMs: 5 }]),
      spec: createSpec({ restart: "never" }),
      stateDir: "/state"
    });

    const started = supervisor.start();
    await vi.advanceTimersByTimeAsync(250);
    await started;

    expect(changes.map(state => state.status)).not.toContain("running");
    expect(supervisor.getState()).toMatchObject({
      lastExitCode: 3,
      pid: null,
      status: "stopped"
    });
    await expect(fs.readFile("/state/process/state.json", "utf8")).resolves.toContain(
      '"lastExitCode": 3'
    );
  });

  it("reports running once the process survives the start settle window", async () => {
    vi.useFakeTimers();
    const supervisor = createTestSupervisor({
      runner: createMockRunner([{ pid: 123, exitCode: 0, exitAfterMs: 10_000 }]),
      startSettleMs: 250
    });

    const started = supervisor.start();
    await vi.advanceTimersByTimeAsync(249);
    expect(supervisor.getState().status).not.toBe("running");

    await vi.advanceTimersByTimeAsync(1);
    await started;

    expect(supervisor.getState()).toMatchObject({ pid: 123, status: "running" });

    await supervisor.stop();
  });

  it("process exits 0 with restart never and stays stopped", async () => {
    vi.useFakeTimers();
    const supervisor = createTestSupervisor({
      runner: createMockRunner([{ exitCode: 0, exitAfterMs: 5 }]),
      spec: { restart: "never" }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(5);

    expect(supervisor.getState()).toMatchObject({
      lastExitCode: 0,
      pid: null,
      status: "stopped"
    });
  });

  it("process exits 1 with restart on-failure and restarts with backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const runner = createRecordingRunner([
      { pid: 1, exitCode: 1, exitAfterMs: 5 },
      { pid: 2, exitCode: 0, exitAfterMs: 10_000 }
    ]);
    const supervisor = createTestSupervisor({
      runner,
      spec: { restart: "on-failure" }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(5);

    expect(supervisor.getState()).toMatchObject({
      lastExitCode: 1,
      restartCount: 1,
      status: "restarting"
    });
    expect(runner.execTimes).toEqual([0]);

    await vi.advanceTimersByTimeAsync(999);
    expect(runner.execTimes).toEqual([0]);

    await vi.advanceTimersByTimeAsync(1);
    expect(runner.execTimes).toEqual([0, 1005]);
    expect(supervisor.getState()).toMatchObject({
      pid: 2,
      restartCount: 1,
      status: "running"
    });

    await supervisor.stop();
  });

  it("process exits 0 with restart on-failure and stays stopped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const runner = createRecordingRunner([{ exitCode: 0, exitAfterMs: 5 }]);
    const supervisor = createTestSupervisor({
      runner,
      spec: { restart: "on-failure" }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(5);

    expect(runner.execTimes).toEqual([0]);
    expect(supervisor.getState()).toMatchObject({
      lastExitCode: 0,
      status: "stopped"
    });
  });

  it("process exits 0 with restart always and restarts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const runner = createRecordingRunner([
      { pid: 1, exitCode: 0, exitAfterMs: 5 },
      { pid: 2, exitCode: 0, exitAfterMs: 10_000 }
    ]);
    const supervisor = createTestSupervisor({
      runner,
      spec: { restart: "always" }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(runner.execTimes).toEqual([0, 1005]);
    expect(supervisor.getState()).toMatchObject({
      pid: 2,
      restartCount: 1,
      status: "running"
    });

    await supervisor.stop();
  });

  it("max restarts exceeded transitions to crashed and stops retrying", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const runner = createRecordingRunner([
      { pid: 1, exitCode: 1, exitAfterMs: 1 },
      { pid: 2, exitCode: 1, exitAfterMs: 1 },
      { pid: 3, exitCode: 1, exitAfterMs: 1 }
    ]);
    const supervisor = createTestSupervisor({
      runner,
      spec: { restart: "on-failure", maxRestarts: 2 }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(1);

    expect(runner.execTimes).toEqual([0, 1001, 3002]);
    expect(supervisor.getState()).toMatchObject({
      lastExitCode: 1,
      pid: null,
      restartCount: 2,
      status: "crashed"
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(runner.execTimes).toEqual([0, 1001, 3002]);
  });

  it("treats maxRestarts 0 as unlimited restarts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const runner = createRecordingRunner([
      { pid: 1, exitCode: 1, exitAfterMs: 1 },
      { pid: 2, exitCode: 1, exitAfterMs: 1 },
      { pid: 3, exitCode: 0, exitAfterMs: 10_000 }
    ]);
    const supervisor = createTestSupervisor({
      runner,
      spec: { restart: "on-failure", maxRestarts: 0 }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(runner.execTimes).toEqual([0, 1001, 3002]);
    expect(supervisor.getState()).toMatchObject({
      pid: 3,
      restartCount: 2,
      status: "running"
    });

    await supervisor.stop();
  });

  it("uses exponential backoff with a cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const runner = createRecordingRunner([
      { exitCode: 1, exitAfterMs: 1 },
      { exitCode: 1, exitAfterMs: 1 },
      { exitCode: 1, exitAfterMs: 1 },
      { exitCode: 0, exitAfterMs: 10_000 }
    ]);
    const supervisor = createTestSupervisor({
      runner,
      spec: {
        backoffMs: 1_000,
        maxBackoffMs: 2_500,
        maxRestarts: 4,
        restart: "always"
      }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(2_500);

    expect(runner.execTimes).toEqual([0, 1001, 3002, 5503]);

    await supervisor.stop();
  });

  it("resets restartCount after 60 seconds of stable uptime", async () => {
    vi.useFakeTimers();
    const supervisor = createTestSupervisor({
      runner: createMockRunner([
        { pid: 1, exitCode: 1, exitAfterMs: 1 },
        { pid: 2, exitCode: 0, exitAfterMs: 61_000 }
      ]),
      spec: { restart: "on-failure" }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(supervisor.getState().restartCount).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(supervisor.getState().restartCount).toBe(0);
  });

  it("stop() calls kill, waits, and marks the process stopped", async () => {
    vi.useFakeTimers();
    const handle = createControllableHandle();
    const runner = {
      name: "controllable",
      exec: vi.fn(() => handle)
    };
    const supervisor = createTestSupervisor({ runner });

    await supervisor.start();
    const stopPromise = supervisor.stop();

    expect(handle.kill).toHaveBeenCalledWith("SIGTERM");
    expect(supervisor.getState().status).toBe("running");

    handle.finish({ exitCode: 0 });
    await stopPromise;

    expect(supervisor.getState()).toMatchObject({
      pid: null,
      status: "stopped"
    });
  });

  it("stop() escalates to SIGKILL after 5 seconds when the process does not exit", async () => {
    vi.useFakeTimers();
    const handle = createControllableHandle();
    handle.kill.mockImplementation((signal?: NodeJS.Signals) => {
      if (signal === "SIGKILL") {
        handle.finish({ exitCode: 137 });
      }
    });
    const runner = {
      name: "controllable",
      exec: vi.fn(() => handle)
    };
    const supervisor = createTestSupervisor({ runner });

    await supervisor.start();
    const stopPromise = supervisor.stop();

    await vi.advanceTimersByTimeAsync(5_000);
    await stopPromise;

    expect(handle.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(handle.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(supervisor.getState().status).toBe("stopped");
  });

  it("restart() stops then starts again", async () => {
    const first = createControllableHandle(11);
    const second = createControllableHandle(22);
    const runner = {
      name: "controllable",
      exec: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    };
    const supervisor = createTestSupervisor({ runner });

    await supervisor.start();
    first.finish({ exitCode: 0 });
    await supervisor.restart();

    expect(first.kill).toHaveBeenCalledWith("SIGTERM");
    expect(runner.exec).toHaveBeenCalledTimes(2);
    expect(supervisor.getState()).toMatchObject({
      pid: 22,
      status: "running"
    });

    second.finish({ exitCode: 0 });
    await supervisor.stop();
  });

  it("ready check with log pattern becomes running only after the pattern appears", async () => {
    vi.useFakeTimers();
    const supervisor = createTestSupervisor({
      runner: createMockRunner([
        {
          exitCode: 0,
          exitAfterMs: 10_000,
          stdout: ["booting\n", "server ready\n"],
          stdoutInterval: 10
        }
      ]),
      spec: {
        readyCheck: { kind: "log-pattern", pattern: "ready" },
        restart: "never"
      }
    });

    const startPromise = supervisor.start();

    await vi.advanceTimersByTimeAsync(10);
    expect(supervisor.getState().status).not.toBe("running");

    await vi.advanceTimersByTimeAsync(10);
    await startPromise;

    expect(supervisor.getState().status).toBe("running");

    await supervisor.stop();
  });

  it("ready check with log pattern observes matching partial output before newline", async () => {
    const stdout = new PassThrough();
    const handle = createControllableHandle();
    handle.stdout = stdout;
    handle.kill.mockImplementation(() => {
      stdout.end();
      handle.finish({ exitCode: 0 });
    });
    const logs: Array<{ line: string; stream: "stdout" | "stderr" }> = [];
    const supervisor = createTestSupervisor({
      onLog: (line, stream) => {
        logs.push({ line, stream });
      },
      runner: { name: "controllable", exec: vi.fn(() => handle) },
      spec: { readyCheck: { kind: "log-pattern", pattern: "READY" }, restart: "never" }
    });

    const startPromise = supervisor.start();
    await vi.waitFor(() => {
      expect(supervisor.getState().status).toBe("restarting");
    });

    stdout.write("READY");
    await expect(startPromise).resolves.toBeUndefined();

    expect(supervisor.getState().status).toBe("running");
    expect(logs).toEqual([]);

    await supervisor.stop();
  });

  it("concurrent start calls wait for the same readiness check", async () => {
    vi.useFakeTimers();
    const supervisor = createTestSupervisor({
      runner: createMockRunner([{ exitCode: 0, exitAfterMs: 10_000, stdout: ["ready\n"], stdoutInterval: 20 }]),
      spec: { readyCheck: { kind: "log-pattern", pattern: "ready" }, restart: "never" }
    });
    let secondSettled = false;
    const first = supervisor.start();
    await vi.advanceTimersByTimeAsync(1);
    const second = supervisor.start().then(() => {
      secondSettled = true;
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(secondSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(10);
    await Promise.all([first, second]);
    expect(supervisor.getState().status).toBe("running");

    await supervisor.stop();
  });

  it("observes readiness output emitted while startup state is persisting", async () => {
    const stdout = new PassThrough();
    const handle = createControllableHandle();
    handle.stdout = stdout;
    const { fs } = createMemFs();
    const originalWriteFile = fs.writeFile.bind(fs);
    let releaseWrite: (() => void) | null = null;
    let blocksFirstState = true;
    fs.writeFile = vi.fn(async (filePath: string, content: string, options) => {
      if (
        blocksFirstState &&
        filePath.includes("state.json.") &&
        filePath.endsWith(".tmp")
      ) {
        blocksFirstState = false;
        await new Promise<void>(resolve => {
          releaseWrite = resolve;
        });
      }
      await originalWriteFile(filePath, content, options);
    });
    const supervisor = createTestSupervisor({
      fs,
      runner: { name: "controllable", exec: vi.fn(() => handle) },
      spec: { readyCheck: { kind: "log-pattern", pattern: "READY" }, restart: "never" }
    });

    const startPromise = supervisor.start();
    await vi.waitFor(() => {
      expect(releaseWrite).not.toBeNull();
    });
    stdout.write("READY\n");
    releaseWrite?.();
    await expect(startPromise).resolves.toBeUndefined();
    expect(supervisor.getState().status).toBe("running");

    handle.finish({ exitCode: 0 });
    await supervisor.stop();
  });

  it("rejects startup when readiness fails", async () => {
    const handle = createControllableHandle();
    const readyChecker = vi.fn(async () => false);
    handle.kill.mockImplementation(() => {
      handle.finish({ exitCode: 1 });
    });
    const supervisor = createTestSupervisor({
      readyChecker,
      runner: { name: "controllable", exec: vi.fn(() => handle) },
      spec: { readyCheck: { kind: "tcp", port: 42_424, timeoutMs: 1 }, restart: "never" }
    });

    await expect(supervisor.start()).rejects.toThrow(/readiness/i);
    expect(readyChecker).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tcp", port: 42_424 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(handle.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("escalates readiness-failure shutdown to SIGKILL when SIGTERM is ignored", async () => {
    vi.useFakeTimers();
    const handle = createControllableHandle();
    handle.kill.mockImplementation((signal?: NodeJS.Signals) => {
      if (signal === "SIGKILL") {
        handle.finish({ exitCode: 137 });
      }
    });
    const supervisor = createTestSupervisor({
      runner: { name: "controllable", exec: vi.fn(() => handle) },
      spec: { readyCheck: { kind: "log-pattern", pattern: "READY" }, restart: "never" }
    });

    let settled = false;
    const startPromise = supervisor.start().finally(() => {
      settled = true;
    });
    const startupFailure = expect(startPromise).rejects.toThrow(/readiness/i);

    await vi.waitFor(() => expect(supervisor.getState().status).toBe("restarting"));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(handle.kill).toHaveBeenCalledWith("SIGTERM");
    expect(handle.kill).not.toHaveBeenCalledWith("SIGKILL");
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);

    await startupFailure;
    expect(handle.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(handle.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });

  it("rejects initial startup when it crashes before readiness", async () => {
    vi.useFakeTimers();
    const supervisor = createTestSupervisor({
      runner: createMockRunner([
        { pid: 101, exitCode: 1, exitAfterMs: 1 },
        { pid: 202, exitCode: 0, exitAfterMs: 10_000 }
      ]),
      spec: { backoffMs: 0, readyCheck: { kind: "log-pattern", pattern: "READY" }, restart: "on-failure" }
    });
    const started = supervisor.start();
    const startupFailure = expect(started).rejects.toThrow(/readiness/i);

    await vi.advanceTimersByTimeAsync(1);
    await startupFailure;
  });

  it("persists replacement pid while restarted readiness is pending", async () => {
    vi.useFakeTimers();
    const { fs } = createMemFs();
    const first = createControllableHandle(101);
    const second = createControllableHandle(202);
    second.kill.mockImplementation(() => {
      second.finish({ exitCode: 0 });
    });
    const firstStdout = new PassThrough();
    first.stdout = firstStdout;
    second.stdout = new PassThrough();
    const supervisor = createTestSupervisor({
      fs,
      runner: { name: "controllable", exec: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) },
      spec: { backoffMs: 0, readyCheck: { kind: "log-pattern", pattern: "READY" }, restart: "on-failure" }
    });
    const started = supervisor.start();
    await Promise.resolve();
    firstStdout.write("READY\n");
    await started;
    firstStdout.end();
    first.finish({ exitCode: 1 });
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    const persisted = JSON.parse(await fs.readFile("/state/process/state.json", "utf8")) as ProcessState;
    expect(persisted).toMatchObject({ pid: 202, status: "restarting" });
    expect(supervisor.getState()).toMatchObject({ pid: 202, status: "restarting" });

    await supervisor.stop();
  });

  it("ready check with tcp polls until the port responds", async () => {
    const readyChecker = vi.fn(async () => true);
    const supervisor = createTestSupervisor({
      readyChecker,
      runner: createMockRunner([{ exitCode: 0, exitAfterMs: 10_000 }]),
      spec: {
        readyCheck: { kind: "tcp", port: 42_424, timeoutMs: 2_000 },
        restart: "never"
      }
    });

    await supervisor.start();

    expect(supervisor.getState().status).toBe("running");
    expect(readyChecker).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tcp", port: 42_424 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    await supervisor.stop();
  });

  it("rotates logs on each restart", async () => {
    vi.useFakeTimers();
    const { fs } = createMemFs();
    const supervisor = createTestSupervisor({
      fs,
      runner: createMockRunner([
        { exitCode: 1, exitAfterMs: 5, stdout: ["first run\n"] },
        { exitCode: 1, exitAfterMs: 5, stdout: ["second run\n"] },
        { exitCode: 0, exitAfterMs: 10_000, stdout: ["third run\n"] }
      ]),
      spec: { restart: "on-failure", maxRestarts: 3 }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await fs.readFile("/state/process/logs/stdout.2.log", "utf8")).toBe("first run\n");
    expect(await fs.readFile("/state/process/logs/stdout.1.log", "utf8")).toBe("second run\n");

    await supervisor.stop();
  });

  it("writes state.json on every status change", async () => {
    vi.useFakeTimers();
    const { fs, stateWrites } = createMemFs();
    const supervisor = createTestSupervisor({
      fs,
      runner: createMockRunner([
        { pid: 1, exitCode: 1, exitAfterMs: 5 },
        { pid: 2, exitCode: 0, exitAfterMs: 10_000 }
      ]),
      spec: { restart: "on-failure" }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(5);
    await vi.waitFor(() => expect(stateWrites).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(stateWrites).toHaveLength(3));
    await supervisor.stop();
    await vi.waitFor(() => expect(stateWrites).toHaveLength(4));

    expect(stateWrites).toHaveLength(4);
    expect(stateWrites.map(content => JSON.parse(content).status)).toEqual([
      "running",
      "restarting",
      "running",
      "stopped"
    ]);
    expect(stateWrites.at(-1)).toContain('"status": "stopped"');
  });

  it("abort signal shuts the supervisor down cleanly", async () => {
    const controller = new AbortController();
    const handle = createControllableHandle();
    const runner = {
      name: "controllable",
      exec: vi.fn(() => handle)
    };
    const supervisor = createTestSupervisor({
      runner,
      signal: controller.signal
    });

    await supervisor.start();
    controller.abort();
    handle.finish({ exitCode: 0 });
    await Promise.resolve();
    await Promise.resolve();

    expect(handle.kill).toHaveBeenCalledWith("SIGTERM");
    expect(supervisor.getState().status).toBe("stopped");
  });

  it("reports abort-triggered stop persistence failures", async () => {
    const controller = new AbortController();
    const handle = createControllableHandle();
    handle.kill.mockImplementation(() => handle.finish({ exitCode: 0 }));
    const { fs } = createMemFs();
    const originalRename = fs.rename.bind(fs);
    let persistedStates = 0;
    fs.rename = vi.fn(async (sourcePath: string, destinationPath: string) => {
      persistedStates += 1;
      if (persistedStates === 2) {
        throw new Error("stop state offline");
      }
      await originalRename(sourcePath, destinationPath);
    });
    const onError = vi.fn();
    const supervisor = createTestSupervisor({ fs, onError, runner: { name: "controllable", exec: vi.fn(() => handle) }, signal: controller.signal });

    await supervisor.start();
    controller.abort();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "stop state offline" })));
  });

  it("reports terminal-state persistence failure after process exit", async () => {
    vi.useFakeTimers();
    const { fs } = createMemFs();
    const originalRename = fs.rename.bind(fs);
    let persistedStates = 0;
    fs.rename = vi.fn(async (sourcePath: string, destinationPath: string) => {
      persistedStates += 1;
      if (persistedStates === 2) {
        throw new Error("exit state offline");
      }
      await originalRename(sourcePath, destinationPath);
    });
    const onError = vi.fn();
    const supervisor = createTestSupervisor({ fs, onError, runner: createMockRunner([{ exitCode: 0, exitAfterMs: 1 }]) });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(1);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "exit state offline" }));
    expect(supervisor.getState()).toMatchObject({ pid: null, status: "stopped" });
  });

  it("does not launch when its signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = {
      name: "unused",
      exec: vi.fn(() => createControllableHandle())
    };
    const supervisor = createTestSupervisor({
      runner,
      signal: controller.signal
    });

    await expect(supervisor.start()).resolves.toBeUndefined();

    expect(runner.exec).not.toHaveBeenCalled();
    expect(supervisor.getState().status).toBe("stopped");
  });

  it("rejects an infinite restart backoff before launching", async () => {
    const runner = {
      name: "unused",
      exec: vi.fn(() => createControllableHandle())
    };

    expect(() => createTestSupervisor({
      runner,
      spec: { backoffMs: Number.POSITIVE_INFINITY, restart: "on-failure" }
    })).toThrow(/backoff/i);
    expect(runner.exec).not.toHaveBeenCalled();
  });

  it("rejects a non-finite maximum restart count before launching", async () => {
    const runner = {
      name: "unused",
      exec: vi.fn(() => createControllableHandle())
    };

    expect(() => createTestSupervisor({
      runner,
      spec: { maxRestarts: Number.NaN, restart: "on-failure" }
    })).toThrow(/maximum managed process restarts/i);
    expect(runner.exec).not.toHaveBeenCalled();
  });

  it("rejects path traversal process ids before creating escaped logs or launching", async () => {
    const { fs } = createMemFs();
    const runner = {
      name: "unused",
      exec: vi.fn(() => createControllableHandle())
    };

    expect(() =>
      createSupervisor({
        fs,
        runner,
        spec: createSpec({ id: "../outside" }),
        stateDir: "/state"
      })
    ).toThrow(/process id/i);

    expect(runner.exec).not.toHaveBeenCalled();
    await expect(fs.readFile("/outside/logs/stdout.log", "utf8")).rejects.toThrow();
    await expect(fs.readFile("/outside/state.json", "utf8")).rejects.toThrow();
  });

  it("pipes stdout and stderr to the log writer and onLog callback", async () => {
    vi.useFakeTimers();
    const { fs } = createMemFs();
    const logs: Array<{ line: string; stream: "stdout" | "stderr" }> = [];
    const supervisor = createTestSupervisor({
      fs,
      runner: createMockRunner([
        {
          exitCode: 0,
          exitAfterMs: 25,
          stderr: ["warn\n"],
          stdout: ["hello\n"],
          stdoutInterval: 5
        }
      ]),
      onLog: (line, stream) => {
        logs.push({ line, stream });
      }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(logs).toEqual([
      { line: "hello", stream: "stdout" },
      { line: "warn", stream: "stderr" }
    ]);
    expect(await fs.readFile("/state/process/logs/stdout.log", "utf8")).toBe("hello\n");
    expect(await fs.readFile("/state/process/logs/stderr.log", "utf8")).toBe("warn\n");
  });

  it("reports failed log writes while still recording process exit", async () => {
    vi.useFakeTimers();
    const { fs } = createMemFs();
    fs.appendFile = vi.fn(async () => {
      throw new Error("log disk offline");
    });
    const onError = vi.fn();
    const supervisor = createTestSupervisor({
      fs,
      onError,
      runner: createMockRunner([{ exitCode: 0, exitAfterMs: 5, stdout: ["hello\n"] }])
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(5);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "log disk offline" })));
    expect(supervisor.getState()).toMatchObject({ pid: null, status: "stopped" });
  });

  it("reports failed log rotation and records a crashed restart", async () => {
    vi.useFakeTimers();
    const { fs } = createMemFs();
    fs.stat = vi.fn(async () => {
      throw new Error("log rotation offline");
    });
    const onError = vi.fn();
    const supervisor = createTestSupervisor({
      fs,
      onError,
      runner: createMockRunner([{ exitCode: 1, exitAfterMs: 1 }]),
      spec: { restart: "on-failure" }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(1);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "log rotation offline" }));
    expect(supervisor.getState()).toMatchObject({ pid: null, status: "crashed" });
  });

  it("reports replacement launch failures and records a crash", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const runner = {
      name: "controllable",
      exec: vi.fn().mockReturnValueOnce(createMockRunner([{ exitCode: 1, exitAfterMs: 1 }]).exec({ command: "npm" })).mockImplementationOnce(() => {
        throw new Error("replacement launch failed");
      })
    };
    const supervisor = createTestSupervisor({ onError, runner, spec: { backoffMs: 0, restart: "on-failure" } });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "replacement launch failed" })));
    expect(supervisor.getState()).toMatchObject({ pid: null, status: "crashed" });
  });

  it("keeps restart count when stable-reset persistence fails", async () => {
    vi.useFakeTimers();
    const { fs } = createMemFs();
    const originalRename = fs.rename.bind(fs);
    fs.rename = vi.fn(async (sourcePath: string, destinationPath: string) => {
      const content = await fs.readFile(sourcePath, "utf8");
      if (content.includes('"restartCount": 0') && content.includes('"pid": 2')) {
        throw new Error("stable reset offline");
      }
      await originalRename(sourcePath, destinationPath);
    });
    const onError = vi.fn();
    const supervisor = createTestSupervisor({
      fs,
      onError,
      runner: createMockRunner([{ pid: 1, exitCode: 1, exitAfterMs: 1 }, { pid: 2, exitCode: 0, exitAfterMs: 70_000 }]),
      spec: { backoffMs: 0, restart: "on-failure" }
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(supervisor.getState()).toMatchObject({ pid: 2, restartCount: 1 }));
    await vi.advanceTimersByTimeAsync(60_000);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "stable reset offline" })));
    expect(supervisor.getState().restartCount).toBe(1);
  });

  it("resolves workspace locators once and reuses the resolved cwd across restarts", async () => {
    vi.useFakeTimers();
    const first = createControllableHandle(11);
    const second = createControllableHandle(22);
    const execSpecs: Array<{ cwd?: string }> = [];
    resolveWorkspaceMock.mockResolvedValue({
      cwd: "/tmp/workspaces/poe-code",
      locator: { scheme: "github", owner: "poe-platform", repo: "poe-code" }
    });
    const runner = {
      name: "host",
      exec: vi
        .fn()
        .mockImplementationOnce((spec) => {
          execSpecs.push({ cwd: spec.cwd });
          return first;
        })
        .mockImplementationOnce((spec) => {
          execSpecs.push({ cwd: spec.cwd });
          return second;
        })
    };
    const { fs } = createMemFs();
    const supervisor = createSupervisor({
      fs,
      runner,
      spec: createSpec({
        cwd: "github://poe-platform/poe-code",
        restart: "on-failure"
      }),
      startSettleMs: 0,
      stateDir: "/home/test/.poe-code/launch"
    });

    await supervisor.start();
    first.finish({ exitCode: 1 });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(resolveWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(execSpecs).toEqual([
      { cwd: "/tmp/workspaces/poe-code" },
      { cwd: "/tmp/workspaces/poe-code" }
    ]);

    second.finish({ exitCode: 0 });
    await supervisor.stop();
  });

  it("cleans up resolved workspaces when the supervisor stops", async () => {
    const cleanup = vi.fn(async () => {});
    resolveWorkspaceMock.mockResolvedValue({
      cleanup,
      cwd: "/tmp/workspaces/poe-code",
      locator: { scheme: "github", owner: "poe-platform", repo: "poe-code" }
    });
    const handle = createControllableHandle();
    const runner = {
      name: "host",
      exec: vi.fn(() => handle)
    };
    const { fs } = createMemFs();
    const supervisor = createSupervisor({
      fs,
      runner,
      spec: createSpec({ cwd: "github://poe-platform/poe-code" }),
      stateDir: "/home/test/.poe-code/launch"
    });

    await supervisor.start();
    const stopPromise = supervisor.stop();
    handle.finish({ exitCode: 0 });
    await stopPromise;

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not launch after workspace preparation is signal terminated", async () => {
    const child = createWorkspaceCommandChild();
    spawnMock.mockReturnValue(child);
    queueMicrotask(() => {
      child.emit("close", null, "SIGTERM");
    });
    resolveWorkspaceMock.mockImplementation(async (_locator: string, options: { exec: (command: string, args: string[]) => Promise<{ exitCode: number }> }) => {
      const result = await options.exec("git", ["clone"]);
      if (result.exitCode !== 0) {
        throw new Error("workspace preparation failed");
      }
      return { cwd: "/tmp/workspaces/poe-code" };
    });
    const runner = {
      name: "unused",
      exec: vi.fn(() => createControllableHandle())
    };
    const supervisor = createSupervisor({
      runner,
      spec: createSpec({ cwd: "github://poe-platform/poe-code" }),
      stateDir: "/home/test/.poe-code/launch"
    });

    await expect(supervisor.start()).rejects.toThrow("workspace preparation failed");
    expect(runner.exec).not.toHaveBeenCalled();
  });

  it("ignores inherited numeric workspace command error codes", async () => {
    const child = createWorkspaceCommandChild();
    spawnMock.mockReturnValue(child);
    queueMicrotask(() => {
      child.emit("error", new Error("spawn failed"));
    });
    resolveWorkspaceMock.mockImplementation(async (_locator: string, options: { exec: (command: string, args: string[]) => Promise<{ exitCode: number }> }) => {
      const result = await options.exec("git", ["clone"]);
      throw new Error(`workspace preparation failed with ${result.exitCode}`);
    });
    const runner = {
      name: "unused",
      exec: vi.fn(() => createControllableHandle())
    };
    const supervisor = createSupervisor({
      runner,
      spec: createSpec({ cwd: "github://poe-platform/poe-code" }),
      stateDir: "/home/test/.poe-code/launch"
    });

    await withObjectPrototypeProperties({ code: 0, errno: 0 }, async () => {
      await expect(supervisor.start()).rejects.toThrow("workspace preparation failed with 127");
    });
    expect(runner.exec).not.toHaveBeenCalled();
  });

  it("cancels in-flight workspace preparation when the supervisor signal aborts", async () => {
    const controller = new AbortController();
    const child = createWorkspaceCommandChild({
      closeOnKill: true
    });
    spawnMock.mockReturnValue(child);
    resolveWorkspaceMock.mockImplementation(async (_locator: string, options: { exec: (command: string, args: string[]) => Promise<{ exitCode: number; stderr: string }> }) => {
      const result = await options.exec("git", ["clone"]);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr);
      }
      return { cwd: "/tmp/workspaces/poe-code" };
    });
    const runner = {
      name: "unused",
      exec: vi.fn(() => createControllableHandle())
    };
    const errors: unknown[] = [];
    const supervisor = createSupervisor({
      runner,
      signal: controller.signal,
      spec: createSpec({ cwd: "github://poe-platform/poe-code" }),
      stateDir: "/home/test/.poe-code/launch",
      onError: error => {
        errors.push(error);
      }
    });

    const startPromise = supervisor.start();
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledWith("git", ["clone"], {
        cwd: undefined,
        stdio: ["ignore", "pipe", "pipe"]
      });
    });

    controller.abort(new Error("cancelled"));

    await expect(startPromise).rejects.toThrow("Workspace command aborted.");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(runner.exec).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
  });
});

function createTestSupervisor(overrides: TestSupervisorOptions = {}) {
  const { fs } = createMemFs();
  const { spec, ...optionOverrides } = overrides;

  return createSupervisor({
    spec: createSpec(spec),
    stateDir: "/state",
    fs,
    runner: createMockRunner([{ exitCode: 0, exitAfterMs: 10_000 }]),
    startSettleMs: 0,
    ...optionOverrides
  });
}

function createSpec(overrides: Partial<ProcessSpec> = {}): ProcessSpec {
  return {
    args: ["run", "dev"],
    command: "npm",
    id: "process",
    restart: "never",
    ...overrides
  };
}

function createMemFs(): {
  fs: LauncherFileSystem;
  stateWrites: string[];
} {
  const volume = new Volume();
  const fs = createFsFromVolume(volume).promises as unknown as LauncherFileSystem;
  const stateWrites: string[] = [];
  const originalWriteFile = fs.writeFile.bind(fs);

  fs.writeFile = vi.fn(async (filePath: string, content: string, options) => {
    if (filePath.includes("state.json.") && filePath.endsWith(".tmp")) {
      stateWrites.push(content);
    }

    await originalWriteFile(filePath, content, options);
  });

  return { fs, stateWrites };
}

function createWorkspaceCommandChild(options: { closeOnKill?: boolean } = {}): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  const kill = vi.fn((signal?: NodeJS.Signals | number) => {
    if (options.closeOnKill) {
      queueMicrotask(() => {
        child.emit("close", null, typeof signal === "string" ? signal : null);
      });
    }
    return true;
  });

  Object.assign(child, {
    pid: 123,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: null,
    kill
  });

  return child;
}

function createRecordingRunner(behaviors: Parameters<typeof createMockRunner>[0]) {
  const runner = createMockRunner(behaviors);
  const execTimes: number[] = [];

  return {
    execTimes,
    name: runner.name,
    exec(spec: Parameters<typeof runner.exec>[0]) {
      execTimes.push(Date.now());
      return runner.exec(spec);
    }
  };
}

function createControllableHandle(pid = 123) {
  let resolveResult: ((result: { exitCode: number }) => void) | null = null;

  return {
    pid,
    stdout: null,
    stderr: null,
    stdin: null,
    result: new Promise<{ exitCode: number }>(resolve => {
      resolveResult = resolve;
    }),
    kill: vi.fn(),
    finish(result: { exitCode: number }) {
      if (resolveResult === null) {
        throw new Error("Missing result resolver");
      }

      resolveResult(result);
    }
  };
}
