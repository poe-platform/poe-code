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
  it("retains its validated redirect when the listener factory mutates caller options", async () => {
    const listener = new Listener(), redirectUri = "http://127.0.0.1:39119/callback?application=one";
    const options = { redirectUri, createServer: () => {
      options.redirectUri = "https://unrelated.example/callback";
      return listener.asServer();
    } };
    const session = await createLoopbackAuthorizationSession(options);
    try { expect(session.redirectUri).toBe(redirectUri); expect(listener.listen).toHaveBeenCalledWith(39119, "127.0.0.1", expect.any(Function)); }
    finally { session.close(); }
  });

  it.each(["unrelated abort", "original abort"] as const)("retains its original signal through listener factory option mutation: %s", async mutation => {
    const listener = new Listener(), controller = new AbortController(), reason = new Error("original loopback canceled");
    const options = { signal: controller.signal, createServer: () => {
      options.signal = mutation === "unrelated abort" ? AbortSignal.abort(new Error("replacement cancellation")) : new AbortController().signal;
      if (mutation === "original abort") controller.abort(reason);
      return listener.asServer();
    } };
    if (mutation === "original abort") {
      await expect(createLoopbackAuthorizationSession(options)).rejects.toBe(reason);
      expect(listener.close).toHaveBeenCalledOnce();
    } else {
      const session = await createLoopbackAuthorizationSession(options);
      session.close(); expect(listener.close).toHaveBeenCalledOnce();
    }
  });

  it.each(["browser", "input"] as const)("retains its selected %s callback before the listener factory runs", async mutation => {
    const listener = new Listener(), originalBrowser = vi.fn(async () => {}), replacementBrowser = vi.fn(async () => {});
    const originalInput = vi.fn(async () => "http://127.0.0.1/callback?state=expected-state&code=005930");
    const replacementInput = vi.fn(async () => "http://127.0.0.1/callback?state=expected-state&code=005931");
    const options = { openBrowser: originalBrowser, readLine: originalInput, createServer: () => {
      if (mutation === "browser") options.openBrowser = replacementBrowser;
      else options.readLine = replacementInput;
      return listener.asServer();
    } };
    const session = await createLoopbackAuthorizationSession(options);
    try {
      expect(await session.waitForCode("https://auth.example/authorize?state=expected-state")).toBe("005930");
      expect(originalBrowser).toHaveBeenCalledOnce(); expect(originalInput).toHaveBeenCalledOnce();
      expect(replacementBrowser).not.toHaveBeenCalled(); expect(replacementInput).not.toHaveBeenCalled();
    } finally { session.close(); }
  });

  it("owns its landing page before the listener factory mutates the original data", async () => {
    const listener = new Listener(), landingPage = { title: "Original title", body: "Original body" };
    const session = await createLoopbackAuthorizationSession({ landingPage, createServer: () => {
      Object.assign(landingPage, { title: "host-mutated title", body: "host-mutated body" }); return listener.asServer();
    } });
    try {
      const pending = session.waitForCode("https://auth.example/authorize?state=expected-state"), end = vi.fn();
      listener.emit("request", { url: "/callback?state=expected-state&code=005930" }, { writeHead: vi.fn(), end });
      expect(await pending).toBe("005930");
      expect(end.mock.calls[0][0]).toContain("Original title"); expect(end.mock.calls[0][0]).toContain("Original body");
      expect(end.mock.calls[0][0]).not.toContain("host-mutated");
    } finally { session.close(); }
  });

  it("preserves selected callback receivers and live host method state", async () => {
    const listener = new Listener();
    const options = { marker: "initial", createServer() { expect(this).toBe(options); return listener.asServer(); },
      async readLine() { expect(this).toBe(options); expect(this.marker).toBe("updated"); return "http://127.0.0.1/callback?state=expected-state&code=005930"; } };
    const session = await createLoopbackAuthorizationSession(options); options.marker = "updated";
    try { expect(await session.waitForCode("https://auth.example/authorize?state=expected-state")).toBe("005930"); }
    finally { session.close(); }
  });

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
    "http://user:password@localhost:39119/callback", "http://localhost:0/callback", "http://localhost:39119/callback#fragment", "http://localhost:39119/callback#",
    "http://localhost:39119/callback?state=spoofed", "http://localhost:39119/callback?error_uri=private-fixed-value"])("rejects unsafe fixed redirect %s before creating a listener", async redirectUri => {
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
