import http from "node:http";
import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { createLoopbackAuthorizationSession, type LoopbackAuthorizationOptions } from "./loopback-authorization.js";

class Listener extends EventEmitter {
  port = 49152;
  listen(port: number, _host: string, ready: () => void) { this.port = port || 49152; ready(); return this; }
  address() { return { port: this.port, address: "127.0.0.1", family: "IPv4" }; }
  close = vi.fn(() => this);
}

it.each(["signal", "timeoutMs", "redirectUri", "callbackPath", "createServer", "openBrowser", "readLine", "landingPage"] as const)(
  "retains nonenumerable loopback %s options", async field => {
    vi.useFakeTimers();
    const listener = new Listener(), fallback = new Listener();
    const defaultFactory = vi.spyOn(http, "createServer").mockReturnValue(fallback as unknown as http.Server);
    const canceled = { reason: "original cancellation" }, browser = vi.fn(async () => {});
    const reader = vi.fn(async () => "http://127.0.0.1/callback?state=expected&code=005930");
    const factory = vi.fn(() => listener as unknown as http.Server);
    const options: LoopbackAuthorizationOptions = { createServer: factory, openBrowser: browser, readLine: reader,
      signal: field === "signal" ? AbortSignal.abort(canceled) : undefined,
      timeoutMs: field === "timeoutMs" ? 0 : 100,
      ...(field === "redirectUri" ? { redirectUri: "http://127.0.0.1:39119/original?app=one" } : {}),
      ...(field === "callbackPath" ? { callbackPath: "/original" } : {}), landingPage: { title: "Original title", body: "Original body" } };
    Object.defineProperty(options, field, { enumerable: false });
    let session: Awaited<ReturnType<typeof createLoopbackAuthorizationSession>> | undefined;
    try {
      if (field === "signal" || field === "timeoutMs") {
        const result = createLoopbackAuthorizationSession(options);
        // Close a wrongly allocated session so a failed assertion cannot leak it.
        void result.then(value => value.close(), () => {});
        if (field === "signal") await expect(result).rejects.toBe(canceled);
        else await expect(result).rejects.toThrow("timeoutMs");
        expect(factory).not.toHaveBeenCalled(); expect(defaultFactory).not.toHaveBeenCalled();
      } else {
        session = await createLoopbackAuthorizationSession(options);
        expect(factory).toHaveBeenCalledOnce(); expect(defaultFactory).not.toHaveBeenCalled();
        if (field === "redirectUri") expect(session.redirectUri).toBe(options.redirectUri);
        if (field === "callbackPath") expect(new URL(session.redirectUri).pathname).toBe("/original");
        if (field === "landingPage") {
          // Exercise the actual served HTML instead of manual input.
          const pending = session.waitForCode("https://auth.example/authorize?state=expected"), end = vi.fn();
          listener.emit("request", { url: "/callback?state=expected&code=005930" }, { writeHead: vi.fn(), end });
          expect(await pending).toBe("005930"); expect(end.mock.calls[0][0]).toContain("Original title");
          expect(end.mock.calls[0][0]).toContain("Original body");
        } else {
          const pending = session.waitForCode("https://auth.example/authorize?state=expected").then(value => ({ value }), error => ({ error }));
          await vi.advanceTimersByTimeAsync(100); expect(await pending).toEqual({ value: "005930" });
          expect(browser).toHaveBeenCalledOnce(); expect(reader).toHaveBeenCalledOnce();
        }
      }
    } finally { session?.close(); defaultFactory.mockRestore(); vi.useRealTimers(); }
  }
);

it.each(["title", "body"] as const)("retains hidden landing-page %s and owns it before browser callbacks", async field => {
  const listener = new Listener(), page = { title: "Original title <005930>", body: "Original body & complete" };
  Object.defineProperty(page, field, { enumerable: false });
  const session = await createLoopbackAuthorizationSession({ createServer: () => listener as unknown as http.Server,
    landingPage: page, openBrowser: async () => { page.title = "Replacement title"; page.body = "Replacement body"; } });
  try {
    const pending = session.waitForCode("https://auth.example/authorize?state=expected"), end = vi.fn();
    listener.emit("request", { url: "/callback?state=expected&code=005930" }, { writeHead: vi.fn(), end });
    expect(await pending).toBe("005930"); expect(end.mock.calls[0][0]).toContain("Original title &lt;005930&gt;");
    expect(end.mock.calls[0][0]).toContain("Original body &amp; complete"); expect(end.mock.calls[0][0]).not.toContain("Replacement");
  } finally { session.close(); }
});
