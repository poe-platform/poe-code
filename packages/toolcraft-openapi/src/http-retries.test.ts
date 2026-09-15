import { describe, expect, it, vi } from "vitest";
import { createRuntimeLogger } from "toolcraft";
import { requestJson, type HttpRequestOptions } from "./http.js";

const requestOptions: HttpRequestOptions = {
  baseUrl: "https://api.example.test",
  path: "/items",
  method: "GET",
  auth: "none",
  tokenSource: { getToken: async () => "unused" }
};

describe("HTTP retry response cleanup", () => {
  it("cancels a discarded response before sleeping or fetching again", async () => {
    const operations: string[] = [];
    const response = new Response(new ReadableStream({
      cancel() {
        operations.push("cancel");
      }
    }), { status: 503 });
    const fetchMock = vi.fn<typeof globalThis.fetch>()
      .mockImplementationOnce(async () => {
        operations.push("first fetch");
        return response;
      })
      .mockImplementationOnce(async () => {
        operations.push("second fetch");
        return Response.json({ ok: true });
      });

    await expect(requestJson({
      ...requestOptions,
      fetch: fetchMock,
      retries: {
        max: 1,
        backoff: "exponential",
        retryOn: [503],
        sleep: async () => { operations.push("sleep"); }
      }
    })).resolves.toEqual({ ok: true });

    expect(operations).toEqual(["first fetch", "cancel", "sleep", "second fetch"]);
    expect(response.bodyUsed).toBe(true);
  });

  it("retries a response without a body", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const sleep = vi.fn(async () => undefined);

    await expect(requestJson({
      ...requestOptions,
      fetch: fetchMock,
      retries: { max: 1, backoff: "exponential", retryOn: [503], sleep }
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("consumes rather than cancels the final error response", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"message":"unavailable"}'));
        controller.close();
      },
      cancel
    }), { status: 503, headers: { "content-type": "application/json" } });

    await expect(requestJson({
      ...requestOptions,
      fetch: vi.fn(async () => response),
      retries: { max: 0, backoff: "exponential", retryOn: [503] }
    })).rejects.toMatchObject({ response: { body: { message: "unavailable" } } });

    expect(cancel).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(true);
  });

  it("releases a retry response and propagates a backoff failure without retrying it", async () => {
    const cancel = vi.fn();
    const failure = new Error("backoff failed");
    const fetchMock = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const sleep = vi.fn<(ms: number) => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);

    await expect(requestJson({
      ...requestOptions,
      fetch: fetchMock,
      retries: { max: 2, backoff: "exponential", retryOn: [503], sleep }
    })).rejects.toBe(failure);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("releases a retry response before propagating a diagnostic sink failure", async () => {
    const cancel = vi.fn();
    const failure = new Error("diagnostic sink failed");
    const fetchMock = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const sleep = vi.fn(async () => undefined);
    let retryLogs = 0;

    await expect(requestJson({
      ...requestOptions,
      fetch: fetchMock,
      retries: { max: 2, backoff: "exponential", retryOn: [503], sleep },
      diagnostics: createRuntimeLogger({ level: "debug", logger: (event) => {
        if (event.message.startsWith("Retrying")) {
          retryLogs += 1;
          if (retryLogs === 1) throw failure;
        }
      } })
    })).rejects.toBe(failure);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(retryLogs).toBe(1);
  });

  it("does not classify a response cleanup failure as a fetch failure", async () => {
    const failure = new Error("cleanup failed");
    const cancel = vi.fn(async () => { throw failure; });
    const fetchMock = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const sleep = vi.fn(async () => undefined);

    await expect(requestJson({
      ...requestOptions,
      fetch: fetchMock,
      retries: { max: 2, backoff: "exponential", retryOn: [503], sleep }
    })).rejects.toBe(failure);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
