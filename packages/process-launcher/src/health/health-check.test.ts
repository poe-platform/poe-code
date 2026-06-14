import { afterEach, describe, expect, it, vi } from "vitest";
import * as net from "node:net";
import { EventEmitter } from "node:events";
import { waitForReady, type ReadinessLogSource } from "./health-check.js";
import { waitForReady as waitForReadyFromIndex } from "../index.js";
import type { ReadyCheck } from "../types.js";

type LogListener = (line: string, stream: "stdout" | "stderr") => void;
type SubscribableLog = LogListener & ReadinessLogSource & {
  listenerCount(): number;
};

function createOnLog(): SubscribableLog {
  const listeners = new Set<LogListener>();

  const onLog = ((line: string, stream: "stdout" | "stderr") => {
    for (const listener of listeners) {
      listener(line, stream);
    }
  }) as SubscribableLog;

  onLog.subscribe = (listener: LogListener) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  };

  onLog.listenerCount = () => listeners.size;

  return onLog;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type TcpOutcome = "connect" | "error" | "timeout" | "hold";

class FakeSocket extends EventEmitter {
  readonly setTimeout = vi.fn();
  readonly end = vi.fn();
  readonly destroy = vi.fn();
}

function mockTcpOutcomes(outcomes: TcpOutcome[]) {
  const calls: Array<{ options: net.NetConnectOpts; socket: FakeSocket }> = [];
  const pending = [...outcomes];
  const connect = (options: net.NetConnectOpts) => {
    const socket = new FakeSocket();
    calls.push({ options, socket });
    const outcome = pending.shift() ?? "error";

    if (outcome !== "hold") {
      queueMicrotask(() => socket.emit(outcome));
    }

    return socket as unknown as net.Socket;
  };

  return { calls, connect };
}

describe("waitForReady", () => {
  it("is exported from the package entrypoint", () => {
    expect(waitForReadyFromIndex).toBe(waitForReady);
  });

  it("log-pattern resolves true when matching line arrives", async () => {
    const onLog = createOnLog();
    const readyCheck: ReadyCheck = { kind: "log-pattern", pattern: "ready" };
    const result = waitForReady(readyCheck, { onLog, timeoutMs: 100 });

    onLog("server ready", "stdout");

    await expect(result).resolves.toBe(true);
    expect(onLog.listenerCount()).toBe(0);
  });

  it("log-pattern resolves false on timeout", async () => {
    const readyCheck: ReadyCheck = { kind: "log-pattern", pattern: "ready" };

    await expect(waitForReady(readyCheck, { onLog: createOnLog(), timeoutMs: 20 })).resolves.toBe(
      false
    );
  });

  it("rejects a callback that cannot subscribe to log lines", async () => {
    await expect(
      waitForReady(
        { kind: "log-pattern", pattern: "ready" },
        { onLog: vi.fn() as unknown as ReadinessLogSource, timeoutMs: 20 }
      )
    ).rejects.toThrow(/log source/i);
  });

  it("rejects an infinite log readiness timeout", async () => {
    await expect(
      waitForReady(
        { kind: "log-pattern", pattern: "ready" },
        { onLog: createOnLog(), timeoutMs: Number.POSITIVE_INFINITY }
      )
    ).rejects.toThrow(/timeout/i);
  });

  it("log-pattern resolves false when signal aborted", async () => {
    const controller = new AbortController();
    const readyCheck: ReadyCheck = { kind: "log-pattern", pattern: "ready" };
    const result = waitForReady(readyCheck, { onLog: createOnLog(), signal: controller.signal });

    controller.abort();

    await expect(result).resolves.toBe(false);
  });

  it("log-pattern matches substring instead of exact text", async () => {
    const onLog = createOnLog();
    const readyCheck: ReadyCheck = { kind: "log-pattern", pattern: "started" };
    const result = waitForReady(readyCheck, { onLog, timeoutMs: 100 });

    onLog("service started successfully", "stdout");

    await expect(result).resolves.toBe(true);
  });

  it("log-pattern works with stderr lines too", async () => {
    const onLog = createOnLog();
    const readyCheck: ReadyCheck = { kind: "log-pattern", pattern: "ready" };
    const result = waitForReady(readyCheck, { onLog, timeoutMs: 100 });

    onLog("stderr says ready", "stderr");

    await expect(result).resolves.toBe(true);
  });

  it("tcp resolves true when port is open", async () => {
    const { connect } = mockTcpOutcomes(["connect"]);

    await expect(waitForReady({ kind: "tcp", port: 42_424 }, { connect })).resolves.toBe(true);
  });

  it("tcp resolves false on timeout when the target is unreachable", async () => {
    vi.useFakeTimers();
    const { connect } = mockTcpOutcomes(["timeout"]);
    const result = waitForReady({ kind: "tcp", host: "192.0.2.1", port: 42_424, timeoutMs: 50 }, { connect });
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBe(false);
  });

  it("tcp honors the shared readiness timeout option", async () => {
    vi.useFakeTimers();
    const { connect } = mockTcpOutcomes(["timeout"]);
    const result = waitForReady({ kind: "tcp", host: "192.0.2.1", port: 42_424 }, { timeoutMs: 10, connect });
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toBe(false);
  });

  it("rejects an invalid tcp timeout before opening a socket", async () => {
    await expect(
      waitForReady({ kind: "tcp", port: 42, timeoutMs: Number.NaN }, {})
    ).rejects.toThrow(/timeout/i);
  });

  it("tcp resolves false when signal aborted", async () => {
    const { connect } = mockTcpOutcomes(["hold"]);
    const controller = new AbortController();
    const result = waitForReady({ kind: "tcp", port: 42_424, timeoutMs: 1_000 }, { signal: controller.signal, connect });

    controller.abort();

    await expect(result).resolves.toBe(false);
  });

  it("tcp uses custom host when provided", async () => {
    const { calls, connect } = mockTcpOutcomes(["connect"]);

    await expect(
      waitForReady({ kind: "tcp", port: 42_424, host: "127.0.0.2" }, { connect })
    ).resolves.toBe(true);

    expect(calls[0]?.options).toMatchObject({ host: "127.0.0.2", port: 42_424 });
  });

  it("tcp polls repeatedly until success", async () => {
    vi.useFakeTimers();
    const { calls, connect } = mockTcpOutcomes(["error", "error", "connect"]);
    const result = waitForReady({ kind: "tcp", port: 42_424, timeoutMs: 2_000 }, { connect });

    await vi.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toBe(true);
    expect(calls).toHaveLength(3);
  });
});
