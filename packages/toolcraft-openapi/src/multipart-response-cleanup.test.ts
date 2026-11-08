import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareMultipartFileInputs } from "./http.js";

const shape = { body: { file: "https://files.example.test/input" } };
const options = {
  bodyMode: "multipart" as const,
  multipartBinaryFields: ["file"],
  fs: { exists: async () => false, readFile: async () => "", writeFile: async () => undefined },
  env: { get: () => undefined }
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("multipart response cleanup", () => {
  describe.each([false, true])("body cancellation rejects: %s", (rejects) => {
    it.each([
      { name: "HTTP error", init: { status: 404 }, message: "returned HTTP 404" },
      { name: "declared size", init: { headers: { "content-length": String(101 * 1024 * 1024) } }, message: "exceeds the 100 MiB file limit" },
      { name: "missing location", init: { status: 302 }, message: "exceeded the redirect limit" },
      { name: "invalid location", init: { status: 302, headers: { location: "http://[invalid" } }, message: "Invalid URL" }
    ])("disposes the $name response without replacing its error", async ({ init, message }) => {
      const caller = new AbortController();
      const cancel = vi.fn(async () => {
        if (rejects) throw new Error("cleanup failed");
      });
      const response = new Response(new ReadableStream({ cancel }), init);
      const fetchMock = vi.fn<typeof fetch>(async () => response);

      await expect(prepareMultipartFileInputs(shape, { ...options, signal: caller.signal, fetch: fetchMock }))
        .rejects.toThrow(message);

      expect(cancel).toHaveBeenCalledOnce();
      expect(response.bodyUsed).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(caller.signal.aborted).toBe(false);
      expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it.each([false, true])("disposes each redirect before following it with caller signal: %s", async (withSignal) => {
    const caller = new AbortController();
    const order: string[] = [];
    const signals: AbortSignal[] = [];
    let requests = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const request = ++requests;
      signals.push(init!.signal!);
      order.push(`fetch ${request}`);
      if (request === 3) return new Response("done");
      return new Response(new ReadableStream({
        async cancel() {
          order.push(`cancel ${request}`);
          await Promise.resolve();
          order.push(`disposed ${request}`);
        }
      }), { status: 302, headers: { location: `/step-${request}` } });
    });

    const result = await prepareMultipartFileInputs(shape, {
      ...options,
      ...(withSignal ? { signal: caller.signal } : {}),
      fetch: fetchMock
    });

    expect(result.body).toMatchObject({ file: { data: "ZG9uZQ==" } });
    expect(order).toEqual(["fetch 1", "cancel 1", "disposed 1", "fetch 2", "cancel 2", "disposed 2", "fetch 3"]);
    expect(signals.every((signal) => signal === signals[0] && !signal.aborted)).toBe(true);
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    caller.abort();
    expect(signals[0]!.aborted).toBe(false);
  });

  it("disposes every response when the redirect limit is reached", async () => {
    const cancel = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel }), {
      status: 302,
      headers: { location: "/again" }
    }));

    await expect(prepareMultipartFileInputs(shape, { ...options, fetch: fetchMock }))
      .rejects.toThrow("exceeded the redirect limit");

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(cancel).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops following redirects when disposal fails", async () => {
    const cancel = vi.fn(async () => { throw new Error("cleanup failed"); });
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      signals.push(init!.signal!);
      return signals.length === 1
        ? new Response(new ReadableStream({ cancel }), { status: 302, headers: { location: "/next" } })
        : new Response("done");
    });

    await expect(prepareMultipartFileInputs(shape, { ...options, fetch: fetchMock }))
      .rejects.toThrow("Could not download multipart field");

    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(signals[0]!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("disposes an unread response after header-time cancellation; cleanup rejects: %s", async (rejects) => {
    const caller = new AbortController();
    const cancel = vi.fn(async () => {
      if (rejects) throw new Error("cleanup failed");
    });
    const response = new Response(new ReadableStream({ cancel }));
    const fetchMock = vi.fn<typeof fetch>(async () => {
      caller.abort(new Error("caller stopped"));
      return response;
    });

    await expect(prepareMultipartFileInputs(shape, { ...options, signal: caller.signal, fetch: fetchMock }))
      .rejects.toThrow("Could not download multipart field");

    expect(cancel).toHaveBeenCalledOnce();
    expect(response.bodyUsed).toBe(true);
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["done", "", null])("retains completed response semantics for %s", async (body) => {
    const response = new Response(body);
    const cancel = response.body === null ? undefined : vi.spyOn(response.body, "cancel");
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      signals.push(init!.signal!);
      return response;
    });

    const result = await prepareMultipartFileInputs(shape, { ...options, fetch: fetchMock });

    expect(result.body).toMatchObject({ file: { data: Buffer.from(body ?? "").toString("base64") } });
    if (cancel !== undefined) expect(cancel).not.toHaveBeenCalled();
    expect(signals[0]!.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains fetch failures without a response to dispose", async () => {
    const caller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async () => { throw new Error("fetch failed"); });

    await expect(prepareMultipartFileInputs(shape, { ...options, signal: caller.signal, fetch: fetchMock }))
      .rejects.toThrow("Could not download multipart field");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
