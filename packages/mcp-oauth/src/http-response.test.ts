import { expect, it, vi } from "vitest";
import { readBoundedResponseText } from "./http-response.js";

it.each(["pre-aborted", "declared size", "stream size", "UTF-8", "mid-read abort"])(
  "settles %s failure without awaiting stalled body cancellation", async (mode) => {
    let finishCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => { finishCancellation = resolve; });
    const cancel = vi.fn(() => cancellation);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (mode === "stream size") controller.enqueue(new Uint8Array(9));
        if (mode === "UTF-8") controller.enqueue(new Uint8Array([0xff]));
      },
      cancel
    });
    const response = new Response(body, mode === "declared size"
      ? { headers: { "Content-Length": "9" } } : {});
    const controller = new AbortController();
    if (mode === "pre-aborted") controller.abort(new Error("cancelled"));
    const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
    let failure: unknown;
    const operation = readBoundedResponseText(response, 8, readers, controller.signal)
      .catch((error) => { failure = error; });
    if (mode === "mid-read abort") controller.abort(new Error("cancelled"));
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(cancel).toHaveBeenCalledOnce();
      expect(failure).toBeInstanceOf(Error);
      expect(readers.size).toBe(0);
      expect(body.locked).toBe(false);
    } finally {
      finishCancellation();
      await operation;
    }
  }
);

it("counts UTF-8 bytes across chunks and cancels an oversized open body", async () => {
  const cancel = vi.fn();
  const bytes = new TextEncoder().encode("😃");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.enqueue(bytes);
      controller.enqueue(bytes);
    },
    cancel
  });
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  await expect(readBoundedResponseText(new Response(body), 8, readers)).rejects.toThrow("8 bytes");
  expect(cancel).toHaveBeenCalledOnce();
  expect(readers.size).toBe(0);
  expect(body.locked).toBe(false);
});

it("accepts exactly the byte limit with UTF-8 characters split across chunks", async () => {
  const bytes = new TextEncoder().encode("😃😃");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 2));
      controller.enqueue(bytes.slice(2));
      controller.close();
    }
  });
  expect(await readBoundedResponseText(new Response(body), 8)).toBe("😃😃");
});

it("rejects an oversized declared content length before acquiring a reader", async () => {
  const response = new Response("small", { headers: { "Content-Length": "999999999999999999999" } });
  const getReader = vi.spyOn(response.body!, "getReader");
  await expect(readBoundedResponseText(response, 8)).rejects.toThrow("8 bytes");
  expect(getReader).not.toHaveBeenCalled();
  expect(response.body!.locked).toBe(false);
});

it("enforces actual bytes when content length understates the body", async () => {
  await expect(readBoundedResponseText(new Response("123456789", {
    headers: { "Content-Length": "1" }
  }), 8)).rejects.toThrow("8 bytes");
});

it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid byte limit %s", async (limit) => {
  await expect(readBoundedResponseText(new Response("body"), limit)).rejects.toThrow("positive safe integer");
});

it("rejects malformed UTF-8 and releases its reader", async () => {
  const response = new Response(new Uint8Array([0xc3]));
  await expect(readBoundedResponseText(response, 8)).rejects.toThrow();
  expect(response.body!.locked).toBe(false);
});

it("handles an absent response body", async () => {
  expect(await readBoundedResponseText(new Response(null), 8)).toBe("");
});
