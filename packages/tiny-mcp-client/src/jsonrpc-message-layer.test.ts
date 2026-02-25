import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_INVALID_REQUEST,
  ERROR_PARSE,
  JsonRpcMessageLayer,
  McpError,
  readLines,
} from "./internal.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length > 0) {
    cleanup.pop()?.();
  }
});

class TrackingReadable extends Readable {
  asyncIteratorStarted = false;

  constructor() {
    super({
      read() {},
    });
  }

  override [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
    this.asyncIteratorStarted = true;
    return super[Symbol.asyncIterator]() as AsyncIterableIterator<unknown>;
  }
}

function trackForCleanup(...streams: Array<PassThrough | TrackingReadable>): void {
  cleanup.push(() => {
    for (const stream of streams) {
      stream.destroy();
    }
  });
}

function createLargePayload(sizeInBytes: number): string {
  return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_"
    .repeat(Math.ceil(sizeInBytes / 64))
    .slice(0, sizeInBytes);
}

describe("JsonRpcMessageLayer constructor", () => {
  it("takes input/output streams and supports custom requestTimeoutMs", () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);

    const layer = new JsonRpcMessageLayer(input, output, 12_345);

    expect(layer).toBeInstanceOf(JsonRpcMessageLayer);
    expect(layer.requestTimeoutMs).toBe(12_345);
  });

  it("defaults requestTimeoutMs to 30000", () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);

    const layer = new JsonRpcMessageLayer(input, output);

    expect(layer.requestTimeoutMs).toBe(30_000);
  });

  it("starts consuming input lines immediately", async () => {
    const input = new TrackingReadable();
    const output = new PassThrough();
    trackForCleanup(input, output);

    new JsonRpcMessageLayer(input, output);

    await vi.waitFor(() => {
      expect(input.asyncIteratorStarted).toBe(true);
    });
  });

  it.each([
    { label: "negative number", value: -1 },
    { label: "positive infinity", value: Number.POSITIVE_INFINITY },
    { label: "negative infinity", value: Number.NEGATIVE_INFINITY },
    { label: "NaN", value: Number.NaN },
  ])("rejects $label requestTimeoutMs values", ({ value }) => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);

    expect(() => new JsonRpcMessageLayer(input, output, value)).toThrow(
      "requestTimeoutMs must be a non-negative finite number"
    );
  });
});

