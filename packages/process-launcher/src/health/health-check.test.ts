import { afterEach, describe, expect, it, vi } from "vitest";
import * as net from "node:net";
import { waitForReady } from "./health-check.js";
import { waitForReady as waitForReadyFromIndex } from "../index.js";
import type { ReadyCheck } from "../types.js";

type LogListener = (line: string, stream: "stdout" | "stderr") => void;
type SubscribableLog = LogListener & {
  subscribe(listener: LogListener): () => void;
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

async function listen(server: net.Server, port: number, host = "127.0.0.1"): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function getAvailablePort(host = "127.0.0.1"): Promise<number> {
  const server = net.createServer();
  await listen(server, 0, host);
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }

  const { port } = address;
  await closeServer(server);
  return port;
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
    const server = net.createServer();
    await listen(server, 0);
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected server to listen on a TCP port");
    }

    await expect(waitForReady({ kind: "tcp", port: address.port }, {})).resolves.toBe(true);
    await closeServer(server);
  });

  it("tcp resolves false on timeout when port is not open", async () => {
    const port = await getAvailablePort();

    await expect(waitForReady({ kind: "tcp", port, timeoutMs: 50 }, {})).resolves.toBe(false);
  });

  it("tcp resolves false when signal aborted", async () => {
    const port = await getAvailablePort();
    const controller = new AbortController();
    const result = waitForReady({ kind: "tcp", port, timeoutMs: 1_000 }, { signal: controller.signal });

    controller.abort();

    await expect(result).resolves.toBe(false);
  });

  it("tcp uses custom host when provided", async () => {
    const server = net.createServer();
    await listen(server, 0, "127.0.0.1");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected server to listen on a TCP port");
    }

    await expect(
      waitForReady({ kind: "tcp", port: address.port, host: address.address }, {})
    ).resolves.toBe(true);

    await closeServer(server);
  });

  it("tcp polls repeatedly until success", async () => {
    const port = await getAvailablePort();
    const server = net.createServer();
    const result = waitForReady({ kind: "tcp", port, timeoutMs: 2_000 }, {});

    setTimeout(() => {
      void listen(server, port);
    }, 250);

    await expect(result).resolves.toBe(true);

    await closeServer(server);
  });
});
