import { describe, expect, it, vi } from "vitest";

const { createServerMock, fakeServer } = vi.hoisted(() => {
  class FakeNodeServer {
    listening = true;
    private readonly listeners = new Map<string, Set<() => void>>();
    close = vi.fn((callback: (error?: Error) => void) => {
      if (this.close.mock.calls.length === 1) {
        callback(new Error("close temporarily failed"));
        return;
      }
      this.listening = false;
      callback();
    });
    closeIdleConnections = vi.fn();
    closeAllConnections = vi.fn();
    listen(): void {
      queueMicrotask(() => this.emit("listening"));
    }
    once(event: string, callback: () => void): void {
      this.listeners.set(event, new Set([callback]));
    }
    off(event: string, callback: () => void): void {
      this.listeners.get(event)?.delete(callback);
    }
    emit(event: string): void {
      for (const callback of this.listeners.get(event) ?? []) callback();
      this.listeners.delete(event);
    }
    address(): { port: number; address: string; family: string } {
      return { port: 43210, address: "127.0.0.1", family: "IPv4" };
    }
  }
  const fakeServer = new FakeNodeServer();
  return { fakeServer, createServerMock: vi.fn(() => fakeServer) };
});

vi.mock("node:http", async () => {
  const actual = await vi.importActual<typeof import("node:http")>("node:http");
  return {
    ...actual,
    default: { ...actual.default, createServer: createServerMock },
    createServer: createServerMock
  };
});

import { createHttpServer } from "./http-server.js";

describe("HttpServerHandle close", () => {
  it("retries a transient listener shutdown failure", async () => {
    const handle = await createHttpServer({ name: "test", version: "1" }).listenHttp();

    await expect(handle.close()).rejects.toThrow("close temporarily failed");
    await expect(handle.close()).resolves.toBeUndefined();
    expect(fakeServer.close).toHaveBeenCalledTimes(2);
  });

  it("force-closes all remaining Node HTTP connections", async () => {
    const handle = await createHttpServer({ name: "test", version: "1" }).listenHttp();

    handle.closeAllConnections();

    expect(fakeServer.closeAllConnections).toHaveBeenCalledOnce();
  });
});
