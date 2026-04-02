import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessSpec } from "../types.js";
import { createSimulation as createSimulationFromIndex } from "./index.js";
import { createSimulation } from "./simulation.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createSimulation", () => {
  it("is exported from the testing entrypoint", () => {
    expect(createSimulationFromIndex).toBe(createSimulation);
  });

  it("happy path — start, process runs, exits 0, status stopped", async () => {
    vi.useFakeTimers();
    const simulation = createSimulation(createSpec({ restart: "never" }), [
      { pid: 101, exitCode: 0, exitAfterMs: 5 }
    ]);

    await simulation.supervisor.start();
    await vi.advanceTimersByTimeAsync(5);

    expect(simulation.statusChanges.map(state => state.status)).toEqual(["running", "stopped"]);
    expect(simulation.supervisor.getState()).toMatchObject({
      lastExitCode: 0,
      pid: null,
      status: "stopped"
    });
  });

  it("restart on failure — process exits 1, restarts, second run exits 0", async () => {
    vi.useFakeTimers();
    const simulation = createSimulation(createSpec({ restart: "on-failure" }), [
      { pid: 201, exitCode: 1, exitAfterMs: 5 },
      { pid: 202, exitCode: 0, exitAfterMs: 10_000 }
    ]);

    await simulation.supervisor.start();
    await vi.advanceTimersByTimeAsync(5);

    expect(simulation.supervisor.getState()).toMatchObject({
      lastExitCode: 1,
      restartCount: 1,
      status: "restarting"
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(simulation.execCalls).toHaveLength(2);
    expect(simulation.supervisor.getState()).toMatchObject({
      pid: 202,
      restartCount: 1,
      status: "running"
    });
  });

  it("max restarts — process crashes repeatedly, transitions to crashed", async () => {
    vi.useFakeTimers();
    const simulation = createSimulation(
      createSpec({ maxRestarts: 2, restart: "on-failure" }),
      [
        { pid: 301, exitCode: 1, exitAfterMs: 1 },
        { pid: 302, exitCode: 1, exitAfterMs: 1 },
        { pid: 303, exitCode: 1, exitAfterMs: 1 }
      ]
    );

    await simulation.supervisor.start();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(1);

    expect(simulation.execCalls).toHaveLength(3);
    expect(simulation.supervisor.getState()).toMatchObject({
      lastExitCode: 1,
      pid: null,
      restartCount: 2,
      status: "crashed"
    });
  });

  it("always restart — process exits 0, still restarts", async () => {
    vi.useFakeTimers();
    const simulation = createSimulation(createSpec({ restart: "always" }), [
      { pid: 401, exitCode: 0, exitAfterMs: 5 },
      { pid: 402, exitCode: 0, exitAfterMs: 10_000 }
    ]);

    await simulation.supervisor.start();
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(simulation.execCalls).toHaveLength(2);
    expect(simulation.supervisor.getState()).toMatchObject({
      pid: 402,
      restartCount: 1,
      status: "running"
    });
  });

  it("ready check log pattern — status running only after pattern in logs", async () => {
    vi.useFakeTimers();
    const simulation = createSimulation(
      createSpec({
        readyCheck: { kind: "log-pattern", pattern: "ready" },
        restart: "never"
      }),
      [
        {
          pid: 501,
          exitCode: 0,
          exitAfterMs: 10_000,
          stdout: ["booting\n", "service ready\n"],
          stdoutInterval: 10
        }
      ]
    );

    const startPromise = simulation.supervisor.start();

    await vi.advanceTimersByTimeAsync(10);
    expect(simulation.supervisor.getState().status).toBe("restarting");

    await vi.advanceTimersByTimeAsync(10);
    await startPromise;

    expect(simulation.statusChanges.map(state => state.status)).toEqual(["restarting", "running"]);
    expect(simulation.supervisor.getState().status).toBe("running");
  });

  it("log capture — stdout and stderr captured in log files", async () => {
    vi.useFakeTimers();
    const simulation = createSimulation(createSpec({ restart: "never" }), [
      {
        pid: 601,
        exitCode: 0,
        exitAfterMs: 25,
        stderr: ["warn\n"],
        stdout: ["hello\n"],
        stdoutInterval: 5
      }
    ]);

    await simulation.supervisor.start();
    await vi.advanceTimersByTimeAsync(25);

    expect(simulation.logLines).toEqual([
      { line: "hello", stream: "stdout" },
      { line: "warn", stream: "stderr" }
    ]);
    await expect(simulation.fs.readFile(simulation.stdoutLogPath, "utf8")).resolves.toBe("hello\n");
    await expect(simulation.fs.readFile(simulation.stderrLogPath, "utf8")).resolves.toBe("warn\n");
  });

  it("captures trailing log data without a newline", async () => {
    vi.useFakeTimers();
    const simulation = createSimulation(createSpec({ restart: "never" }), [
      {
        pid: 650,
        exitCode: 0,
        exitAfterMs: 25,
        stderr: ["warn without newline"],
        stdout: ["hello without newline"],
        stdoutInterval: 5
      }
    ]);

    await simulation.supervisor.start();
    await vi.advanceTimersByTimeAsync(25);

    expect(simulation.logLines).toEqual([
      { line: "hello without newline", stream: "stdout" },
      { line: "warn without newline", stream: "stderr" }
    ]);
    await expect(simulation.fs.readFile(simulation.stdoutLogPath, "utf8")).resolves.toBe(
      "hello without newline\n"
    );
    await expect(simulation.fs.readFile(simulation.stderrLogPath, "utf8")).resolves.toBe(
      "warn without newline\n"
    );
  });

  it("log rotation on restart — previous logs shifted", async () => {
    vi.useFakeTimers();
    const simulation = createSimulation(
      createSpec({ maxRestarts: 3, restart: "on-failure" }),
      [
        { pid: 701, exitCode: 1, exitAfterMs: 20, stdout: ["first run\n"], stdoutInterval: 5 },
        { pid: 702, exitCode: 1, exitAfterMs: 20, stdout: ["second run\n"], stdoutInterval: 5 },
        { pid: 703, exitCode: 0, exitAfterMs: 10_000, stdout: ["third run\n"], stdoutInterval: 5 }
      ]
    );

    await simulation.supervisor.start();
    await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(5);

    await expect(simulation.fs.readFile(`${simulation.logDir}/stdout.2.log`, "utf8")).resolves.toBe(
      "first run\n"
    );
    await expect(simulation.fs.readFile(`${simulation.logDir}/stdout.1.log`, "utf8")).resolves.toBe(
      "second run\n"
    );
    await expect(simulation.fs.readFile(simulation.stdoutLogPath, "utf8")).resolves.toBe("third run\n");
  });

  it("state persisted — read back state.json from memfs", async () => {
    vi.useFakeTimers();
    const simulation = createSimulation(createSpec({ restart: "never" }), [
      { pid: 801, exitCode: 0, exitAfterMs: 5 }
    ]);

    await simulation.supervisor.start();
    await vi.advanceTimersByTimeAsync(5);

    const persistedState = JSON.parse(await simulation.fs.readFile(simulation.statePath, "utf8"));

    expect(persistedState).toMatchObject({
      id: "process",
      lastExitCode: 0,
      pid: null,
      status: "stopped"
    });
  });

  it("stop during run — kill called, state stopped", async () => {
    const simulation = createSimulation(createSpec({ restart: "never" }), [
      { pid: 901, exitCode: 0, exitAfterMs: 10_000 }
    ]);

    await simulation.supervisor.start();
    await simulation.supervisor.stop();

    expect(simulation.runs).toHaveLength(1);
    expect(simulation.runs[0]?.killSignals).toEqual(["SIGTERM"]);
    expect(simulation.supervisor.getState()).toMatchObject({
      pid: null,
      status: "stopped"
    });
  });

  it("abort signal — supervisor stops cleanly", async () => {
    const controller = new AbortController();
    const simulation = createSimulation(
      createSpec({ restart: "never" }),
      [{ pid: 1_001, exitCode: 0, exitAfterMs: 10_000 }],
      { signal: controller.signal }
    );

    await simulation.supervisor.start();
    controller.abort();
    await flushMicrotasks();

    expect(simulation.runs[0]?.killSignals).toEqual(["SIGTERM"]);
    expect(simulation.supervisor.getState()).toMatchObject({
      pid: null,
      status: "stopped"
    });
  });
});

function createSpec(overrides: Partial<ProcessSpec> = {}): ProcessSpec {
  return {
    args: ["run", "dev"],
    command: "npm",
    id: "process",
    restart: "never",
    ...overrides
  };
}

async function flushMicrotasks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
