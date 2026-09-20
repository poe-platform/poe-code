import { afterEach, expect, test, vi } from "vitest";
import type { BrowserWorker } from "@cloudflare/playwright";
import { controlFaultBinding } from "./browser-storage-admission.test.worker-relay";

vi.mock("./browser-storage-admission.test.worker-controls", () => ({
  assertCommandFailure: vi.fn(),
  failureText: vi.fn(),
}));

vi.mock("./browser-storage-admission.test.worker-records", () => ({ seed: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

class Socket {
  readyState: number = WebSocket.OPEN;
  listeners = new Map<string, Set<(event: unknown) => void>>();
  accept = vi.fn();
  close = vi.fn(() => { this.readyState = WebSocket.CLOSING; });
  send = vi.fn((_data: string) => {
    if (this.readyState !== WebSocket.OPEN)
      throw new TypeError("Can't call WebSocket send() after close().");
  });
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

for (const direction of ["request", "reply"] as const) {
  test.each([WebSocket.CLOSING, WebSocket.CLOSED])(
    `relay stops queued ${direction} frames when the recipient is in state %i`,
    async state => {
      const upstream = new Socket();
      const frontend = new Socket();
      vi.stubGlobal("WebSocketPair", class {
        0 = new Socket();
        1 = frontend;
      });
      vi.stubGlobal("Response", class {
        constructor(_body: unknown, init: Record<string, unknown>) {
          Object.assign(this, init);
        }
      });
      const native = { fetch: vi.fn(async () => ({ webSocket: upstream, ok: true })) };
      const relay = controlFaultBinding(native as unknown as BrowserWorker);
      await relay.binding.fetch("http://fake.host/v1/devtools/browser/owned");
      const sender = direction === "request" ? frontend : upstream;
      const recipient = direction === "request" ? upstream : frontend;
      const data = JSON.stringify(direction === "request"
        ? { id: 1, method: "Browser.getVersion" }
        : { id: 1, result: {} });
      sender.emit("message", { data });
      expect(recipient.send).toHaveBeenCalledWith(data);
      recipient.readyState = state;
      expect(() => sender.emit("message", { data })).not.toThrow();
      expect(recipient.send).toHaveBeenCalledTimes(1);
    }
  );
}
