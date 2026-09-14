import { describe, expect, it, vi } from "vitest";
import { fakeFetch } from "./fakes.js";

const url = "https://example.test/items";

describe("fakeFetch cancellation", () => {
  describe.each(["init", "request", "override"])("effective signal from %s", (source) => {
    it.each(["default", "error", "object"])("rejects with the %s reason before matching routes", async (kind) => {
      const caller = new AbortController();
      caller.abort(kind === "default" ? undefined : kind === "error" ? new Error("stopped") : { message: "stopped" });
      const predicate = vi.fn(() => true);
      const fetch = fakeFetch([{ url: predicate, text: "ready" }]);
      const input = source === "init" ? url : new Request(url, {
        signal: source === "request" ? caller.signal : new AbortController().signal
      });
      const init = source === "request" ? undefined : { signal: caller.signal };

      await expect(fetch(input, init)).rejects.toBe(caller.signal.reason);

      expect(fetch.calls).toHaveLength(1);
      expect(fetch.calls[0]!.signal.aborted).toBe(true);
      expect(fetch.calls[0]!.signal.reason).toBe(caller.signal.reason);
      expect(predicate).not.toHaveBeenCalled();
    });
  });

  it.each([
    { name: "null", reason: null },
    { name: "false", reason: false },
    { name: "zero", reason: 0 },
    { name: "string", reason: "stopped" },
    { name: "symbol", reason: Symbol("stopped") },
    { name: "bigint", reason: 123n }
  ])("retains a $name abort reason", async ({ reason }) => {
    const caller = new AbortController();
    caller.abort(reason);
    const predicate = vi.fn(() => true);
    const fetch = fakeFetch([{ url: predicate, text: "ready" }]);

    await expect(fetch(url, { signal: caller.signal })).rejects.toBe(reason);

    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.signal.reason).toBe(reason);
    expect(predicate).not.toHaveBeenCalled();
  });

  it.each(["missing", "route error"])("prioritizes cancellation over a %s", async (kind) => {
    const caller = new AbortController();
    caller.abort(new Error("stopped"));
    const fetch = fakeFetch(kind === "missing" ? [] : [{ url, error: new Error("route failed") }]);

    await expect(fetch(url, { signal: caller.signal })).rejects.toBe(caller.signal.reason);

    expect(fetch.calls).toHaveLength(1);
  });

  it.each(["live", "null"])("honors a %s init signal overriding an aborted Request", async (kind) => {
    const stopped = new AbortController();
    stopped.abort(new Error("stopped"));
    const predicate = vi.fn(() => true);
    const fetch = fakeFetch([{ url: predicate, text: "ready" }]);

    const response = await fetch(new Request(url, { signal: stopped.signal }), {
      signal: kind === "live" ? new AbortController().signal : null
    });

    expect(await response.text()).toBe("ready");
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.signal.aborted).toBe(false);
    expect(predicate).toHaveBeenCalledExactlyOnceWith(url);
  });

  it("retains Request construction errors before recording or routing a call", async () => {
    const caller = new AbortController();
    caller.abort(new Error("stopped"));
    const predicate = vi.fn(() => true);
    const fetch = fakeFetch([{ url: predicate, text: "ready" }]);

    await expect(fetch("not an absolute URL", { signal: caller.signal })).rejects.toBeInstanceOf(TypeError);

    expect(fetch.calls).toHaveLength(0);
    expect(predicate).not.toHaveBeenCalled();
  });
});