describe("JsonRpcMessageLayer sendRequest", () => {
  it("writes request with id=1 to output", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);

    const responsePromise = layer.sendRequest("tools/list", { cursor: "next" });

    const firstLine = await outputIterator.next();
    expect(firstLine.done).toBe(false);
    expect(firstLine.value).toBe(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { cursor: "next" },
      })
    );

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } })}\n`);
    await expect(responsePromise).resolves.toEqual({ tools: [] });
    await outputIterator.return?.();
  });

  it("sends request with a 100KB params object without truncation", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const largePayload = createLargePayload(100 * 1024);
    const largeParams = {
      payload: largePayload,
      metadata: {
        length: largePayload.length,
        prefix: largePayload.slice(0, 32),
        suffix: largePayload.slice(-32),
      },
    };

    const responsePromise = layer.sendRequest("tools/call", largeParams);
    const requestLine = await outputIterator.next();
    expect(requestLine.done).toBe(false);
    const outbound = JSON.parse(requestLine.value!) as {
      jsonrpc: "2.0";
      id: number;
      method: string;
      params: typeof largeParams;
    };

    expect(outbound).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: largeParams,
    });
    expect(outbound.params.payload.length).toBe(100 * 1024);
    expect(outbound.params.payload).toBe(largePayload);

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: outbound.id, result: { ok: true } })}\n`);
    await expect(responsePromise).resolves.toEqual({ ok: true });
    await outputIterator.return?.();
  });

  it("receives large response payloads without truncation", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const responsePromise = layer.sendRequest("tools/call", {
      name: "echo",
    });
    const requestLine = await outputIterator.next();

    expect(requestLine.done).toBe(false);
    const outbound = JSON.parse(requestLine.value!) as {
      id: number;
    };
    const largePayload = createLargePayload(100 * 1024);
    const largeResult = {
      content: [
        {
          type: "text",
          text: largePayload,
        },
      ],
      metadata: {
        length: largePayload.length,
      },
    };
    const responseLine = `${JSON.stringify({
      jsonrpc: "2.0",
      id: outbound.id,
      result: largeResult,
    })}\n`;

    for (let index = 0; index < responseLine.length; index += 4093) {
      input.write(responseLine.slice(index, index + 4093));
    }

    await expect(responsePromise).resolves.toEqual(largeResult);
    await outputIterator.return?.();
  });

  it("keeps 100KB payload content exact with no truncation or corruption", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const largePayload = createLargePayload(100 * 1024);
    const requestParams = { payload: largePayload };

    const responsePromise = layer.sendRequest("tools/call", requestParams);
    const requestLine = await outputIterator.next();
    expect(requestLine.done).toBe(false);
    const outbound = JSON.parse(requestLine.value!) as {
      id: number;
      params: typeof requestParams;
    };

    expect(outbound.params.payload).toBe(largePayload);
    expect(outbound.params.payload.length).toBe(largePayload.length);
    expect(outbound.params.payload.slice(0, 64)).toBe(largePayload.slice(0, 64));
    expect(outbound.params.payload.slice(-64)).toBe(largePayload.slice(-64));

    const responseResult = { payload: outbound.params.payload };
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: outbound.id,
        result: responseResult,
      })}\n`
    );

    await expect(responsePromise).resolves.toEqual(responseResult);
    await expect(responsePromise).resolves.toMatchObject({
      payload: largePayload,
    });
    await outputIterator.return?.();
  });

  it("sends 10 concurrent requests and assigns each a unique id", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);

    const responsePromises = Array.from({ length: 10 }, (_, index) =>
      layer.sendRequest("tools/list", { cursor: `cursor-${index + 1}` })
    );

    const outboundRequests: Array<{
      jsonrpc: "2.0";
      id: number;
      method: string;
      params: { cursor: string };
    }> = [];
    for (let index = 0; index < 10; index += 1) {
      const requestLine = await outputIterator.next();
      expect(requestLine.done).toBe(false);
      outboundRequests.push(JSON.parse(requestLine.value!) as (typeof outboundRequests)[number]);
    }

    expect(outboundRequests).toEqual(
      Array.from({ length: 10 }, (_, index) => ({
        jsonrpc: "2.0" as const,
        id: index + 1,
        method: "tools/list",
        params: { cursor: `cursor-${index + 1}` },
      }))
    );
    expect(new Set(outboundRequests.map((request) => request.id)).size).toBe(10);

    for (const request of outboundRequests) {
      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { cursor: request.params.cursor },
        })}\n`
      );
    }

    await expect(Promise.all(responsePromises)).resolves.toEqual(
      outboundRequests.map((request) => ({
        cursor: request.params.cursor,
      }))
    );
    await outputIterator.return?.();
  });

  it("correlates concurrent requests when responses arrive out of order", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);

    const responsePromises = Array.from({ length: 10 }, (_, index) =>
      layer.sendRequest("tools/call", { name: `tool-${index + 1}` })
    );

    const outboundRequests: Array<{
      id: number;
      params: { name: string };
    }> = [];
    for (let index = 0; index < 10; index += 1) {
      const requestLine = await outputIterator.next();
      expect(requestLine.done).toBe(false);
      outboundRequests.push(
        JSON.parse(requestLine.value!) as { id: number; params: { name: string } }
      );
    }

    for (const request of [...outboundRequests].reverse()) {
      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { handledById: request.id },
        })}\n`
      );
    }

    await expect(Promise.all(responsePromises)).resolves.toEqual(
      outboundRequests.map((request) => ({
        handledById: request.id,
      }))
    );
    await outputIterator.return?.();
  });

  it("keeps concurrent requests isolated so one error does not affect others", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const pendingCount = () =>
      (
        layer as unknown as {
          pendingRequests: Map<unknown, unknown>;
        }
      ).pendingRequests.size;

    const responsePromises = Array.from({ length: 10 }, (_, index) =>
      layer.sendRequest("tools/call", { name: `tool-${index + 1}` })
    );

    const outboundRequests: Array<{
      id: number;
      params: { name: string };
    }> = [];
    for (let index = 0; index < 10; index += 1) {
      const requestLine = await outputIterator.next();
      expect(requestLine.done).toBe(false);
      outboundRequests.push(
        JSON.parse(requestLine.value!) as { id: number; params: { name: string } }
      );
    }
    expect(pendingCount()).toBe(10);

    const failedRequestId = outboundRequests[3]!.id;
    const responseOrder = [
      outboundRequests[7]!,
      outboundRequests[3]!,
      outboundRequests[0]!,
      outboundRequests[9]!,
      outboundRequests[1]!,
      outboundRequests[5]!,
      outboundRequests[8]!,
      outboundRequests[2]!,
      outboundRequests[4]!,
      outboundRequests[6]!,
    ];

    for (const request of responseOrder) {
      if (request.id === failedRequestId) {
        input.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32001,
              message: "tool failure",
              data: { id: request.id },
            },
          })}\n`
        );
        continue;
      }

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { name: request.params.name, id: request.id },
        })}\n`
      );
    }

    const settled = await Promise.allSettled(responsePromises);
    expect(pendingCount()).toBe(0);

    for (let index = 0; index < settled.length; index += 1) {
      const request = outboundRequests[index]!;
      const result = settled[index]!;
      if (request.id === failedRequestId) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.reason).toBeInstanceOf(McpError);
          expect(result.reason).toMatchObject({
            code: -32001,
            message: "tool failure",
            data: { id: request.id },
          });
        }
        continue;
      }

      expect(result).toEqual({
        status: "fulfilled",
        value: {
          name: request.params.name,
          id: request.id,
        },
      });
    }

    await outputIterator.return?.();
  });

  it("rejects request with McpError when server responds with error", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);

    const responsePromise = layer.sendRequest("tools/call", {
      name: "explode",
    });

    const requestLine = await outputIterator.next();
    expect(requestLine.done).toBe(false);
    expect(JSON.parse(requestLine.value!)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "explode",
      },
    });

    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32001,
          message: "Tool execution failed",
          data: { tool: "explode", retryable: false },
        },
      })}\n`
    );

    await expect(responsePromise).rejects.toBeInstanceOf(McpError);
    await expect(responsePromise).rejects.toMatchObject({
      code: -32001,
      message: "Tool execution failed",
      data: { tool: "explode", retryable: false },
    });

    await outputIterator.return?.();
  });

  it("rejects request when default timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      const input = new PassThrough();
      const output = new PassThrough();
      trackForCleanup(input, output);
      const layer = new JsonRpcMessageLayer(input, output, 25);

      const pendingCount = () =>
        (
          layer as unknown as {
            pendingRequests: Map<unknown, unknown>;
          }
        ).pendingRequests.size;

      const responsePromise = layer.sendRequest("slow/method");
      expect(pendingCount()).toBe(1);

      const timeoutPromise = expect(responsePromise).rejects.toThrow(
        'JSON-RPC request "slow/method" timed out after 25ms'
      );

      await vi.advanceTimersByTimeAsync(25);

      await timeoutPromise;
      expect(pendingCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses per-request timeout override when options.timeoutMs is provided", async () => {
    vi.useFakeTimers();
    try {
      const input = new PassThrough();
      const output = new PassThrough();
      trackForCleanup(input, output);
      const layer = new JsonRpcMessageLayer(input, output, 1_000);
      const pendingCount = () =>
        (
          layer as unknown as {
            pendingRequests: Map<unknown, unknown>;
          }
        ).pendingRequests.size;

      const responsePromise = layer.sendRequest(
        "custom/timeout",
        undefined,
        { timeoutMs: 15 }
      );
      const timeoutPromise = expect(responsePromise).rejects.toThrow(
        'JSON-RPC request "custom/timeout" timed out after 15ms'
      );

      await vi.advanceTimersByTimeAsync(14);
      expect(pendingCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      await timeoutPromise;
      expect(pendingCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("JsonRpcMessageLayer sendNotification", () => {
  it("writes notification without id and does not create pending request entry", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const pendingCount = () =>
      (
        layer as unknown as {
          pendingRequests: Map<unknown, unknown>;
        }
      ).pendingRequests.size;

    expect(pendingCount()).toBe(0);
    layer.sendNotification("notifications/tools/list_changed");
    expect(pendingCount()).toBe(0);

    const notificationLine = await outputIterator.next();
    expect(notificationLine.done).toBe(false);
    const notification = JSON.parse(notificationLine.value!) as {
      id?: unknown;
      method: string;
      params?: unknown;
    };

    expect(notification).toEqual({
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
    });
    expect(notification.id).toBeUndefined();

    await outputIterator.return?.();
  });

  it("includes params when provided", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);

    layer.sendNotification("notifications/message", {
      level: "info",
      data: { event: "ready" },
    });

    const notificationLine = await outputIterator.next();
    expect(notificationLine.done).toBe(false);
    expect(JSON.parse(notificationLine.value!)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        level: "info",
        data: { event: "ready" },
      },
    });

    await outputIterator.return?.();
  });

  it("omits params when not provided", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);

    layer.sendNotification("notifications/initialized");

    const notificationLine = await outputIterator.next();
    expect(notificationLine.done).toBe(false);
    const notification = JSON.parse(notificationLine.value!) as {
      params?: unknown;
    };
    expect(notification).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect("params" in notification).toBe(false);

    await outputIterator.return?.();
  });
});

