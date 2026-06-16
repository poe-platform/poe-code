import net from "node:net";
import type { ReadyCheck } from "../types.js";

type LogListener = (line: string, stream: "stdout" | "stderr") => void;
export interface ReadinessLogSource {
  subscribe(listener: LogListener): () => void;
}

type TcpConnect = typeof net.connect;

export async function waitForReady(
  check: ReadyCheck,
  options: {
    signal?: AbortSignal;
    onLog?: ReadinessLogSource;
    timeoutMs?: number;
    connect?: TcpConnect;
  }
): Promise<boolean> {
  assertValidTimeout(options.timeoutMs, "readiness timeout");

  if (check.kind === "log-pattern") {
    assertValidLogPattern(check.pattern);
    return waitForLogPattern(check.pattern, options);
  }

  assertValidTcpPort(check.port);
  return waitForTcp(check, options);
}

function waitForLogPattern(
  pattern: string,
  options: {
    signal?: AbortSignal;
    onLog?: ReadinessLogSource;
    timeoutMs?: number;
  }
): Promise<boolean> {
  if (options.signal?.aborted) {
    return Promise.resolve(false);
  }

  if (options.onLog === undefined || typeof options.onLog.subscribe !== "function") {
    return Promise.reject(new Error("A subscribable log source is required for log-pattern readiness checks."));
  }
  const logSource = options.onLog;

  return new Promise<boolean>(resolve => {
    let finished = false;
    const timeout = setTimeout(() => {
      finish(false);
    }, options.timeoutMs ?? 30_000);

    const unsubscribe = logSource.subscribe((line: string) => {
      if (line.includes(pattern)) {
        finish(true);
      }
    });

    const onAbort = () => {
      finish(false);
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    function finish(result: boolean): void {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      unsubscribe();
      resolve(result);
    }
  });
}

function waitForTcp(
  check: Extract<ReadyCheck, { kind: "tcp" }>,
  options: { signal?: AbortSignal; timeoutMs?: number; connect?: TcpConnect }
): Promise<boolean> {
  const { signal } = options;
  if (signal?.aborted) {
    return Promise.resolve(false);
  }

  const timeoutMs = options.timeoutMs ?? check.timeoutMs ?? 30_000;
  assertValidTimeout(timeoutMs, "TCP readiness timeout");
  const deadline = Date.now() + timeoutMs;

  return new Promise<boolean>(resolve => {
    let finished = false;
    let activeSocket: net.Socket | undefined;
    let retryTimer: NodeJS.Timeout | undefined;

    const onAbort = () => {
      finish(false);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    attemptConnection();

    function attemptConnection(): void {
      if (finished) {
        return;
      }

      if (signal?.aborted || Date.now() >= deadline) {
        finish(false);
        return;
      }

      const connect = options.connect ?? net.connect;
      const socket = connect({
        host: check.host ?? "127.0.0.1",
        port: check.port
      });
      activeSocket = socket;

      const socketTimeoutMs = Math.max(1, Math.min(500, deadline - Date.now()));
      socket.setTimeout(socketTimeoutMs);
      socket.once("connect", () => {
        clearActiveSocket(socket);
        socket.end();
        socket.destroy();
        finish(true);
      });
      socket.once("error", () => {
        failAttempt(socket);
      });
      socket.once("timeout", () => {
        failAttempt(socket);
      });
    }

    function failAttempt(socket: net.Socket): void {
      clearActiveSocket(socket);
      socket.destroy();

      if (finished) {
        return;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        finish(false);
        return;
      }

      retryTimer = setTimeout(attemptConnection, Math.min(100, remainingMs));
    }

    function clearActiveSocket(socket: net.Socket): void {
      if (activeSocket === socket) {
        activeSocket = undefined;
      }
    }

    function finish(result: boolean): void {
      if (finished) {
        return;
      }

      finished = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }

      activeSocket?.destroy();
      activeSocket = undefined;
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    }
  });
}

function assertValidTimeout(value: number | undefined, description: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`Invalid ${description}: ${value}`);
  }
}

function assertValidLogPattern(value: string): void {
  if (value.trim().length === 0) {
    throw new Error("Invalid log pattern readiness check: pattern must not be blank.");
  }
}

function assertValidTcpPort(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`Invalid TCP readiness port: ${value}`);
  }
}
