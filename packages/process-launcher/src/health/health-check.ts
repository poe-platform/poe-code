import net from "node:net";
import type { ReadyCheck } from "../types.js";

type LogListener = (line: string, stream: "stdout" | "stderr") => void;
type SubscribableLog = LogListener & {
  subscribe?(listener: LogListener): () => void;
};

export async function waitForReady(
  check: ReadyCheck,
  options: {
    signal?: AbortSignal;
    onLog?: (line: string, stream: "stdout" | "stderr") => void;
    timeoutMs?: number;
  }
): Promise<boolean> {
  if (check.kind === "log-pattern") {
    return waitForLogPattern(check.pattern, options);
  }

  return waitForTcp(check, options.signal);
}

function waitForLogPattern(
  pattern: string,
  options: {
    signal?: AbortSignal;
    onLog?: (line: string, stream: "stdout" | "stderr") => void;
    timeoutMs?: number;
  }
): Promise<boolean> {
  if (options.signal?.aborted) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>(resolve => {
    let finished = false;
    const timeout = setTimeout(() => {
      finish(false);
    }, options.timeoutMs ?? 30_000);

    const logSource = options.onLog as SubscribableLog | undefined;
    const unsubscribe = logSource?.subscribe?.((line: string) => {
      if (line.includes(pattern)) {
        finish(true);
      }
    }) ?? (() => {});

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
  signal?: AbortSignal
): Promise<boolean> {
  if (signal?.aborted) {
    return Promise.resolve(false);
  }

  const timeoutMs = check.timeoutMs ?? 30_000;
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

      const socket = net.connect({
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
