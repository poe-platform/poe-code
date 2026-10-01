import { expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ options: undefined as unknown, stop: new Error("transport captured") }));
vi.mock("@cloudflare/playwright", () => ({ acquire: async () => ({ sessionId: "owned" }), connect: vi.fn() }));
vi.mock("../src/browser-private-transport.js", () => ({
  createBrowserPrivateTransport: (options: unknown) => { state.options = options; throw state.stop; },
}));
import { acquireCloudflareBrowser } from "../src/shell-browser-resource.js";

test("owned browser transport budgets are disabled by default and configurable", async () => {
  for (const transportLimits of [undefined, { maxMessageBytes: 100, maxPendingBytes: 200, maxBufferedBytes: 300 }]) {
    await expect(acquireCloudflareBrowser({
      binding: {} as Parameters<typeof acquireCloudflareBrowser>[0]["binding"],
      signal: new AbortController().signal,
      transportLimits,
    })).rejects.toBe(state.stop);
    expect(state.options).toEqual(transportLimits ?? {});
  }
});
