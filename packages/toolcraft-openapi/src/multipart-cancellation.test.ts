import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareMultipartFileInputs } from "./http.js";

const previousAny = Object.getOwnPropertyDescriptor(AbortSignal, "any");
const options = {
  bodyMode: "multipart" as const,
  multipartBinaryFields: ["file"],
  fs: { exists: async () => false, readFile: async () => "", writeFile: async () => undefined },
  env: { get: () => undefined }
};
const shape = { body: { file: "https://files.example.com/file.txt" } };

afterEach(() => {
  if (previousAny === undefined) Reflect.deleteProperty(AbortSignal, "any");
  else Object.defineProperty(AbortSignal, "any", previousAny);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each([false, true])("multipart with AbortSignal.any absent=%s", (absent) => {
  beforeEach(() => {
    if (absent) Object.defineProperty(AbortSignal, "any", { configurable: true, writable: true, value: undefined });
  });

  describe.each([false, true])("caller signal=%s", (withSignal) => {
    it.each(["success", "empty", "redirect", "http-error", "fetch-error"])("cleans up after %s", async (mode) => {
      vi.useFakeTimers();
      const caller = new AbortController();
      const signals: AbortSignal[] = [];
      const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
        signals.push(init!.signal!);
        if (mode === "fetch-error") throw new Error("download failed");
        if (mode === "redirect" && signals.length === 1) return new Response(null, { status: 302, headers: { location: "/next.txt" } });
        if (mode === "http-error") return new Response(null, { status: 503 });
        return new Response(mode === "empty" ? "" : "ready", { headers: { "content-type": "text/plain" } });
      });
      const operation = prepareMultipartFileInputs(shape, { ...options, ...(withSignal ? { signal: caller.signal } : {}), fetch: fetchMock });
      if (mode.endsWith("error")) await expect(operation).rejects.toMatchObject({ name: "UserError" });
      else {
        const result = await operation;
        expect(result.body).toEqual({ file: { data: mode === "empty" ? "" : "cmVhZHk=", filename: mode === "redirect" ? "next.txt" : "file.txt", contentType: "text/plain" } });
      }
      expect(fetchMock).toHaveBeenCalledTimes(mode === "redirect" ? 2 : 1);
      expect(signals.every((signal) => signal === signals[0] && !signal.aborted)).toBe(true);
      expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      caller.abort();
      expect(signals[0]!.aborted).toBe(false);
    });
  });

  it.each(["before", "fetch", "body"])("preserves caller cancellation during %s", async (stage) => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const reason = new Error("caller cancelled");
    if (stage === "before") caller.abort(reason);
    let downloadSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      downloadSignal = init!.signal!;
      if (stage === "fetch") caller.abort(reason);
      downloadSignal.throwIfAborted();
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          downloadSignal!.addEventListener("abort", () => controller.error(downloadSignal!.reason), { once: true });
          caller.abort(reason);
        }
      }));
    });
    await expect(prepareMultipartFileInputs(shape, { ...options, signal: caller.signal, fetch: fetchMock })).rejects.toBeDefined();
    if (stage === "before") expect(fetchMock).not.toHaveBeenCalled();
    else {
      expect(downloadSignal?.aborted).toBe(true);
      expect(downloadSignal?.reason).toBe(reason);
    }
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["headers", "body-close"])("rejects cancellation when the response still completes at %s", async (stage) => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const reason = new Error("caller cancelled");
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (stage === "headers") {
        caller.abort(reason);
        return new Response("");
      }
      let reads = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (reads++ === 0) controller.enqueue(new TextEncoder().encode("partial"));
          else {
            caller.abort(reason);
            controller.close();
          }
        }
      }, { highWaterMark: 0 }));
    });
    await expect(prepareMultipartFileInputs(shape, { ...options, signal: caller.signal, fetch: fetchMock })).rejects.toBeDefined();
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the download deadline and removes caller listeners", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    let downloadSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      downloadSignal = init!.signal!;
      return new Promise<Response>((_resolve, reject) => {
        downloadSignal!.addEventListener("abort", () => reject(downloadSignal!.reason), { once: true });
      });
    });
    const outcome = prepareMultipartFileInputs(shape, { ...options, signal: caller.signal, fetch: fetchMock }).catch((error: unknown) => error);
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(downloadSignal?.aborted).toBe(true);
      expect(downloadSignal?.reason).toMatchObject({ name: "TimeoutError" });
      expect(await outcome).toMatchObject({ name: "UserError" });
      expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      caller.abort();
      await outcome;
    }
  });
});
