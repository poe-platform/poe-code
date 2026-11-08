import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeLogger } from "toolcraft";
import { requestJson, type HttpRequestOptions } from "./http.js";

const requestOptions: HttpRequestOptions = {
  baseUrl: "https://api.example.test",
  path: "/items",
  method: "GET",
  auth: "none",
  tokenSource: { getToken: async () => "unused" }
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HTTP request cancellation", () => {
  it.each([undefined, new Error("caller cancelled"), "cancelled"])("does not fetch or back off with a pre-aborted signal: %s", async (reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      init?.signal?.throwIfAborted();
      return Response.json({ ok: true });
    });
    const sleep = vi.fn(async () => undefined);

    await expect(requestJson({
      ...requestOptions,
      signal: controller.signal,
      fetch: fetchMock,
      retries: { max: 2, backoff: "exponential", retryOn: [503], sleep }
    })).rejects.toMatchObject({ name: "UserError", message: expect.stringContaining("Request aborted"), cause: controller.signal.reason });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([false, true])("does not retry a fetch AbortError with wrapped=%s", async (wrapped) => {
    const abort = new DOMException("cancelled", "AbortError");
    const failure = wrapped ? new TypeError("fetch failed", { cause: abort }) : abort;
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () => { throw failure; });
    const sleep = vi.fn(async () => undefined);

    await expect(requestJson({
      ...requestOptions,
      fetch: fetchMock,
      retries: { max: 2, backoff: "exponential", retryOn: [503], sleep }
    })).rejects.toMatchObject({ name: "UserError", message: expect.stringContaining("Request aborted"), cause: failure });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("honors an in-flight abort with a custom reason and redacts the diagnostic URL", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () => {
      controller.abort(reason);
      throw reason;
    });
    const sleep = vi.fn(async () => undefined);
    const failure = await requestJson({
      ...requestOptions,
      query: { api_key: "AUDIT_CANCEL_SECRET" },
      signal: controller.signal,
      fetch: fetchMock,
      retries: { max: 2, backoff: "exponential", retryOn: [503], sleep }
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: "UserError", message: expect.stringContaining("Request aborted"), cause: reason });
    expect((failure as Error).message).not.toContain("AUDIT_CANCEL_SECRET");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not enter backoff when response cleanup aborts the request", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => { controller.abort(); });
    const fetchMock = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 503 }))
      .mockResolvedValue(Response.json({ ok: true }));
    const sleep = vi.fn(async () => undefined);
    const messages: string[] = [];

    await expect(requestJson({
      ...requestOptions,
      signal: controller.signal,
      fetch: fetchMock,
      diagnostics: createRuntimeLogger({ level: "debug", logger: (event) => { messages.push(event.message); } }),
      retries: { max: 2, backoff: "exponential", retryOn: [503], sleep }
    })).rejects.toMatchObject({ name: "UserError", message: expect.stringContaining("Request aborted") });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(messages.some((message) => message.startsWith("Retrying"))).toBe(false);
  });

  it.each(["response", "network"] as const)("interrupts pending injected backoff after a %s failure", async (kind) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error("stop backoff");
    let releaseSleep: () => void;
    const sleep = vi.fn(() => new Promise<void>((resolve) => { releaseSleep = resolve; }));
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ ok: true }));
    if (kind === "response") fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    else fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    let settled = false;
    const outcome = requestJson({
      ...requestOptions,
      signal: controller.signal,
      fetch: fetchMock,
      retries: { max: 2, backoff: "exponential", retryOn: [503], sleep }
    }).then((value) => { settled = true; return value; }, (error: unknown) => { settled = true; return error; });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(sleep).toHaveBeenCalledTimes(1);
      controller.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      expect(await outcome).toMatchObject({ name: "UserError", message: expect.stringContaining("Request aborted"), cause: reason });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      releaseSleep!();
      await outcome;
    }
  });

  it("clears the native backoff timer when aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { "retry-after": "60" } }))
      .mockResolvedValue(Response.json({ ok: true }));
    let settled = false;
    const outcome = requestJson({
      ...requestOptions,
      signal: controller.signal,
      fetch: fetchMock,
      retries: { max: 2, backoff: "exponential", retryOn: [503] }
    }).then((value) => { settled = true; return value; }, (error: unknown) => { settled = true; return error; });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(await outcome).toMatchObject({ name: "UserError", message: expect.stringContaining("Request aborted") });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await vi.runOnlyPendingTimersAsync();
      await outcome;
    }
  });

  it.each(["resolve", "reject", "throw", "abort"] as const)("removes injected-backoff abort listeners after %s", async (mode) => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const failure = new Error("sleep failed");
    const sleep = vi.fn(() => {
      if (mode === "throw") throw failure;
      if (mode === "reject") return Promise.reject(failure);
      if (mode === "abort") controller.abort();
      return Promise.resolve();
    });
    const fetchMock = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const operation = requestJson({
      ...requestOptions,
      signal: controller.signal,
      fetch: fetchMock,
      retries: { max: 2, backoff: "exponential", retryOn: [503], sleep }
    });

    if (mode === "resolve") await expect(operation).resolves.toEqual({ ok: true });
    else if (mode === "abort") await expect(operation).rejects.toMatchObject({ name: "UserError", message: expect.stringContaining("Request aborted") });
    else await expect(operation).rejects.toBe(failure);

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0]![1]);
    expect(fetchMock).toHaveBeenCalledTimes(mode === "resolve" ? 2 : 1);
  });

  it("settles cancellation even if injected sleep rejects later", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let rejectSleep: (error: Error) => void;
    const sleep = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSleep = reject; }));
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(null, { status: 503 }));
    const outcome = requestJson({
      ...requestOptions,
      signal: controller.signal,
      fetch: fetchMock,
      retries: { max: 2, backoff: "exponential", retryOn: [503], sleep }
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await outcome).toMatchObject({ name: "UserError", message: expect.stringContaining("Request aborted") });
    rejectSleep!(new Error("late sleep failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
