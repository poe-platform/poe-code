import http from "node:http";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createLoopbackAuthorizationSession } from "./loopback-authorization.js";

class Listener extends EventEmitter {
  readonly listen = vi.fn((port: number, host: string, ready: () => void) => {
    this.port = port || 49152;
    this.host = host;
    queueMicrotask(ready);
    return this;
  });
  readonly close = vi.fn(() => this);
  readonly closeAllConnections = vi.fn();
  port = 49152;
  host = "127.0.0.1";
  address() { return { port: this.port, address: this.host, family: "IPv4" }; }
  asServer() { return this as unknown as http.Server; }
}

describe("loopback authorization ownership", () => {
  it.each(["http://localhost:39119/oauth/callback?app=one", "http://127.0.0.1:39119/callback", "http://[::1]:39119/callback"])
    ("preserves and listens on the exact configured redirect %s", async redirectUri => {
      const listener = new Listener();
      const session = await createLoopbackAuthorizationSession({ redirectUri, createServer: () => listener.asServer() });
      try {
        expect(session.redirectUri).toBe(redirectUri);
        expect(listener.listen.mock.calls[0]?.[0]).toBe(39119);
        expect(listener.listen.mock.calls[0]?.[1]).toBe(new URL(redirectUri).hostname.split("[").join("").split("]").join(""));
      } finally { session.close(); }
    });

  it.each(["https://localhost:39119/callback", "http://example.test:39119/callback", "http://127.0.0.2:39119/callback",
    "http://user:password@localhost:39119/callback", "http://localhost:0/callback", "http://localhost:39119/callback#fragment",
    "http://localhost:39119/callback?state=spoofed"])("rejects unsafe fixed redirect %s before creating a listener", async redirectUri => {
      const createServer = vi.fn(() => new Listener().asServer());
      await expect(createLoopbackAuthorizationSession({ redirectUri, createServer })).rejects.toThrow("redirect");
      expect(createServer).not.toHaveBeenCalled();
    });

  it("does not allocate a listener for already-cancelled authorization", async () => {
    const controller = new AbortController();
    const reason = { cancelled: true };
    controller.abort(reason);
    const createServer = vi.fn(() => new Listener().asServer());
    await expect(createLoopbackAuthorizationSession({ signal: controller.signal, createServer })).rejects.toBe(reason);
    expect(createServer).not.toHaveBeenCalled();
  });

  it("cancels a pending code wait, closes the listener and removes request handlers", async () => {
    const listener = new Listener();
    const controller = new AbortController();
    const session = await createLoopbackAuthorizationSession({ signal: controller.signal, createServer: () => listener.asServer() });
    const pending = session.waitForCode("https://auth.example/authorize");
    const reason = { cancelled: true };
    const assertion = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await assertion;
    expect(listener.close).toHaveBeenCalledOnce();
    expect(listener.listenerCount("request")).toBe(0);
    session.close();
    expect(listener.close).toHaveBeenCalledOnce();
  });

  it("closing a session settles its pending wait instead of leaving it hanging", async () => {
    const listener = new Listener();
    const session = await createLoopbackAuthorizationSession({ createServer: () => listener.asServer() });
    const assertion = expect(session.waitForCode("https://auth.example/authorize")).rejects.toThrow("closed");
    session.close();
    await assertion;
  });

  it("bounds code waiting with an authorization timeout", async () => {
    vi.useFakeTimers();
    try {
      const listener = new Listener();
      listener.listen.mockImplementation((port, host, ready) => { listener.port = port || 49152; listener.host = host; ready(); return listener; });
      const session = await createLoopbackAuthorizationSession({ timeoutMs: 100, createServer: () => listener.asServer() });
      const assertion = expect(session.waitForCode("https://auth.example/authorize")).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
      expect(listener.close).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