describe("JsonRpcMessageLayer dispose", () => {
  it("rejects all pending requests with provided error and clears their timeouts", async () => {
    vi.useFakeTimers();
    try {
      const input = new PassThrough();
      const output = new PassThrough();
      trackForCleanup(input, output);
      const layer = new JsonRpcMessageLayer(input, output, 5_000);
      const pendingCount = () =>
        (
          layer as unknown as {
            pendingRequests: Map<unknown, unknown>;
          }
        ).pendingRequests.size;

      const disposalError = new Error("disposed by client");
      const firstRequest = layer.sendRequest("first/request");
      const secondRequest = layer.sendRequest("second/request");

      expect(pendingCount()).toBe(2);
      expect(vi.getTimerCount()).toBe(2);

      layer.dispose(disposalError);

      expect(pendingCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      await expect(firstRequest).rejects.toBe(disposalError);
      await expect(secondRequest).rejects.toBe(disposalError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects pending requests with default disposal error when no reason is provided", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const layer = new JsonRpcMessageLayer(input, output, 1_000);
    const request = layer.sendRequest("slow/request");

    layer.dispose();

    await expect(request).rejects.toThrow("JSON-RPC message layer disposed");
  });

  it("throws on sendRequest and sendNotification after dispose and remains idempotent", () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const layer = new JsonRpcMessageLayer(input, output);

    layer.dispose();
    layer.dispose();

    expect(() => layer.sendRequest("tools/list")).toThrow("JSON-RPC message layer disposed");
    expect(() => layer.sendNotification("notifications/initialized")).toThrow(
      "JSON-RPC message layer disposed"
    );
  });

  it("auto-disposes on input stream close and rejects pending requests with stream closed error", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const layer = new JsonRpcMessageLayer(input, output, 100);
    const pendingRequest = layer.sendRequest("slow/request");

    input.end();

    await expect(pendingRequest).rejects.toThrow("stream closed");
    expect(() => layer.sendRequest("tools/list")).toThrow("stream closed");
    expect(() => layer.sendNotification("notifications/initialized")).toThrow(
      "stream closed"
    );
  });
});

describe("JsonRpcMessageLayer onRequest", () => {
  it("registers request handler and writes success response with handler result", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const handler = vi.fn((params: unknown, context: unknown) => ({
      params,
      context,
    }));

    layer.onRequest("tools/call", handler);
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hello" } },
      })}\n`
    );

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler).toHaveBeenCalledWith(
      { name: "echo", arguments: { text: "hello" } },
      { id: 7, method: "tools/call" }
    );

    const responseLine = await outputIterator.next();
    expect(responseLine.done).toBe(false);
    expect(JSON.parse(responseLine.value!)).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: {
        params: { name: "echo", arguments: { text: "hello" } },
        context: { id: 7, method: "tools/call" },
      },
    });

    await outputIterator.return?.();
  });

  it("writes error response when registered request handler throws", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const handler = vi.fn(() => {
      throw new Error("handler exploded");
    });

    layer.onRequest("tools/call", handler);
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "req-1",
        method: "tools/call",
        params: { name: "explode" },
      })}\n`
    );

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    const responseLine = await outputIterator.next();
    expect(responseLine.done).toBe(false);
    expect(JSON.parse(responseLine.value!)).toEqual({
      jsonrpc: "2.0",
      id: "req-1",
      error: {
        code: -32603,
        message: "handler exploded",
      },
    });

    await outputIterator.return?.();
  });

  it("writes method-not-found error for unregistered request methods", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    new JsonRpcMessageLayer(input, output);
    const writeSpy = vi.spyOn(output, "write");

    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 23,
        method: "tools/unknown",
        params: { value: "ignored" },
      })}\n`
    );

    await vi.waitFor(() => {
      expect(writeSpy).toHaveBeenCalledTimes(1);
    });

    const [line] = writeSpy.mock.calls[0] as [string];
    const response = JSON.parse(line) as {
      jsonrpc: "2.0";
      id: number;
      error: {
        code: number;
        message: string;
      };
    };

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(23);
    expect(response.error.code).toBe(-32601);
    expect(response.error.message).toContain("tools/unknown");
  });
});

describe("JsonRpcMessageLayer invalid input handling", () => {
  it("writes parse error response for malformed JSON input", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    new JsonRpcMessageLayer(input, output);

    input.write('{"jsonrpc":"2.0","id":1\n');

    const responseLine = await outputIterator.next();
    expect(responseLine.done).toBe(false);
    expect(JSON.parse(responseLine.value!)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: ERROR_PARSE,
        message: "Parse error",
      },
    });

    await outputIterator.return?.();
  });

  it("writes invalid-request response and preserves id when present", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    new JsonRpcMessageLayer(input, output);

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: "req-17" })}\n`);

    const responseLine = await outputIterator.next();
    expect(responseLine.done).toBe(false);
    expect(JSON.parse(responseLine.value!)).toEqual({
      jsonrpc: "2.0",
      id: "req-17",
      error: {
        code: ERROR_INVALID_REQUEST,
        message: "Invalid Request",
      },
    });

    await outputIterator.return?.();
  });

  it("parses CR+LF-delimited responses correctly", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);

    const responsePromise = layer.sendRequest("tools/list");
    const requestLine = await outputIterator.next();
    expect(requestLine.done).toBe(false);
    expect(JSON.parse(requestLine.value!)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } })}\r\n`);

    await expect(responsePromise).resolves.toEqual({ tools: [] });
    await outputIterator.return?.();
  });

  it("ignores empty input lines instead of treating them as invalid messages", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const layer = new JsonRpcMessageLayer(input, output);
    const writeSpy = vi.spyOn(output, "write");
    const handler = vi.fn();

    layer.onNotification("notifications/message", handler);
    input.write(
      `\n\r\n${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level: "info" },
      })}\n\r\n`
    );

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  it("parses messages split across multiple input stream chunks", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const handler = vi.fn(() => ({ ok: true }));

    layer.onRequest("tools/call", handler);

    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hello" } },
    });

    input.write(request.slice(0, 18));
    input.write(request.slice(18));
    input.write("\n");

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    const responseLine = await outputIterator.next();
    expect(responseLine.done).toBe(false);
    expect(JSON.parse(responseLine.value!)).toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { ok: true },
    });

    await outputIterator.return?.();
  });
});

describe("JsonRpcMessageLayer onNotification", () => {
  it("handles batch containing response and notification", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const notificationHandler = vi.fn();

    layer.onNotification("notifications/message", notificationHandler);
    const responsePromise = layer.sendRequest("tools/list");

    const requestLine = await outputIterator.next();
    expect(requestLine.done).toBe(false);
    expect(JSON.parse(requestLine.value!)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    input.write(
      `${JSON.stringify([
        {
          jsonrpc: "2.0",
          id: 1,
          result: { tools: [{ name: "batch-tool" }] },
        },
        {
          jsonrpc: "2.0",
          method: "notifications/message",
          params: { level: "info", data: { source: "batch" } },
        },
      ])}\n`
    );

    await expect(responsePromise).resolves.toEqual({
      tools: [{ name: "batch-tool" }],
    });
    await vi.waitFor(() => {
      expect(notificationHandler).toHaveBeenCalledTimes(1);
    });
    expect(notificationHandler).toHaveBeenCalledWith(
      { level: "info", data: { source: "batch" } },
      { method: "notifications/message" }
    );

    await outputIterator.return?.();
  });

  it("dispatches batch containing request and notification", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const requestHandler = vi.fn(() => ({ ok: true }));
    const notificationHandler = vi.fn();

    layer.onRequest("tools/call", requestHandler);
    layer.onNotification("notifications/message", notificationHandler);

    input.write(
      `${JSON.stringify([
        {
          jsonrpc: "2.0",
          id: "server-request-1",
          method: "tools/call",
          params: { name: "echo", arguments: { text: "from-batch" } },
        },
        {
          jsonrpc: "2.0",
          method: "notifications/message",
          params: { level: "info", data: { source: "batch" } },
        },
      ])}\n`
    );

    await vi.waitFor(() => {
      expect(requestHandler).toHaveBeenCalledTimes(1);
      expect(notificationHandler).toHaveBeenCalledTimes(1);
    });
    expect(requestHandler).toHaveBeenCalledWith(
      { name: "echo", arguments: { text: "from-batch" } },
      { id: "server-request-1", method: "tools/call" }
    );
    expect(notificationHandler).toHaveBeenCalledWith(
      { level: "info", data: { source: "batch" } },
      { method: "notifications/message" }
    );

    const requestResponseLine = await outputIterator.next();
    expect(requestResponseLine.done).toBe(false);
    expect(JSON.parse(requestResponseLine.value!)).toEqual({
      jsonrpc: "2.0",
      id: "server-request-1",
      result: { ok: true },
    });

    await outputIterator.return?.();
  });

  it("ignores an empty batch array", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const layer = new JsonRpcMessageLayer(input, output);
    const writeSpy = vi.spyOn(output, "write");
    const notificationHandler = vi.fn();

    layer.onNotification("notifications/message", notificationHandler);
    input.write("[]\n");
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/message",
      })}\n`
    );

    await vi.waitFor(() => {
      expect(notificationHandler).toHaveBeenCalledTimes(1);
    });
    expect(notificationHandler).toHaveBeenCalledWith(undefined, {
      method: "notifications/message",
    });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("processes each message when a single input line contains a JSON-RPC batch", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const requestHandler = vi.fn(() => ({ ok: true }));
    const notificationHandler = vi.fn();

    layer.onRequest("tools/call", requestHandler);
    layer.onNotification("notifications/message", notificationHandler);

    const responsePromise = layer.sendRequest("tools/list");
    const requestLine = await outputIterator.next();
    expect(requestLine.done).toBe(false);
    expect(JSON.parse(requestLine.value!)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    input.write(
      `${JSON.stringify([
        {
          jsonrpc: "2.0",
          id: 1,
          result: { tools: [{ name: "batch-tool" }] },
        },
        {
          jsonrpc: "2.0",
          id: "server-request-1",
          method: "tools/call",
          params: { name: "echo", arguments: { text: "from-batch" } },
        },
        {
          jsonrpc: "2.0",
          method: "notifications/message",
          params: { level: "info", data: { source: "batch" } },
        },
      ])}\n`
    );

    await expect(responsePromise).resolves.toEqual({
      tools: [{ name: "batch-tool" }],
    });

    await vi.waitFor(() => {
      expect(requestHandler).toHaveBeenCalledTimes(1);
      expect(notificationHandler).toHaveBeenCalledTimes(1);
    });
    expect(requestHandler).toHaveBeenCalledWith(
      { name: "echo", arguments: { text: "from-batch" } },
      { id: "server-request-1", method: "tools/call" }
    );
    expect(notificationHandler).toHaveBeenCalledWith(
      { level: "info", data: { source: "batch" } },
      { method: "notifications/message" }
    );

    const requestResponseLine = await outputIterator.next();
    expect(requestResponseLine.done).toBe(false);
    expect(JSON.parse(requestResponseLine.value!)).toEqual({
      jsonrpc: "2.0",
      id: "server-request-1",
      result: { ok: true },
    });

    await outputIterator.return?.();
  });

  it("registers notification handler and calls it with params and context", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const layer = new JsonRpcMessageLayer(input, output);
    const writeSpy = vi.spyOn(output, "write");
    const handler = vi.fn();

    layer.onNotification("notifications/message", handler);
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level: "info", data: { text: "hello" } },
      })}\n`
    );

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler).toHaveBeenCalledWith(
      { level: "info", data: { text: "hello" } },
      { method: "notifications/message" }
    );
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("silently ignores unregistered notification methods", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    trackForCleanup(input, output);
    const layer = new JsonRpcMessageLayer(input, output);
    const writeSpy = vi.spyOn(output, "write");
    const handler = vi.fn();

    layer.onNotification("notifications/known", handler);
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/unknown",
        params: { ignored: true },
      })}\n`
    );
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/known" })}\n`);

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler).toHaveBeenCalledWith(undefined, {
      method: "notifications/known",
    });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
