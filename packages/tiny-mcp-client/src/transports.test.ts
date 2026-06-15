import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_INVALID_REQUEST,
  ERROR_METHOD_NOT_FOUND,
  ERROR_PARSE,
  HttpTransport,
  JsonRpcMessageLayer,
  McpClient,
  McpError,
  SseParser,
  StdioTransport,
  parseJsonRpcMessage,
  readLines,
  type CreateMessageParams,
  type CreateMessageResult,
  type McpClientOptions,
  type McpTransport,
  type McpTransportClosedEvent,
  type ProgressParams,
  type ServerCapabilities,
  type StdioSpawn,
} from "./internal.js";

// --- helpers from jsonrpc-message-layer.test.ts ---

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

// --- helpers from stdio-transport.test.ts ---

const testServerCli = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tiny-stdio-mcp-test-server/dist/cli.js"
);

const streamsForCleanup: PassThrough[] = [];

afterEach(() => {
  while (streamsForCleanup.length > 0) {
    streamsForCleanup.pop()?.destroy();
  }
});

interface MockChildProcess extends ChildProcessWithoutNullStreams {
  emitExit: (code?: number | null, signal?: NodeJS.Signals | null) => void;
  emitError: (error: Error) => void;
}

async function readSingleLineWithTimeout(
  transport: StdioTransport,
  timeoutMs: number
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for stdout line after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const nextLine = (async () => {
    for await (const line of readLines(transport.readable)) {
      return line;
    }
    throw new Error("Stdio transport stdout ended before any response line was read");
  })();

  const closedBeforeLine = transport.closed.then((closedEvent) => {
    throw new Error(
      `Process closed before stdout response: ${closedEvent.reason.message}`
    );
  });

  try {
    return await Promise.race([nextLine, timeout, closedBeforeLine]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function createMockChildProcess(): MockChildProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  streamsForCleanup.push(stdin, stdout, stderr);

  const child = new EventEmitter() as unknown as MockChildProcess & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    killed: boolean;
    kill: (signal?: NodeJS.Signals) => boolean;
    signalCode: NodeJS.Signals | null;
  };

  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn((signal?: NodeJS.Signals) => {
    child.killed = true;
    child.emitExit(null, signal ?? "SIGTERM");
    return true;
  });
  child.signalCode = null;
  child.emitExit = (code = null, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("exit", code, signal);
  };
  child.emitError = (error: Error) => {
    child.emit("error", error);
  };

  return child;
}

// --- helper from http-transport.test.ts ---

async function readLineCount(stream: Readable, count: number): Promise<string[]> {
  const lines: string[] = [];

  for await (const line of readLines(stream)) {
    lines.push(line);
    if (lines.length === count) {
      return lines;
    }
  }

  throw new Error(`Stream ended before reading ${count} line(s)`);
}

// --- helper from mcp-client.test.ts ---

const getMessageLayerOrThrow = (client: McpClient): JsonRpcMessageLayer =>
  (
    client as unknown as {
      getMessageLayerOrThrow: () => JsonRpcMessageLayer;
    }
  ).getMessageLayerOrThrow();

async function startClientHandshake(
  result: unknown,
  options: ConstructorParameters<typeof McpClient>[0] = {
    clientInfo: { name: "tiny-mcp-client", version: "0.1.0" },
  }
): Promise<{
  client: McpClient;
  readable: PassThrough;
  writable: PassThrough;
  iterator: AsyncIterator<string>;
  connectPromise: Promise<unknown>;
}> {
  const readable = new PassThrough();
  const writable = new PassThrough();
  const transport: McpTransport = {
    readable,
    writable,
    closed: new Promise(() => {}),
    dispose: vi.fn(),
  };
  const client = new McpClient(options);
  const connectPromise = client.connect(transport);
  const iterator = readLines(writable)[Symbol.asyncIterator]();
  const initializeLine = await iterator.next();
  if (initializeLine.done) {
    throw new Error("Expected initialize request line to be written");
  }
  const initializeRequest = JSON.parse(initializeLine.value) as { id: number };
  readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: initializeRequest.id, result })}\n`);

  return { client, readable, writable, iterator, connectPromise };
}

describe("HttpTransport constructor", () => {
  it("accepts url, headers, and injected fetch", () => {
    const mockFetch = async (): Promise<Response> => new Response(null, { status: 202 });
    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      headers: {
        Authorization: "Bearer token-123",
      },
      fetch: mockFetch,
    });

    const asTransport: McpTransport = transport;

    expect(asTransport).toBe(transport);
    expect(typeof transport.writable.write).toBe("function");
    expect(typeof transport.readable.read).toBe("function");

    transport.dispose();
  });

  it("resolves closed when disposed", async () => {
    const transport = new HttpTransport({
      url: "https://example.com/mcp",
    });

    transport.dispose();

    await expect(transport.closed).resolves.toMatchObject({
      reason: expect.any(Error),
    });
  });

  it("does not throw when dispose is called twice", () => {
    const transport = new HttpTransport({
      url: "https://example.com/mcp",
    });

    expect(() => {
      transport.dispose();
      transport.dispose();
    }).not.toThrow();
  });

  it("sends each written line as a POST request with JSON headers", async () => {
    const firstBody = '{"jsonrpc":"2.0","id":1,"method":"ping"}';
    const secondBody = '{"jsonrpc":"2.0","id":2,"method":"ping"}';
    const mockFetch = vi.fn(async (): Promise<Response> => new Response(null, { status: 202 }));

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      headers: {
        Authorization: "Bearer token-123",
      },
      fetch: mockFetch,
    });

    transport.writable.write(`${firstBody}\n`);
    transport.writable.write(`${secondBody}\n`);
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    const [url, init] = mockFetch.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe("https://example.com/mcp");
    expect(init?.method).toBe("POST");
    expect(headers.get("accept")).toBe("application/json, text/event-stream");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer token-123");
    expect(init?.body).toBe(firstBody);
    expect(mockFetch.mock.calls[1]?.[1]?.body).toBe(secondBody);

    transport.dispose();
  });

  it("captures session ID from initialize response and sends it on subsequent requests", async () => {
    const mockFetch = vi
      .fn(async (): Promise<Response> => new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        new Response('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "session-abc",
          },
        })
      )
      .mockResolvedValue(
        new Response('{"jsonrpc":"2.0","id":2,"result":{"ok":true}}', {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        })
      );

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    transport.writable.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    const postCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(2);

    const firstRequestHeaders = new Headers(postCalls[0]?.[1]?.headers);
    const secondRequestHeaders = new Headers(postCalls[1]?.[1]?.headers);

    expect(firstRequestHeaders.get("mcp-session-id")).toBeNull();
    expect(secondRequestHeaders.get("mcp-session-id")).toBe("session-abc");

    transport.dispose();
  });

  it("closes transport when a session-scoped POST request returns 404", async () => {
    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        return new Response(null, { status: 405 });
      }

      const headers = new Headers(init?.headers);
      if (headers.get("mcp-session-id") === null) {
        return new Response('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "session-expiring",
          },
        });
      }

      return new Response(null, { status: 404 });
    });

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    transport.writable.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');

    const closedEvent = await transport.closed;
    expect(closedEvent.reason.message).toContain("session");
    expect(closedEvent.reason.message).toContain("404");

    const postCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === "POST");
    const secondPostHeaders = new Headers(postCalls[1]?.[1]?.headers);
    expect(secondPostHeaders.get("mcp-session-id")).toBe("session-expiring");
  });

  it("closes transport with transport error when POST fetch fails due to network error", async () => {
    const mockFetch = vi.fn(async (): Promise<Response> => {
      throw new Error("network failure");
    });

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

    const closedEvent = await transport.closed;
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(closedEvent.reason.message).toContain("network failure");
  });

  it("closes transport with HTTP 400 error including response body", async () => {
    const mockFetch = vi.fn(
      async (): Promise<Response> =>
        new Response('{"error":"invalid request body"}', {
          status: 400,
          statusText: "Bad Request",
          headers: {
            "Content-Type": "application/json",
          },
        })
    );

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

    const closedEvent = await transport.closed;
    expect(closedEvent.reason.message).toContain("400");
    expect(closedEvent.reason.message).toContain("Bad Request");
    expect(closedEvent.reason.message).toContain("invalid request body");
  });

  it("closes transport with transport error when POST returns HTTP 500", async () => {
    const mockFetch = vi.fn(
      async (): Promise<Response> =>
        new Response("server exploded", {
          status: 500,
          statusText: "Internal Server Error",
          headers: {
            "Content-Type": "text/plain",
          },
        })
    );

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

    const closedEvent = await transport.closed;
    expect(closedEvent.reason.message).toContain("500");
    expect(closedEvent.reason.message).toContain("Internal Server Error");
  });

  it("does not push readable messages when notification POST returns 202 with no body", async () => {
    const mockFetch = vi.fn(async (): Promise<Response> => new Response(null, { status: 202 }));
    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    expect(transport.readable.read()).toBeNull();

    transport.dispose();
  });

  it("parses SSE response data fields and pushes JSON-RPC lines to readable", async () => {
    const mockFetch = vi.fn(
      async (): Promise<Response> =>
        new Response(
          [
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n',
            'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/ping"}\n\n',
          ].join(""),
          {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
            },
          }
        )
    );

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

    await expect(readLineCount(transport.readable, 2)).resolves.toEqual([
      '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
      '{"jsonrpc":"2.0","method":"notifications/ping"}',
    ]);

    transport.dispose();
  });

  it("pushes JSON response body as a single line to readable", async () => {
    const responseBody = '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}';
    const mockFetch = vi.fn(
      async (): Promise<Response> =>
        new Response(responseBody, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        })
    );

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

    await expect(readLineCount(transport.readable, 1)).resolves.toEqual([responseBody]);

    transport.dispose();
  });

  it("opens GET stream with SSE accept header after session initialization", async () => {
    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        return new Response('data: {"jsonrpc":"2.0","method":"notifications/ping"}\n\n', {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
          },
        });
      }

      return new Response(null, {
        status: 200,
        headers: {
          "Mcp-Session-Id": "session-from-initialize",
        },
      });
    });

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    const getRequest = mockFetch.mock.calls.find(([, init]) => init?.method === "GET");
    const getHeaders = new Headers(getRequest?.[1]?.headers);

    expect(getHeaders.get("accept")).toBe("text/event-stream");
    expect(getHeaders.get("mcp-session-id")).toBe("session-from-initialize");
    await expect(readLineCount(transport.readable, 1)).resolves.toEqual([
      '{"jsonrpc":"2.0","method":"notifications/ping"}',
    ]);

    transport.dispose();
  });

  it("tracks SSE event IDs and sends Last-Event-ID on GET reconnect", async () => {
    let getRequests = 0;
    const encoder = new TextEncoder();
    let firstGetController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        getRequests += 1;

        if (getRequests === 1) {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                firstGetController = controller;
                controller.enqueue(
                  encoder.encode(
                    'event: message\nid: evt-1\ndata: {"jsonrpc":"2.0","method":"notifications/ping"}\n\n'
                  )
                );
              },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
              },
            },
          );
        }

        return new Response(null, { status: 405 });
      }

      return new Response(null, {
        status: 202,
        headers: {
          "Mcp-Session-Id": "session-resume-1",
        },
      });
    });

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');

    await expect(readLineCount(transport.readable, 1)).resolves.toEqual([
      '{"jsonrpc":"2.0","method":"notifications/ping"}',
    ]);

    firstGetController?.close();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    transport.writable.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');

    await vi.waitFor(() => {
      expect(getRequests).toBe(2);
    });

    const getCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === "GET");
    const firstGetHeaders = new Headers(getCalls[0]?.[1]?.headers);
    const secondGetHeaders = new Headers(getCalls[1]?.[1]?.headers);

    expect(firstGetHeaders.get("last-event-id")).toBeNull();
    expect(secondGetHeaders.get("last-event-id")).toBe("evt-1");

    transport.dispose();
  });

  it("handles GET stream 405 responses without failing transport", async () => {
    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        return new Response(null, { status: 405 });
      }

      return new Response(null, {
        status: 202,
        headers: {
          "Mcp-Session-Id": "session-no-get-support",
        },
      });
    });

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    transport.writable.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    expect(mockFetch.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(mockFetch.mock.calls[1]?.[1]?.method).toBe("GET");
    expect(mockFetch.mock.calls[2]?.[1]?.method).toBe("POST");

    transport.dispose();
  });

  it("closes when the GET event stream reports an expired session", async () => {
    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        return new Response(null, { status: 404 });
      }

      return new Response(null, { status: 202, headers: { "Mcp-Session-Id": "expired-session" } });
    });
    const transport = new HttpTransport({ url: "https://example.com/mcp", fetch: mockFetch });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');

    await expect(transport.closed).resolves.toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining("session expired") }),
    });
  });

  it("closes when the GET event stream returns a server error", async () => {
    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        return new Response("event stream failed", { status: 500 });
      }

      return new Response(null, { status: 202, headers: { "Mcp-Session-Id": "broken-events" } });
    });
    const transport = new HttpTransport({ url: "https://example.com/mcp", fetch: mockFetch });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');

    await expect(transport.closed).resolves.toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining("GET failed") }),
    });
  });

  it("sends DELETE with session ID when disposed after initialization", async () => {
    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        return new Response(null, { status: 405 });
      }

      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response(null, {
        status: 202,
        headers: {
          "Mcp-Session-Id": "session-close-delete",
        },
      });
    });

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    transport.dispose();

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    const deleteRequest = mockFetch.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(deleteRequest).toBeDefined();
    expect(deleteRequest?.[0]).toBe("https://example.com/mcp");

    const deleteHeaders = new Headers(deleteRequest?.[1]?.headers);
    expect(deleteHeaders.get("mcp-session-id")).toBe("session-close-delete");
  });

  it("handles DELETE 405 responses without failing close", async () => {
    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        return new Response(null, { status: 405 });
      }

      if (init?.method === "DELETE") {
        return new Response(null, { status: 405 });
      }

      return new Response(null, {
        status: 202,
        headers: {
          "Mcp-Session-Id": "session-delete-405",
        },
      });
    });

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    expect(() => {
      transport.dispose();
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  it("reports failure when DELETE session termination is rejected", async () => {
    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        return new Response(null, { status: 405 });
      }
      if (init?.method === "DELETE") {
        return new Response("cleanup refused", { status: 500 });
      }

      return new Response(null, { status: 202, headers: { "Mcp-Session-Id": "failed-delete" } });
    });
    const transport = new HttpTransport({ url: "https://example.com/mcp", fetch: mockFetch });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    transport.dispose();

    await expect(transport.closed).resolves.toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining("DELETE failed") }),
    });
  });

  it("rejects a changed session id returned mid-session", async () => {
    let postCount = 0;
    const requestSessions: Array<string | null> = [];
    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        return new Response(null, { status: 405 });
      }
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      requestSessions.push(new Headers(init?.headers).get("mcp-session-id"));
      postCount += 1;
      return new Response(null, {
        status: 202,
        headers: { "Mcp-Session-Id": postCount === 1 ? "session-original" : "session-replacement" },
      });
    });
    const transport = new HttpTransport({ url: "https://example.com/mcp", fetch: mockFetch });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    await vi.waitFor(() => expect(postCount).toBe(1));
    transport.writable.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');

    await expect(transport.closed).resolves.toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining("session ID") }),
    });
    expect(requestSessions).toEqual([null, "session-original"]);
  });

  it("closes on a successful unsupported HTTP representation", async () => {
    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: vi.fn(async () => new Response("not-json", { status: 200, headers: { "Content-Type": "text/plain" } })),
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

    await expect(transport.closed).resolves.toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining("unsupported response content type") }),
    });
  });

  it("does not block a subsequent POST behind an open SSE response", async () => {
    const encoder = new TextEncoder();
    let firstController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let postCount = 0;
    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: vi.fn(async (_input: string | URL, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return new Response(null, { status: 405 });
        }
        postCount += 1;
        if (postCount === 1) {
          return new Response(new ReadableStream({
            start(controller) {
              firstController = controller;
              controller.enqueue(encoder.encode('data: {"jsonrpc":"2.0","id":1,"result":"first"}\n\n'));
            },
          }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
        }
        return new Response('{"jsonrpc":"2.0","id":2,"result":"second"}', { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    });
    const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 100, transport.closed.then((event) => event.reason));

    await expect(layer.sendRequest("first")).resolves.toBe("first");
    await expect(layer.sendRequest("second")).resolves.toBe("second");
    expect(postCount).toBe(2);

    firstController?.close();
    layer.dispose();
    transport.dispose();
  });

  it("aborts in-flight POST fetch when disposed", async () => {
    let postSignal: AbortSignal | undefined;
    let postAborted = false;
    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        return new Response(null, { status: 405 });
      }

      return await new Promise<Response>((_resolve, reject) => {
        postSignal = init?.signal;
        const onAbort = () => {
          postAborted = true;
          reject(new Error("POST aborted"));
        };

        if (postSignal?.aborted === true) {
          onAbort();
          return;
        }

        postSignal?.addEventListener("abort", onAbort, { once: true });
      });
    });

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    transport.dispose();

    await vi.waitFor(() => {
      expect(postAborted).toBe(true);
    });
    expect(postSignal?.aborted).toBe(true);
    await expect(transport.closed).resolves.toMatchObject({
      reason: expect.any(Error),
    });
  });

  it("closes open GET SSE stream when disposed", async () => {
    const encoder = new TextEncoder();
    const cancelSpy = vi.fn();

    const openSseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"jsonrpc":"2.0","method":"notifications/ping"}\n\n')
        );
      },
      cancel() {
        cancelSpy();
      },
    });

    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === "GET") {
        return new Response(openSseStream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
          },
        });
      }

      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response(null, {
        status: 202,
        headers: {
          "Mcp-Session-Id": "session-open-sse",
        },
      });
    });

    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    transport.writable.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    transport.dispose();

    await vi.waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledTimes(1);
    });
    await expect(transport.closed).resolves.toMatchObject({
      reason: expect.any(Error),
    });
  });
});
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

  it("clears pending request state and timeout when a request is cancelled", async () => {
    vi.useFakeTimers();
    try {
      const input = new PassThrough();
      const output = new PassThrough();
      trackForCleanup(input, output);
      const layer = new JsonRpcMessageLayer(input, output, 25);
      const onTimeout = vi.fn();
      const pendingCount = () =>
        (
          layer as unknown as {
            pendingRequests: Map<unknown, unknown>;
          }
        ).pendingRequests.size;

      const responsePromise = layer.sendRequest("slow/method", undefined, {
        onTimeout,
      });
      expect(pendingCount()).toBe(1);

      expect(layer.cancelRequest(1, "user cancelled")).toBe(true);

      await expect(responsePromise).rejects.toBe("user cancelled");
      expect(pendingCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(25);

      expect(onTimeout).not.toHaveBeenCalled();
      expect(layer.cancelRequest(1, "already gone")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("JsonRpcMessageLayer UTF-8 input", () => {
  it("preserves parameters split across UTF-8 chunks", async () => {
    const output = new PassThrough();
    const message = Buffer.from(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "echo", params: { text: "🧪" } })}\n`,
      "utf8"
    );
    const markerStart = message.indexOf(Buffer.from("🧪", "utf8"));
    const input = Readable.from(
      (async function* () {
        yield message.subarray(0, markerStart + 2);
        await Promise.resolve();
        yield message.subarray(markerStart + 2);
      })()
    );
    trackForCleanup(output);
    const outputIterator = readLines(output)[Symbol.asyncIterator]();
    const layer = new JsonRpcMessageLayer(input, output);
    const handler = vi.fn((params: unknown) => ({ params }));
    layer.onRequest("echo", handler);

    const responseLine = await outputIterator.next();
    if (responseLine.done) {
      throw new Error("Expected JSON-RPC response line to be written");
    }

    expect(handler).toHaveBeenCalledWith({ text: "🧪" }, expect.anything());
    expect(JSON.parse(responseLine.value)).toMatchObject({ result: { params: { text: "🧪" } } });
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
describe("parseJsonRpcMessage", () => {
  it("parses a request with numeric id", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');

    expect(parsed).toEqual({
      type: "request",
      message: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      },
    });
  });

  it("parses a request with string id", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"request-1","method":"tools/list"}'
    );

    expect(parsed).toEqual({
      type: "request",
      message: {
        jsonrpc: "2.0",
        id: "request-1",
        method: "tools/list",
      },
    });
  });

  it("parses a request with params", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hello"}}}'
    );

    expect(parsed).toEqual({
      type: "request",
      message: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "echo",
          arguments: {
            text: "hello",
          },
        },
      },
    });
  });

  it("parses a request without params", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"request-2","method":"tools/list"}'
    );

    expect(parsed).toEqual({
      type: "request",
      message: {
        jsonrpc: "2.0",
        id: "request-2",
        method: "tools/list",
      },
    });
  });

  it("parses a notification with params", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"token-1","progress":0.5}}'
    );

    expect(parsed).toEqual({
      type: "notification",
      message: {
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: {
          progressToken: "token-1",
          progress: 0.5,
        },
      },
    });
  });

  it("parses a notification without params", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    );

    expect(parsed).toEqual({
      type: "notification",
      message: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
    });
  });

  it("parses a success response", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":"req-1","result":{}}');

    expect(parsed).toEqual({
      type: "response",
      message: {
        jsonrpc: "2.0",
        id: "req-1",
        result: {},
      },
    });
  });

  it("parses an error response with data", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"req-2","error":{"code":-32601,"message":"Method not found","data":{"method":"tools/missing"}}}'
    );

    expect(parsed).toEqual({
      type: "response",
      message: {
        jsonrpc: "2.0",
        id: "req-2",
        error: {
          code: -32601,
          message: "Method not found",
          data: {
            method: "tools/missing",
          },
        },
      },
    });
  });

  it("parses an error response without data", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"req-3","error":{"code":-32000,"message":"Boom"}}'
    );

    expect(parsed).toEqual({
      type: "response",
      message: {
        jsonrpc: "2.0",
        id: "req-3",
        error: {
          code: -32000,
          message: "Boom",
        },
      },
    });
  });

  it("returns parse error for malformed JSON", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_PARSE);
    expect(parsed.id).toBeNull();
  });

  it("returns invalid request for array payload", () => {
    const parsed = parseJsonRpcMessage("[]");

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBeNull();
  });

  it("returns invalid request for string payload", () => {
    const parsed = parseJsonRpcMessage('"not-an-object"');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBeNull();
  });

  it("returns invalid request when jsonrpc field is missing", () => {
    const parsed = parseJsonRpcMessage('{"id":1,"method":"tools/list"}');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe(1);
  });

  it("returns invalid request when jsonrpc field has wrong value", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"1.0","id":1,"method":"tools/list"}');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe(1);
  });

  it("returns invalid request when method is not a string", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"method":123}');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe(1);
  });

  it("returns invalid request for response containing both result and error", () => {
    const parsed = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":-32601,"message":"Method not found"}}'
    );

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe(1);
  });

  it("returns invalid request for response containing neither result nor error", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1}');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe(1);
  });

  it("returns invalid with error code and id metadata", () => {
    const parsed = parseJsonRpcMessage('{"jsonrpc":"2.0","id":"bad"}');

    expect(parsed.type).toBe("invalid");
    if (parsed.type !== "invalid") {
      throw new Error("expected invalid parse result");
    }

    expect(parsed.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(parsed.id).toBe("bad");
  });
});
describe("SseParser", () => {
  it("parses event: message with data payload", () => {
    const parser = new SseParser();

    const parsed = parser.push('event: message\ndata: {"jsonrpc":"2.0"}\n\n');

    expect(parsed).toEqual([
      {
        data: '{"jsonrpc":"2.0"}',
      },
    ]);
  });

  it("defaults missing event field to message", () => {
    const parser = new SseParser();

    const parsed = parser.push('data: {"jsonrpc":"2.0"}\n\n');

    expect(parsed).toEqual([
      {
        data: '{"jsonrpc":"2.0"}',
      },
    ]);
  });

  it("extracts data-only event correctly", () => {
    const parser = new SseParser();

    const parsed = parser.push("data: payload-only\n\n");

    expect(parsed).toEqual([
      {
        data: "payload-only",
      },
    ]);
  });

  it("parses two events in sequence independently", () => {
    const parser = new SseParser();

    const parsed = parser.push(
      "event: message\ndata: first\n\nevent: message\ndata: second\n\n"
    );

    expect(parsed).toEqual([
      {
        data: "first",
      },
      {
        data: "second",
      },
    ]);
  });

  it("handles empty lines between events", () => {
    const parser = new SseParser();

    const parsed = parser.push(
      "event: message\ndata: first\n\n\n\nevent: message\ndata: second\n\n"
    );

    expect(parsed).toEqual([
      {
        data: "first",
      },
      {
        data: "second",
      },
    ]);
  });

  it("concatenates multi-line data fields with newlines", () => {
    const parser = new SseParser();

    const parsed = parser.push("event: message\ndata: line-1\ndata: line-2\n\n");

    expect(parsed).toEqual([
      {
        data: "line-1\nline-2",
      },
    ]);
  });

  it("ignores comment lines", () => {
    const parser = new SseParser();

    const parsed = parser.push(": keepalive\nevent: message\ndata: pong\n\n");

    expect(parsed).toEqual([
      {
        data: "pong",
      },
    ]);
  });

  it("ignores non-message events", () => {
    const parser = new SseParser();

    const parsed = parser.push("event: ping\ndata: should-not-emit\n\n");

    expect(parsed).toEqual([]);
  });

  it("extracts lastEventId from event with id field", () => {
    const parser = new SseParser();

    const parsed = parser.push("event: message\nid: evt-1\ndata: payload\n\n");

    expect(parsed).toEqual([
      {
        data: "payload",
        id: "evt-1",
      },
    ]);
    expect(parser.lastEventId).toBe("evt-1");
  });

  it("handles event split across stream chunks", () => {
    const parser = new SseParser();

    expect(parser.push("event: messa")).toEqual([]);
    expect(parser.push("ge\ndata: {\"jsonrpc\":\"2.0\"}")).toEqual([]);
    expect(parser.push("\n\n")).toEqual([
      {
        data: '{"jsonrpc":"2.0"}',
      },
    ]);
  });
});
describe("StdioTransport constructor", () => {
  it("calls spawn with command and args", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);

    new StdioTransport({
      command: "tiny-stdio-mcp-test-server",
      args: ["--mode", "stdio"],
      spawn,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      "tiny-stdio-mcp-test-server",
      ["--mode", "stdio"],
      {
        cwd: undefined,
        env: undefined,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
  });

  it("passes cwd and env through to spawn", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const env: NodeJS.ProcessEnv = { MCP_TOKEN: "token-123" };

    new StdioTransport({
      command: "node",
      args: ["server.js"],
      cwd: "/tmp/mcp",
      env,
      spawn,
    });

    expect(spawn).toHaveBeenCalledWith("node", ["server.js"], {
      cwd: "/tmp/mcp",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  it("sets readable and writable to child stdout and stdin", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);

    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    expect(transport.readable).toBe(child.stdout);
    expect(transport.writable).toBe(child.stdin);
  });

  it("uses provided custom spawn function", () => {
    const child = createMockChildProcess();
    const customSpawn = vi.fn<StdioSpawn>(() => child);

    new StdioTransport({
      command: "custom-bin",
      spawn: customSpawn,
    });

    expect(customSpawn).toHaveBeenCalledTimes(1);
    expect(customSpawn).toHaveBeenCalledWith("custom-bin", [], {
      cwd: undefined,
      env: undefined,
      stdio: ["pipe", "pipe", "pipe"],
    });
  });
});

describe("StdioTransport stderr capture", () => {
  it("returns concatenated stderr chunks", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);

    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    child.stderr.write("first");
    child.stderr.write(" second");

    expect(transport.getStderrOutput()).toBe("first second");
  });

  it("preserves UTF-8 characters split across stderr chunks", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);

    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    const encoded = Buffer.from("é", "utf8");
    child.stderr.write(encoded.subarray(0, 1));
    child.stderr.write(encoded.subarray(1));

    expect(transport.getStderrOutput()).toBe("é");
  });

  it("caps stderr at 64KB keeping the tail", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);

    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    const chunk = "x".repeat(40_000);
    child.stderr.write(chunk);
    child.stderr.write(chunk);

    const output = transport.getStderrOutput();
    expect(output.length).toBe(65_536);
    expect(output).toBe((chunk + chunk).slice(-65_536));
  });
});

describe("StdioTransport closed promise", () => {
  it("resolves when the process exits with code 0", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    child.emitExit(0, null);

    const closed = await transport.closed;
    expect(closed.reason).toBeInstanceOf(Error);
    expect(closed.code).toBe(0);
    expect(closed.signal).toBeUndefined();
  });

  it("resolves with code 1 when the process crashes", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    child.emitExit(1, null);

    const closed = await transport.closed;
    expect(closed.reason).toBeInstanceOf(Error);
    expect(closed.reason.message).toBe("Stdio transport process exited");
    expect(closed.code).toBe(1);
    expect(closed.signal).toBeUndefined();
  });

  it("resolves with signal when the process exits from SIGTERM", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    child.emitExit(null, "SIGTERM");

    const closed = await transport.closed;
    expect(closed.reason).toBeInstanceOf(Error);
    expect(closed.code).toBeUndefined();
    expect(closed.signal).toBe("SIGTERM");
  });

  it("resolves with process error reason when process emits error", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });
    const processError = new Error("spawn failed");

    child.emitError(processError);

    const closed = await transport.closed;
    expect(closed.reason).toBe(processError);
    expect(closed.code).toBeUndefined();
    expect(closed.signal).toBeUndefined();
  });
});

describe("StdioTransport dispose", () => {
  it("ends stdin, sends SIGTERM, and resolves closed", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });
    const endSpy = vi.spyOn(child.stdin, "end");

    transport.dispose();

    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    const closed = await transport.closed;
    expect(closed.signal).toBe("SIGTERM");
  });

  it("does not throw when dispose is called twice", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });
    const endSpy = vi.spyOn(child.stdin, "end");

    expect(() => {
      transport.dispose();
      transport.dispose();
    }).not.toThrow();

    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});

describe("StdioTransport real process smoke test", () => {
  it("spawns tiny-stdio-mcp-test-server and round-trips initialize over stdio", async () => {
    const transport = new StdioTransport({
      command: process.execPath,
      args: [testServerCli, "serve", "word-of-the-day"],
    });

    try {
      transport.writable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: {
              name: "tiny-mcp-client-smoke-test",
              version: "0.0.0-test",
            },
          },
        })}\n`
      );

      const line = await readSingleLineWithTimeout(transport, 5000);
      const response = JSON.parse(line) as {
        jsonrpc: string;
        id: number;
        result: {
          protocolVersion: string;
          serverInfo: { name: string; version: string };
          capabilities: { tools: { listChanged: boolean } };
        };
      };

      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe(1);
      expect(response.result.protocolVersion).toBe("2025-03-26");
      expect(response.result.serverInfo).toEqual({
        name: "tiny-stdio-mcp-test-server",
        version: "0.1.0",
      });
      expect(response.result.capabilities.tools.listChanged).toBe(true);
    } finally {
      transport.dispose();
      const closed = await transport.closed;
      expect(closed.reason).toBeInstanceOf(Error);
      expect(closed.signal ?? closed.code).toBeDefined();
    }
  });
});
describe("McpClient constructor", () => {
  it("accepts required and optional options", () => {
    const onToolsChanged = vi.fn();
    const onResourcesChanged = vi.fn();
    const onResourceUpdated = vi.fn<(uri: string) => void>();
    const onPromptsChanged = vi.fn();
    const onLog = vi.fn();
    const onProgress = vi.fn();
    const onSamplingRequest = vi.fn(async () => ({
      model: "test-model",
      role: "assistant" as const,
      content: {
        type: "text" as const,
        text: "sample",
      },
      stopReason: "endTurn",
    }));
    const onRootsList = vi.fn(async () => [
      {
        uri: "file:///workspace",
        name: "workspace",
      },
    ]);

    const options: McpClientOptions = {
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      capabilities: {
        roots: {
          listChanged: true,
        },
      },
      onToolsChanged,
      onResourcesChanged,
      onResourceUpdated,
      onPromptsChanged,
      onLog,
      onProgress,
      onSamplingRequest,
      onRootsList,
    };

    const client = new McpClient(options);
    expect(client).toBeInstanceOf(McpClient);
  });

  it("starts in disconnected state", () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    expect(client.state).toBe("disconnected");
  });

  it("has null serverCapabilities before connect", () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    expect(client.serverCapabilities).toBeNull();
  });

  it("has null serverInfo before connect", () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    expect(client.serverInfo).toBeNull();
  });

  it("has undefined instructions before connect", () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    expect(client.instructions).toBeUndefined();
  });
});

describe("McpClient state guards", () => {
  it("throws when guarded client method is called before connect", () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    expect(() => getMessageLayerOrThrow(client)).toThrow("MCP client is disconnected");
  });

  it("throws when connect is called on an already-connected client", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const firstTransport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const firstConnectPromise = client.connect(firstTransport);
    const firstIterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await firstIterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await firstConnectPromise;

    const secondReadable = new PassThrough();
    const secondWritable = new PassThrough();
    const secondTransport: McpTransport = {
      readable: secondReadable,
      writable: secondWritable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    const secondHandshake = (async () => {
      const secondIterator = readLines(secondWritable)[Symbol.asyncIterator]();
      const secondInitializeLine = await secondIterator.next();
      if (secondInitializeLine.done) {
        return;
      }

      const secondRequest = JSON.parse(secondInitializeLine.value) as { id: number };
      secondReadable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: secondRequest.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: {
              name: "server",
              version: "1.0.0",
            },
          },
        })}\n`
      );
    })();

    await expect(client.connect(secondTransport)).rejects.toThrow("MCP client is already connected");

    secondWritable.end();
    secondReadable.end();
    await secondHandshake;
    await client.close();
  });

  it("throws when guarded client method is called after close", async () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    await client.close();

    expect(() => getMessageLayerOrThrow(client)).toThrow("MCP client is closed");
  });
});

describe("McpClient connect", () => {
  it("releases a transport after a rejected initialize response", async () => {
    const firstReadable = new PassThrough();
    const firstWritable = new PassThrough();
    const firstTransport: McpTransport = {
      readable: firstReadable,
      writable: firstWritable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: { name: "tiny-mcp-client", version: "0.1.0" },
    });

    const firstConnect = client.connect(firstTransport);
    const firstIterator = readLines(firstWritable)[Symbol.asyncIterator]();
    const firstInitializeLine = await firstIterator.next();
    if (firstInitializeLine.done) {
      throw new Error("Expected initialize request line to be written");
    }
    const firstInitialize = JSON.parse(firstInitializeLine.value) as { id: number };
    firstReadable.write(`${JSON.stringify({ jsonrpc: "2.0", id: firstInitialize.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "bad", version: "1" } } })}\n`);

    await expect(firstConnect).rejects.toThrow("Unsupported protocol version: 2024-11-05");
    expect(firstTransport.dispose).toHaveBeenCalledTimes(1);
    expect(client.state).toBe("disconnected");

    const secondReadable = new PassThrough();
    const secondWritable = new PassThrough();
    const secondConnect = client.connect({
      readable: secondReadable,
      writable: secondWritable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    });
    const secondIterator = readLines(secondWritable)[Symbol.asyncIterator]();
    const secondInitializeLine = await secondIterator.next();
    if (secondInitializeLine.done) {
      throw new Error("Expected replacement initialize request line to be written");
    }
    const secondInitialize = JSON.parse(secondInitializeLine.value) as { id: number };
    secondReadable.write(`${JSON.stringify({ jsonrpc: "2.0", id: secondInitialize.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "good", version: "1" } } })}\n`);
    await expect(secondConnect).resolves.toBeDefined();
    await client.close();
  });

  it("registers notification handlers for all supported server notifications", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });
    const onNotificationSpy = vi.spyOn(JsonRpcMessageLayer.prototype, "onNotification");

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();

    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as { id?: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const registeredMethods = onNotificationSpy.mock.calls.map(([method]) => method);
    expect(registeredMethods).toEqual([
      "notifications/tools/list_changed",
      "notifications/resources/list_changed",
      "notifications/resources/updated",
      "notifications/prompts/list_changed",
      "notifications/message",
      "notifications/progress",
      "notifications/cancelled",
    ]);
  });

  it("registers request handlers for ping and configured optional server requests", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onSamplingRequest: vi.fn(async () => ({
        model: "mock-model",
        role: "assistant",
        content: {
          type: "text",
          text: "mock sample",
        },
        stopReason: "endTurn",
      })),
      onRootsList: vi.fn(async () => [
        {
          uri: "file:///workspace",
          name: "workspace",
        },
      ]),
    });
    const onRequestSpy = vi.spyOn(JsonRpcMessageLayer.prototype, "onRequest");
    onRequestSpy.mockClear();

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();

    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as { id?: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const registeredMethods = onRequestSpy.mock.calls.map(([method]) => method);
    expect(registeredMethods).toEqual(["ping", "sampling/createMessage", "roots/list"]);
  });

  it("handles sampling/createMessage with modelPreferences, systemPrompt, and maxTokens", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const samplingResponse: CreateMessageResult = {
      model: "mock-model",
      role: "assistant",
      content: {
        type: "text",
        text: "Sampled reply.",
      },
      stopReason: "endTurn",
    };
    const onSamplingRequest = vi.fn(
      async (_params: CreateMessageParams): Promise<CreateMessageResult> => samplingResponse
    );
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onSamplingRequest,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const samplingRequestParams: CreateMessageParams = {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Say hello.",
          },
        },
      ],
      modelPreferences: {
        hints: [{ name: "mock-model" }],
        costPriority: 0.2,
        speedPriority: 0.4,
        intelligencePriority: 0.9,
      },
      systemPrompt: "Be concise.",
      includeContext: "thisServer",
      temperature: 0.1,
      maxTokens: 128,
      stopSequences: ["\n\n"],
      metadata: {
        requestId: "sample-1",
      },
    };
    const samplingRequestId = 779;
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: samplingRequestId,
        method: "sampling/createMessage",
        params: samplingRequestParams,
      })}\n`
    );

    const samplingResponseLineResult = await iterator.next();
    if (samplingResponseLineResult.done) {
      throw new Error("Expected sampling/createMessage response line to be written");
    }

    expect(onSamplingRequest).toHaveBeenCalledTimes(1);
    expect(onSamplingRequest.mock.calls[0]?.[0]).toMatchObject({
      modelPreferences: samplingRequestParams.modelPreferences,
      systemPrompt: samplingRequestParams.systemPrompt,
      maxTokens: samplingRequestParams.maxTokens,
    });
    expect(onSamplingRequest).toHaveBeenCalledWith(samplingRequestParams);
    expect(JSON.parse(samplingResponseLineResult.value)).toEqual({
      jsonrpc: "2.0",
      id: samplingRequestId,
      result: samplingResponse,
    });

    await client.close();
  });

  it("does not respond to sampling/createMessage after server sends notifications/cancelled", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const onSamplingRequest = vi.fn(
      async (): Promise<CreateMessageResult> =>
        await new Promise<CreateMessageResult>((resolve) => {
          setTimeout(() => {
            resolve({
              model: "mock-model",
              role: "assistant",
              content: {
                type: "text",
                text: "late sampled reply",
              },
              stopReason: "endTurn",
            });
          }, 20);
        })
    );
    const writeSpy = vi.spyOn(writable, "write");
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onSamplingRequest,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const samplingRequestId = 781;
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: samplingRequestId,
        method: "sampling/createMessage",
        params: {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "Please sample.",
              },
            },
          ],
          maxTokens: 16,
        },
      })}\n`
    );
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: {
          requestId: samplingRequestId,
          reason: "server no longer needs this result",
        },
      })}\n`
    );

    await vi.waitFor(
      () => {
        expect(onSamplingRequest).toHaveBeenCalledTimes(1);
        expect(writeSpy).toHaveBeenCalledTimes(2);
      },
      {
        timeout: 100,
      }
    );

    await client.close();
  });

  it("returns method-not-found when server sends sampling/createMessage and no sampling handler is set", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const samplingRequestId = 780;
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: samplingRequestId,
        method: "sampling/createMessage",
        params: {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "Test request",
              },
            },
          ],
          maxTokens: 16,
        },
      })}\n`
    );

    const samplingResponseLineResult = await iterator.next();
    if (samplingResponseLineResult.done) {
      throw new Error("Expected sampling/createMessage response line to be written");
    }

    expect(JSON.parse(samplingResponseLineResult.value)).toEqual({
      jsonrpc: "2.0",
      id: samplingRequestId,
      error: {
        code: ERROR_METHOD_NOT_FOUND,
        message: "Method not found: sampling/createMessage",
      },
    });

    await client.close();
  });

  it("calls onRootsList and returns roots when server sends roots/list request", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const roots = [
      {
        uri: "file:///workspace",
        name: "workspace",
      },
      {
        uri: "file:///workspace/docs",
      },
    ];
    const onRootsList = vi.fn(async () => roots);
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onRootsList,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const rootsListRequestId = 777;
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: rootsListRequestId,
        method: "roots/list",
      })}\n`
    );

    const rootsListResponseLineResult = await iterator.next();
    if (rootsListResponseLineResult.done) {
      throw new Error("Expected roots/list response line to be written");
    }

    const rootsListResponse = JSON.parse(rootsListResponseLineResult.value) as unknown;
    expect(onRootsList).toHaveBeenCalledTimes(1);
    expect(rootsListResponse).toEqual({
      jsonrpc: "2.0",
      id: rootsListRequestId,
      result: {
        roots,
      },
    });

    await client.close();
  });

  it("does not disclose roots before initialization completes", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const onRootsList = vi.fn(async () => [{ uri: "file:///secret", name: "secret" }]);
    const client = new McpClient({
      clientInfo: { name: "tiny-mcp-client", version: "0.1.0" },
      onRootsList,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    await iterator.next();
    readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: 779, method: "roots/list" })}\n`);

    const responseLine = await iterator.next();
    if (responseLine.done) {
      throw new Error("Expected roots/list rejection line to be written");
    }
    expect(JSON.parse(responseLine.value)).toEqual({
      jsonrpc: "2.0",
      id: 779,
      error: {
        code: ERROR_METHOD_NOT_FOUND,
        message: "Method not found: roots/list",
      },
    });
    expect(onRootsList).not.toHaveBeenCalled();

    await client.close();
    await expect(connectPromise).rejects.toThrow("MCP client closed");
  });

  it("returns method-not-found when server sends roots/list and no roots handler is set", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const rootsListRequestId = 778;
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: rootsListRequestId,
        method: "roots/list",
      })}\n`
    );

    const rootsListResponseLineResult = await iterator.next();
    if (rootsListResponseLineResult.done) {
      throw new Error("Expected roots/list response line to be written");
    }

    expect(JSON.parse(rootsListResponseLineResult.value)).toEqual({
      jsonrpc: "2.0",
      id: rootsListRequestId,
      error: {
        code: ERROR_METHOD_NOT_FOUND,
        message: "Method not found: roots/list",
      },
    });

    await client.close();
  });

  it("ignores tools/list_changed when the server did not advertise changes", async () => {
    const onToolsChanged = vi.fn();
    const { client, readable, iterator, connectPromise } = await startClientHandshake(
      {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "server", version: "1.0.0" },
      },
      { clientInfo: { name: "tiny-mcp-client", version: "0.1.0" }, onToolsChanged }
    );
    await connectPromise;
    await iterator.next();

    readable.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onToolsChanged).not.toHaveBeenCalled();
    await client.close();
  });

  it("calls onToolsChanged when server sends tools/list_changed notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveToolsChanged: (() => void) | null = null;
    const toolsChangedPromise = new Promise<void>((resolve) => {
      resolveToolsChanged = resolve;
    });
    const onToolsChanged = vi.fn(() => {
      if (resolveToolsChanged !== null) {
        resolveToolsChanged();
        resolveToolsChanged = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onToolsChanged,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: { listChanged: true } },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      })}\n`
    );

    await toolsChangedPromise;

    expect(onToolsChanged).toHaveBeenCalledTimes(1);

    await client.close();
  });

  it("calls onResourcesChanged when server sends resources/list_changed notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveResourcesChanged: (() => void) | null = null;
    const resourcesChangedPromise = new Promise<void>((resolve) => {
      resolveResourcesChanged = resolve;
    });
    const onResourcesChanged = vi.fn(() => {
      if (resolveResourcesChanged !== null) {
        resolveResourcesChanged();
        resolveResourcesChanged = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onResourcesChanged,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { resources: { listChanged: true } },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/resources/list_changed",
      })}\n`
    );

    await resourcesChangedPromise;

    expect(onResourcesChanged).toHaveBeenCalledTimes(1);

    await client.close();
  });

  it("ignores resources/list_changed when server did not advertise listChanged", async () => {
    const onResourcesChanged = vi.fn();
    const { client, readable, iterator, connectPromise } = await startClientHandshake(
      {
        protocolVersion: "2025-03-26",
        capabilities: { resources: {} },
        serverInfo: { name: "server", version: "1.0.0" },
      },
      {
        clientInfo: {
          name: "tiny-mcp-client",
          version: "0.1.0",
        },
        onResourcesChanged,
      }
    );
    await connectPromise;
    await iterator.next();

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/resources/list_changed",
      })}\n`
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(onResourcesChanged).toHaveBeenCalledTimes(0);

    await client.close();
  });

  it("calls onPromptsChanged when server sends prompts/list_changed notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolvePromptsChanged: (() => void) | null = null;
    const promptsChangedPromise = new Promise<void>((resolve) => {
      resolvePromptsChanged = resolve;
    });
    const onPromptsChanged = vi.fn(() => {
      if (resolvePromptsChanged !== null) {
        resolvePromptsChanged();
        resolvePromptsChanged = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onPromptsChanged,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { prompts: { listChanged: true } },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/prompts/list_changed",
      })}\n`
    );

    await promptsChangedPromise;

    expect(onPromptsChanged).toHaveBeenCalledTimes(1);

    await client.close();
  });

  it("ignores prompts/list_changed when server did not advertise listChanged", async () => {
    const onPromptsChanged = vi.fn();
    const { client, readable, iterator, connectPromise } = await startClientHandshake(
      {
        protocolVersion: "2025-03-26",
        capabilities: { prompts: {} },
        serverInfo: { name: "server", version: "1.0.0" },
      },
      {
        clientInfo: {
          name: "tiny-mcp-client",
          version: "0.1.0",
        },
        onPromptsChanged,
      }
    );
    await connectPromise;
    await iterator.next();

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/prompts/list_changed",
      })}\n`
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(onPromptsChanged).toHaveBeenCalledTimes(0);

    await client.close();
  });

  it("calls onResourceUpdated with uri when server sends resources/updated notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveResourceUpdated: (() => void) | null = null;
    const resourceUpdatedPromise = new Promise<void>((resolve) => {
      resolveResourceUpdated = resolve;
    });
    const onResourceUpdated = vi.fn((_uri: string) => {
      if (resolveResourceUpdated !== null) {
        resolveResourceUpdated();
        resolveResourceUpdated = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onResourceUpdated,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { resources: { subscribe: true } },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const updatedUri = "file:///workspace/notes.txt";
    const subscribePromise = client.subscribe(updatedUri);
    const subscribeLine = await iterator.next();
    if (subscribeLine.done) {
      throw new Error("Expected resources/subscribe request line to be written");
    }
    const subscribeRequest = JSON.parse(subscribeLine.value) as { id: number };
    readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: subscribeRequest.id, result: {} })}\n`);
    await subscribePromise;

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/resources/updated",
        params: {
          uri: updatedUri,
        },
      })}\n`
    );

    await resourceUpdatedPromise;

    expect(onResourceUpdated).toHaveBeenCalledTimes(1);
    expect(onResourceUpdated).toHaveBeenCalledWith(updatedUri);

    await client.close();
  });

  it("ignores resource updates for unsubscribed uris", async () => {
    const onResourceUpdated = vi.fn();
    const { client, readable, iterator, connectPromise } = await startClientHandshake(
      {
        protocolVersion: "2025-03-26",
        capabilities: { resources: { subscribe: true } },
        serverInfo: { name: "server", version: "1.0.0" },
      },
      { clientInfo: { name: "tiny-mcp-client", version: "0.1.0" }, onResourceUpdated }
    );
    await connectPromise;
    await iterator.next();

    readable.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri: "file:///unsubscribed.txt" } })}\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onResourceUpdated).not.toHaveBeenCalled();
    await client.close();
  });

  it("calls onProgress with total, progress, and message when server sends progress notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveProgressNotification: ((params: ProgressParams) => void) | null = null;
    const progressNotificationPromise = new Promise<ProgressParams>((resolve) => {
      resolveProgressNotification = resolve;
    });
    const onProgress = vi.fn((params: ProgressParams) => {
      if (resolveProgressNotification !== null) {
        resolveProgressNotification(params);
        resolveProgressNotification = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onProgress,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const expectedProgress: ProgressParams = {
      progressToken: "call-1",
      progress: 50,
      total: 100,
      message: "Halfway there",
    };
    const callToolPromise = client.callTool({ name: "work" }, { progressToken: expectedProgress.progressToken });
    const callToolLine = await iterator.next();
    if (callToolLine.done) {
      throw new Error("Expected tools/call request line to be written");
    }
    const callToolRequest = JSON.parse(callToolLine.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: expectedProgress,
      })}\n`
    );

    await expect(progressNotificationPromise).resolves.toEqual(expectedProgress);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(expectedProgress);

    readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: callToolRequest.id, result: { content: [] } })}\n`);
    await callToolPromise;

    await client.close();
  });

  it("calls onProgress when progress notification omits optional total", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveProgressNotification: ((params: ProgressParams) => void) | null = null;
    const progressNotificationPromise = new Promise<ProgressParams>((resolve) => {
      resolveProgressNotification = resolve;
    });
    const onProgress = vi.fn((params: ProgressParams) => {
      if (resolveProgressNotification !== null) {
        resolveProgressNotification(params);
        resolveProgressNotification = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onProgress,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const expectedProgress: ProgressParams = {
      progressToken: "call-2",
      progress: 25,
      message: "Started processing",
    };
    const callToolPromise = client.callTool({ name: "work" }, { progressToken: expectedProgress.progressToken });
    const callToolLine = await iterator.next();
    if (callToolLine.done) {
      throw new Error("Expected tools/call request line to be written");
    }
    const callToolRequest = JSON.parse(callToolLine.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: expectedProgress,
      })}\n`
    );

    await expect(progressNotificationPromise).resolves.toEqual(expectedProgress);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(expectedProgress);

    readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: callToolRequest.id, result: { content: [] } })}\n`);
    await callToolPromise;

    await client.close();
  });

  it("calls onProgress for multiple progress notifications in sequence", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    const expectedProgressUpdates: ProgressParams[] = [
      {
        progressToken: "call-3",
        progress: 10,
        total: 100,
        message: "Queued",
      },
      {
        progressToken: "call-3",
        progress: 50,
        total: 100,
        message: "Halfway there",
      },
      {
        progressToken: "call-3",
        progress: 100,
        total: 100,
        message: "Completed",
      },
    ];
    const receivedProgressUpdates: ProgressParams[] = [];
    let resolveProgressNotifications: ((params: ProgressParams[]) => void) | null = null;
    const progressNotificationsPromise = new Promise<ProgressParams[]>((resolve) => {
      resolveProgressNotifications = resolve;
    });
    const onProgress = vi.fn((params: ProgressParams) => {
      receivedProgressUpdates.push(params);
      if (
        resolveProgressNotifications !== null &&
        receivedProgressUpdates.length === expectedProgressUpdates.length
      ) {
        resolveProgressNotifications([...receivedProgressUpdates]);
        resolveProgressNotifications = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onProgress,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const callToolPromise = client.callTool({ name: "work" }, { progressToken: "call-3" });
    const callToolLine = await iterator.next();
    if (callToolLine.done) {
      throw new Error("Expected tools/call request line to be written");
    }
    const callToolRequest = JSON.parse(callToolLine.value) as { id: number };

    for (const progressUpdate of expectedProgressUpdates) {
      readable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: progressUpdate,
        })}\n`
      );
    }

    await expect(progressNotificationsPromise).resolves.toEqual(expectedProgressUpdates);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, expectedProgressUpdates[0]);
    expect(onProgress).toHaveBeenNthCalledWith(2, expectedProgressUpdates[1]);
    expect(onProgress).toHaveBeenNthCalledWith(3, expectedProgressUpdates[2]);

    readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: callToolRequest.id, result: { content: [] } })}\n`);
    await callToolPromise;

    await client.close();
  });

  it("ignores progress notifications for an unknown token", async () => {
    const onProgress = vi.fn();
    const { client, readable, iterator, connectPromise } = await startClientHandshake(
      {
        protocolVersion: "2025-03-26",
        capabilities: {},
        serverInfo: { name: "server", version: "1.0.0" },
      },
      { clientInfo: { name: "tiny-mcp-client", version: "0.1.0" }, onProgress }
    );
    await connectPromise;
    await iterator.next();

    readable.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: "unknown", progress: 50 } })}\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onProgress).not.toHaveBeenCalled();
    await client.close();
  });

  it("ignores progress notifications when onProgress callback is not configured", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: {
          progressToken: "call-without-callback",
          progress: 10,
          total: 100,
          message: "Queued",
        },
      })}\n`
    );

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(client.state).toBe("ready");

    await client.close();
  });

  it("calls onLog with debug level when server sends message notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveLogMessage: ((message: { level: string; data: unknown; logger?: string }) => void) | null =
      null;
    const logMessagePromise = new Promise<{ level: string; data: unknown; logger?: string }>(
      (resolve) => {
        resolveLogMessage = resolve;
      }
    );
    const onLog = vi.fn((message: { level: string; data: unknown; logger?: string }) => {
      if (resolveLogMessage !== null) {
        resolveLogMessage(message);
        resolveLogMessage = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onLog,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            logging: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const expectedMessage = {
      level: "debug",
      data: {
        message: "Debug message",
      },
    };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: expectedMessage,
      })}\n`
    );

    await expect(logMessagePromise).resolves.toEqual(expectedMessage);
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith(expectedMessage);

    await client.close();
  });

  it("calls onLog for all syslog levels when server sends message notifications", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    const expectedMessages = [
      {
        level: "debug",
        data: { message: "Debug message" },
      },
      {
        level: "info",
        data: { message: "Info message" },
      },
      {
        level: "notice",
        data: { message: "Notice message" },
      },
      {
        level: "warning",
        data: { message: "Warning message" },
      },
      {
        level: "error",
        data: { message: "Error message" },
      },
      {
        level: "critical",
        data: { message: "Critical message" },
      },
      {
        level: "alert",
        data: { message: "Alert message" },
      },
      {
        level: "emergency",
        data: { message: "Emergency message" },
      },
    ] as const;
    const receivedMessages: Array<{ level: string; data: unknown; logger?: string }> = [];
    let resolveAllLogs: (() => void) | null = null;
    const allLogsPromise = new Promise<void>((resolve) => {
      resolveAllLogs = resolve;
    });
    const onLog = vi.fn((message: { level: string; data: unknown; logger?: string }) => {
      receivedMessages.push(message);

      if (resolveAllLogs !== null && receivedMessages.length === expectedMessages.length) {
        resolveAllLogs();
        resolveAllLogs = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onLog,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            logging: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    for (const expectedMessage of expectedMessages) {
      readable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/message",
          params: expectedMessage,
        })}\n`
      );
    }

    await allLogsPromise;
    expect(onLog).toHaveBeenCalledTimes(expectedMessages.length);
    expect(receivedMessages).toEqual(expectedMessages);

    await client.close();
  });

  it("calls onLog with logger and structured error data when server sends message notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveLogMessage: ((message: { level: string; data: unknown; logger?: string }) => void) | null =
      null;
    const logMessagePromise = new Promise<{ level: string; data: unknown; logger?: string }>(
      (resolve) => {
        resolveLogMessage = resolve;
      }
    );
    const onLog = vi.fn((message: { level: string; data: unknown; logger?: string }) => {
      if (resolveLogMessage !== null) {
        resolveLogMessage(message);
        resolveLogMessage = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onLog,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            logging: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const expectedMessage = {
      level: "error",
      logger: "mock-logging-server",
      data: {
        code: "E_TOOL",
        retryable: false,
        context: {
          toolName: "emit_logs",
        },
      },
    };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: expectedMessage,
      })}\n`
    );

    await expect(logMessagePromise).resolves.toEqual(expectedMessage);
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith(expectedMessage);

    await client.close();
  });

  it("registers only ping request handler when optional request handlers are not configured", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });
    const onRequestSpy = vi.spyOn(JsonRpcMessageLayer.prototype, "onRequest");
    onRequestSpy.mockClear();

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();

    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as { id?: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const registeredMethods = onRequestSpy.mock.calls.map(([method]) => method);
    expect(registeredMethods).toEqual(["ping"]);
  });

  it("advertises sampling capability when onSamplingRequest is provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onSamplingRequest: vi.fn(async () => ({
        model: "mock-model",
        role: "assistant",
        content: {
          type: "text",
          text: "mock sample",
        },
        stopReason: "endTurn",
      })),
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: unknown };
    };
    expect(request.params.capabilities).toEqual({
      sampling: {},
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("does not advertise sampling capability when onSamplingRequest is not provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onRootsList: vi.fn(async () => [
        {
          uri: "file:///workspace",
          name: "workspace",
        },
      ]),
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: Record<string, unknown> };
    };
    expect(request.params.capabilities).not.toHaveProperty("sampling");

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("advertises roots capability when onRootsList is provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onRootsList: vi.fn(async () => [
        {
          uri: "file:///workspace",
          name: "workspace",
        },
      ]),
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: unknown };
    };
    expect(request.params.capabilities).toEqual({
      roots: {},
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("does not advertise roots capability when onRootsList is not provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onSamplingRequest: vi.fn(async () => ({
        model: "mock-model",
        role: "assistant",
        content: {
          type: "text",
          text: "mock sample",
        },
        stopReason: "endTurn",
      })),
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: Record<string, unknown> };
    };
    expect(request.params.capabilities).toEqual({
      sampling: {},
    });
    expect(request.params.capabilities).not.toHaveProperty("roots");

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("advertises roots.listChanged when onRootsList is provided and listChanged is true", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      capabilities: {
        roots: {
          listChanged: true,
        },
      },
      onRootsList: vi.fn(async () => [
        {
          uri: "file:///workspace",
          name: "workspace",
        },
      ]),
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: unknown };
    };
    expect(request.params.capabilities).toEqual({
      roots: {
        listChanged: true,
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("does not advertise sampling or roots capabilities when handlers are not provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: Record<string, unknown> };
    };
    expect(request.params.capabilities).not.toHaveProperty("sampling");
    expect(request.params.capabilities).not.toHaveProperty("roots");

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("sends initialized after initialize response, stores response data, and becomes ready", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const clientInfo = {
      name: "tiny-mcp-client",
      version: "0.1.0",
    };
    const capabilities = {
      roots: {
        listChanged: true,
      },
      sampling: {},
    };
    const client = new McpClient({
      clientInfo,
      capabilities,
    });

    const connectPromise = client.connect(transport);
    expect(client.state).toBe("initializing");

    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as Record<string, unknown>;
    expect(request).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        clientInfo,
        capabilities,
      },
    });

    const initializeResult = {
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
      serverInfo: {
        name: "server",
        version: "1.0.0",
      },
      instructions: "Use safe mode for destructive operations.",
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: initializeResult,
      })}\n`
    );

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const initializedNotification = JSON.parse(
      initializedLineResult.value
    ) as Record<string, unknown>;
    expect(initializedNotification).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    await expect(connectPromise).resolves.toEqual(initializeResult);
    expect(client.serverCapabilities).toEqual(initializeResult.capabilities);
    expect(client.serverInfo).toEqual(initializeResult.serverInfo);
    expect(client.instructions).toBe(initializeResult.instructions);
    expect(client.state).toBe("ready");
  });

  it("rejects with McpError when server responds with a different protocol version", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();

    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id?: number;
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await expect(connectPromise).rejects.toBeInstanceOf(McpError);
    await expect(connectPromise).rejects.toMatchObject({
      code: ERROR_INVALID_REQUEST,
      message: "Unsupported protocol version: 2024-11-05",
    });
    expect(client.serverCapabilities).toBeNull();
    expect(client.serverInfo).toBeNull();
    expect(client.instructions).toBeUndefined();
  });

  it("rejects malformed initialize server identity", async () => {
    const { client, connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: {},
      serverInfo: { name: "server", version: 7 },
    });

    await expect(connectPromise).rejects.toThrow("Invalid initialize result");
    expect(client.state).not.toBe("ready");
    expect(client.serverInfo).toBeNull();
  });

  it("rejects null initialize capabilities", async () => {
    const { client, connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: null,
      serverInfo: { name: "server", version: "1.0.0" },
    });

    await expect(connectPromise).rejects.toThrow("Invalid initialize result");
    expect(client.state).not.toBe("ready");
  });
});

describe("McpClient listTools", () => {
  it("sends tools/list and returns tools from the server", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listToolsPromise = client.listTools();
    const listToolsLineResult = await iterator.next();
    if (listToolsLineResult.done) {
      throw new Error("Expected tools/list request line to be written");
    }

    const listToolsRequest = JSON.parse(listToolsLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listToolsRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/list",
    });
    expect(listToolsRequest).not.toHaveProperty("params");

    const expectedTools = [
      {
        name: "echo",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
          required: ["message"],
        },
      },
    ];
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listToolsRequest.id,
        result: {
          tools: expectedTools,
        },
      })}\n`
    );

    await expect(listToolsPromise).resolves.toEqual({
      tools: expectedTools,
    });
  });

  it("sends cursor for paginated tools/list and returns nextCursor", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listToolsPromise = client.listTools({ cursor: "5" });
    const listToolsLineResult = await iterator.next();
    if (listToolsLineResult.done) {
      throw new Error("Expected tools/list request line to be written");
    }

    const listToolsRequest = JSON.parse(listToolsLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listToolsRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/list",
      params: {
        cursor: "5",
      },
    });

    const expectedTools = [
      {
        name: "tool-6",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ];
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listToolsRequest.id,
        result: {
          tools: expectedTools,
          nextCursor: "10",
        },
      })}\n`
    );

    await expect(listToolsPromise).resolves.toEqual({
      tools: expectedTools,
      nextCursor: "10",
    });
  });

  it("rejects a numeric nextCursor returned from tools/list", async () => {
    const { client, readable, iterator, connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "server", version: "1.0.0" },
    });
    await connectPromise;
    await iterator.next();

    const requestPromise = client.listTools();
    const requestLine = await iterator.next();
    if (requestLine.done) {
      throw new Error("Expected tools/list request line to be written");
    }
    const request = JSON.parse(requestLine.value) as { id: number };
    readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [], nextCursor: 7 } })}\n`);

    await expect(requestPromise).rejects.toThrow("Invalid tools/list result");
    await client.close();
  });
});

describe("McpClient listResources", () => {
  it("sends resources/list and returns resources from the server", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listResourcesPromise = client.listResources();
    const listResourcesLineResult = await iterator.next();
    if (listResourcesLineResult.done) {
      throw new Error("Expected resources/list request line to be written");
    }

    const listResourcesRequest = JSON.parse(listResourcesLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listResourcesRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/list",
    });
    expect(listResourcesRequest).not.toHaveProperty("params");

    const expectedResources = [
      {
        uri: "file:///readme.txt",
        name: "readme.txt",
        description: "README file for the project",
        mimeType: "text/plain",
        size: 1024,
      },
      {
        uri: "file:///image.png",
        name: "image.png",
        description: "Project image asset",
        mimeType: "image/png",
        size: 2048,
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listResourcesRequest.id,
        result: {
          resources: expectedResources,
        },
      })}\n`
    );

    await expect(listResourcesPromise).resolves.toEqual({
      resources: expectedResources,
    });
  });

  it("sends cursor for paginated resources/list and returns nextCursor", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listResourcesPromise = client.listResources({ cursor: "2" });
    const listResourcesLineResult = await iterator.next();
    if (listResourcesLineResult.done) {
      throw new Error("Expected resources/list request line to be written");
    }

    const listResourcesRequest = JSON.parse(listResourcesLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listResourcesRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/list",
      params: {
        cursor: "2",
      },
    });

    const expectedResources = [
      {
        uri: "file:///diagram.svg",
        name: "diagram.svg",
        description: "Architecture diagram",
        mimeType: "image/svg+xml",
        size: 512,
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listResourcesRequest.id,
        result: {
          resources: expectedResources,
          nextCursor: "4",
        },
      })}\n`
    );

    await expect(listResourcesPromise).resolves.toEqual({
      resources: expectedResources,
      nextCursor: "4",
    });
  });

  it("rejects invalid resource descriptors returned from resources/list", async () => {
    const { client, readable, iterator, connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: { resources: {} },
      serverInfo: { name: "server", version: "1.0.0" },
    });
    await connectPromise;
    await iterator.next();

    const requestPromise = client.listResources();
    const requestLine = await iterator.next();
    if (requestLine.done) {
      throw new Error("Expected resources/list request line to be written");
    }
    const request = JSON.parse(requestLine.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          resources: [{ uri: 42, name: null }],
          nextCursor: 7,
        },
      })}\n`
    );

    await expect(requestPromise).rejects.toThrow("Invalid resources/list result");
    await client.close();
  });
});

describe("McpClient listResourceTemplates", () => {
  it("sends resources/templates/list and returns resource templates from the server", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listResourceTemplatesPromise = client.listResourceTemplates();
    const listResourceTemplatesLineResult = await iterator.next();
    if (listResourceTemplatesLineResult.done) {
      throw new Error("Expected resources/templates/list request line to be written");
    }

    const listResourceTemplatesRequest = JSON.parse(listResourceTemplatesLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listResourceTemplatesRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/templates/list",
    });
    expect(listResourceTemplatesRequest).not.toHaveProperty("params");

    const expectedResourceTemplates = [
      {
        uriTemplate: "file:///{path}",
        name: "file-template",
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listResourceTemplatesRequest.id,
        result: {
          resourceTemplates: expectedResourceTemplates,
        },
      })}\n`
    );

    await expect(listResourceTemplatesPromise).resolves.toEqual({
      resourceTemplates: expectedResourceTemplates,
    });
  });

  it("rejects invalid resource templates returned from resources/templates/list", async () => {
    const { client, readable, iterator, connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: { resources: {} },
      serverInfo: { name: "server", version: "1.0.0" },
    });
    await connectPromise;
    await iterator.next();

    const requestPromise = client.listResourceTemplates();
    const requestLine = await iterator.next();
    if (requestLine.done) {
      throw new Error("Expected resources/templates/list request line to be written");
    }
    const request = JSON.parse(requestLine.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          resourceTemplates: [{ uriTemplate: 123, name: false, mimeType: 42 }],
          nextCursor: 7,
        },
      })}\n`
    );

    await expect(requestPromise).rejects.toThrow("Invalid resources/templates/list result");
    await client.close();
  });
});

describe("McpClient listPrompts", () => {
  it("sends prompts/list and returns prompts with name, description, and arguments", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            prompts: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listPromptsPromise = client.listPrompts();
    const listPromptsLineResult = await iterator.next();
    if (listPromptsLineResult.done) {
      throw new Error("Expected prompts/list request line to be written");
    }

    const listPromptsRequest = JSON.parse(listPromptsLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listPromptsRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "prompts/list",
    });
    expect(listPromptsRequest).not.toHaveProperty("params");

    const expectedPrompts = [
      {
        name: "code_review",
        description: "Review code for correctness and maintainability.",
        arguments: [
          {
            name: "code",
            description: "Code snippet to review",
            required: true,
          },
        ],
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listPromptsRequest.id,
        result: {
          prompts: expectedPrompts,
          nextCursor: "2",
        },
      })}\n`
    );

    await expect(listPromptsPromise).resolves.toEqual({
      prompts: expectedPrompts,
      nextCursor: "2",
    });
  });
});

describe("McpClient getPrompt", () => {
  it("sends prompts/get without arguments and returns prompt messages", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            prompts: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const getPromptPromise = client.getPrompt({ name: "summarize" });
    const getPromptLineResult = await iterator.next();
    if (getPromptLineResult.done) {
      throw new Error("Expected prompts/get request line to be written");
    }

    const getPromptRequest = JSON.parse(getPromptLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(getPromptRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "prompts/get",
      params: {
        name: "summarize",
      },
    });
    expect(getPromptRequest.params).not.toHaveProperty("arguments");

    const expectedMessages = [
      {
        role: "user",
        content: {
          type: "text",
          text: "Please summarize the provided text.",
        },
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: getPromptRequest.id,
        result: {
          messages: expectedMessages,
        },
      })}\n`
    );

    await expect(getPromptPromise).resolves.toEqual({
      messages: expectedMessages,
    });
  });

  it("sends prompts/get with arguments and returns expanded prompt messages", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            prompts: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const getPromptPromise = client.getPrompt({
      name: "code_review",
      arguments: {
        code: "const answer = 42;",
      },
    });
    const getPromptLineResult = await iterator.next();
    if (getPromptLineResult.done) {
      throw new Error("Expected prompts/get request line to be written");
    }

    const getPromptRequest = JSON.parse(getPromptLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(getPromptRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "prompts/get",
      params: {
        name: "code_review",
        arguments: {
          code: "const answer = 42;",
        },
      },
    });

    const expectedResult = {
      description: "Review code for correctness and maintainability.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Please review the following code:\nconst answer = 42;",
          },
        },
        {
          role: "assistant",
          content: {
            type: "text",
            text: "I will review the code for potential issues and improvements.",
          },
        },
      ],
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: getPromptRequest.id,
        result: expectedResult,
      })}\n`
    );

    await expect(getPromptPromise).resolves.toEqual(expectedResult);
  });

  it("returns text, image, and embedded resource prompt content with user and assistant roles", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            prompts: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const getPromptPromise = client.getPrompt({ name: "content_types" });
    const getPromptLineResult = await iterator.next();
    if (getPromptLineResult.done) {
      throw new Error("Expected prompts/get request line to be written");
    }

    const getPromptRequest = JSON.parse(getPromptLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(getPromptRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "prompts/get",
      params: {
        name: "content_types",
      },
    });

    const textMessage = {
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "Describe the image and attached context.",
      },
    };
    const imageMessage = {
      role: "assistant" as const,
      content: {
        type: "image" as const,
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        mimeType: "image/png",
      },
    };
    const resourceMessage = {
      role: "assistant" as const,
      content: {
        type: "resource" as const,
        resource: {
          uri: "file:///context.txt",
          mimeType: "text/plain",
          text: "This context came from an embedded resource.",
        },
      },
    };
    const expectedResult = {
      messages: [textMessage, imageMessage, resourceMessage],
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: getPromptRequest.id,
        result: expectedResult,
      })}\n`
    );

    const result = await getPromptPromise;
    expect(result).toEqual(expectedResult);
    expect(result.messages[0]?.content).toEqual(textMessage.content);
    expect(result.messages[1]?.content).toEqual(imageMessage.content);
    expect(result.messages[2]?.content).toEqual(resourceMessage.content);
    expect(new Set(result.messages.map((message) => message.role))).toEqual(
      new Set(["user", "assistant"])
    );
  });

  it("rejects invalid prompt messages returned from prompts/get", async () => {
    const { client, readable, iterator, connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: { prompts: {} },
      serverInfo: { name: "server", version: "1.0.0" },
    });
    await connectPromise;
    await iterator.next();

    const requestPromise = client.getPrompt({ name: "broken" });
    const requestLine = await iterator.next();
    if (requestLine.done) {
      throw new Error("Expected prompts/get request line to be written");
    }
    const request = JSON.parse(requestLine.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          messages: [
            {
              role: "system",
              content: { type: "text", text: 123 },
            },
          ],
        },
      })}\n`
    );

    await expect(requestPromise).rejects.toThrow("Invalid prompts/get result");
    await client.close();
  });
});

describe("McpClient complete", () => {
  it("sends completion/complete with prompt ref and returns hasMore and total", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            completions: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const completePromise = client.complete({
      ref: {
        type: "ref/prompt",
        name: "code_review",
      },
      argument: {
        name: "language",
        value: "py",
      },
    });
    const completeLineResult = await iterator.next();
    if (completeLineResult.done) {
      throw new Error("Expected completion/complete request line to be written");
    }

    const completeRequest = JSON.parse(completeLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(completeRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "completion/complete",
      params: {
        ref: {
          type: "ref/prompt",
          name: "code_review",
        },
        argument: {
          name: "language",
          value: "py",
        },
      },
    });

    const expectedResult = {
      completion: {
        values: ["python", "pydantic", "pytest"],
        hasMore: true,
        total: 5,
      },
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: completeRequest.id,
        result: expectedResult,
      })}\n`
    );

    await expect(completePromise).resolves.toEqual(expectedResult);
  });

  it("returns completion values capped at 100 entries", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            completions: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const completePromise = client.complete({
      ref: {
        type: "ref/prompt",
        name: "code_review",
      },
      argument: {
        name: "language",
        value: "p",
      },
    });
    const completeLineResult = await iterator.next();
    if (completeLineResult.done) {
      throw new Error("Expected completion/complete request line to be written");
    }

    const completeRequest = JSON.parse(completeLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    const values = Array.from({ length: 100 }, (_, index) => `candidate-${index + 1}`);
    const expectedResult = {
      completion: {
        values,
        hasMore: true,
        total: 157,
      },
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: completeRequest.id,
        result: expectedResult,
      })}\n`
    );

    const result = await completePromise;
    expect(result.completion.values).toHaveLength(100);
    expect(result).toEqual(expectedResult);
  });

  it("sends completion/complete with resource ref and returns completion values", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            completions: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const completePromise = client.complete({
      ref: {
        type: "ref/resource",
        uri: "file:///workspace/{path}",
      },
      argument: {
        name: "path",
        value: "doc",
      },
    });
    const completeLineResult = await iterator.next();
    if (completeLineResult.done) {
      throw new Error("Expected completion/complete request line to be written");
    }

    const completeRequest = JSON.parse(completeLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(completeRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "completion/complete",
      params: {
        ref: {
          type: "ref/resource",
          uri: "file:///workspace/{path}",
        },
        argument: {
          name: "path",
          value: "doc",
        },
      },
    });

    const expectedResult = {
      completion: {
        values: ["docs/", "docs/api.md", "docs/guide.md"],
      },
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: completeRequest.id,
        result: expectedResult,
      })}\n`
    );

    await expect(completePromise).resolves.toEqual(expectedResult);
  });

  it("rejects invalid completion values returned from completion/complete", async () => {
    const { client, readable, iterator, connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: { completions: {} },
      serverInfo: { name: "server", version: "1.0.0" },
    });
    await connectPromise;
    await iterator.next();

    const requestPromise = client.complete({
      ref: {
        type: "ref/prompt",
        name: "code_review",
      },
      argument: {
        name: "language",
        value: "p",
      },
    });
    const requestLine = await iterator.next();
    if (requestLine.done) {
      throw new Error("Expected completion/complete request line to be written");
    }
    const request = JSON.parse(requestLine.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          completion: { values: "not-an-array" },
        },
      })}\n`
    );

    await expect(requestPromise).rejects.toThrow("Invalid completion/complete result");
    await client.close();
  });
});

describe("McpClient readResource", () => {
  it("sends resources/read with uri and returns text resource contents", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const readResourcePromise = client.readResource({ uri: "file:///readme.txt" });
    const readResourceLineResult = await iterator.next();
    if (readResourceLineResult.done) {
      throw new Error("Expected resources/read request line to be written");
    }

    const readResourceRequest = JSON.parse(readResourceLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(readResourceRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/read",
      params: {
        uri: "file:///readme.txt",
      },
    });

    const expectedContents = [
      {
        uri: "file:///readme.txt",
        mimeType: "text/plain",
        text: "This is a mock README resource.",
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: readResourceRequest.id,
        result: {
          contents: expectedContents,
        },
      })}\n`
    );

    await expect(readResourcePromise).resolves.toEqual({
      contents: expectedContents,
    });
  });

  it("rejects invalid content returned from resources/read", async () => {
    const { client, readable, iterator, connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: { resources: {} },
      serverInfo: { name: "server", version: "1.0.0" },
    });
    await connectPromise;
    await iterator.next();

    const requestPromise = client.readResource({ uri: "memo://bad" });
    const requestLine = await iterator.next();
    if (requestLine.done) {
      throw new Error("Expected resources/read request line to be written");
    }
    const request = JSON.parse(requestLine.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          contents: [{ uri: "memo://bad", mimeType: 123, text: 456 }],
        },
      })}\n`
    );

    await expect(requestPromise).rejects.toThrow("Invalid resources/read result");
    await client.close();
  });

  it("sends resources/read with uri and returns binary resource contents", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const readResourcePromise = client.readResource({ uri: "file:///image.png" });
    const readResourceLineResult = await iterator.next();
    if (readResourceLineResult.done) {
      throw new Error("Expected resources/read request line to be written");
    }

    const readResourceRequest = JSON.parse(readResourceLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(readResourceRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/read",
      params: {
        uri: "file:///image.png",
      },
    });

    const expectedContents = [
      {
        uri: "file:///image.png",
        mimeType: "image/png",
        blob: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgL9qj3QAAAAASUVORK5CYII=",
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: readResourceRequest.id,
        result: {
          contents: expectedContents,
        },
      })}\n`
    );

    await expect(readResourcePromise).resolves.toEqual({
      contents: expectedContents,
    });
  });

  it("rejects with McpError when reading a nonexistent URI", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const missingUri = "file:///missing.txt";
    const readResourcePromise = client.readResource({ uri: missingUri });
    const readResourceLineResult = await iterator.next();
    if (readResourceLineResult.done) {
      throw new Error("Expected resources/read request line to be written");
    }

    const readResourceRequest = JSON.parse(readResourceLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(readResourceRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/read",
      params: {
        uri: missingUri,
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: readResourceRequest.id,
        error: {
          code: -32002,
          message: `Resource not found: ${missingUri}`,
        },
      })}\n`
    );

    await expect(readResourcePromise).rejects.toBeInstanceOf(McpError);
    await expect(readResourcePromise).rejects.toMatchObject({
      code: -32002,
      message: `Resource not found: ${missingUri}`,
    });
  });
});

describe("McpClient resource subscriptions", () => {
  it("sends resources/subscribe with uri", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {
              subscribe: true,
            },
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const subscribePromise = client.subscribe("file:///readme.txt");
    const subscribeLineResult = await iterator.next();
    if (subscribeLineResult.done) {
      throw new Error("Expected resources/subscribe request line to be written");
    }

    const subscribeRequest = JSON.parse(subscribeLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(subscribeRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/subscribe",
      params: {
        uri: "file:///readme.txt",
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: subscribeRequest.id,
        result: {},
      })}\n`
    );

    await expect(subscribePromise).resolves.toBeUndefined();
  });

  it("sends resources/unsubscribe with uri", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {
              subscribe: true,
            },
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const unsubscribePromise = client.unsubscribe("file:///readme.txt");
    const unsubscribeLineResult = await iterator.next();
    if (unsubscribeLineResult.done) {
      throw new Error("Expected resources/unsubscribe request line to be written");
    }

    const unsubscribeRequest = JSON.parse(unsubscribeLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(unsubscribeRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/unsubscribe",
      params: {
        uri: "file:///readme.txt",
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: unsubscribeRequest.id,
        result: {},
      })}\n`
    );

    await expect(unsubscribePromise).resolves.toBeUndefined();
  });
});

describe("McpClient callTool", () => {
  it("sends tools/call with name and arguments and returns content with optional isError", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const callToolPromise = client.callTool({
      name: "echo",
      arguments: {
        message: "hello from test",
      },
    });
    const callToolLineResult = await iterator.next();
    if (callToolLineResult.done) {
      throw new Error("Expected tools/call request line to be written");
    }

    const callToolRequest = JSON.parse(callToolLineResult.value) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    expect(callToolRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "echo",
        arguments: {
          message: "hello from test",
        },
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: callToolRequest.id,
        result: {
          content: [
            {
              type: "text",
              text: "tool error",
            },
          ],
          isError: true,
        },
      })}\n`
    );

    await expect(callToolPromise).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "tool error",
        },
      ],
      isError: true,
    });
  });

  it("includes _meta.progressToken in tools/call when progressToken option is provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const callToolPromise = client.callTool(
      {
        name: "echo",
        arguments: {
          message: "hello from test",
        },
      },
      { progressToken: "call-1" }
    );
    const callToolLineResult = await iterator.next();
    if (callToolLineResult.done) {
      throw new Error("Expected tools/call request line to be written");
    }

    const callToolRequest = JSON.parse(callToolLineResult.value) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    expect(callToolRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "echo",
        arguments: {
          message: "hello from test",
        },
        _meta: {
          progressToken: "call-1",
        },
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: callToolRequest.id,
        result: {
          content: [
            {
              type: "text",
              text: "done",
            },
          ],
        },
      })}\n`
    );

    await expect(callToolPromise).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "done",
        },
      ],
    });

    await client.close();
  });

  it("sends notifications/cancelled and rejects with abort reason when signal aborts", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const activeMessageLayer = (
      client as unknown as {
        messageLayer: JsonRpcMessageLayer | null;
      }
    ).messageLayer;
    if (activeMessageLayer === null) {
      throw new Error("Expected message layer to exist after connect");
    }
    const pendingCount = () =>
      (
        activeMessageLayer as unknown as {
          pendingRequests: Map<unknown, unknown>;
        }
      ).pendingRequests.size;

    const abortController = new AbortController();
    const callToolPromise = client.callTool(
      {
        name: "echo",
        arguments: {
          message: "hello from test",
        },
      },
      { signal: abortController.signal }
    );
    const callToolRejection = expect(callToolPromise).rejects.toBe("user cancelled");
    const callToolLineResult = await iterator.next();
    if (callToolLineResult.done) {
      throw new Error("Expected tools/call request line to be written");
    }

    const callToolRequest = JSON.parse(callToolLineResult.value) as {
      id: number;
    };
    expect(pendingCount()).toBe(1);

    abortController.abort("user cancelled");

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: callToolRequest.id,
      },
    });

    await callToolRejection;
    expect(pendingCount()).toBe(0);
    await client.close();
  });

  it("does not send notifications/cancelled when signal aborts after completion", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const abortController = new AbortController();
    const addEventListenerSpy = vi.spyOn(abortController.signal, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(abortController.signal, "removeEventListener");
    const callToolPromise = client.callTool(
      {
        name: "echo",
      },
      { signal: abortController.signal }
    );
    const callToolLineResult = await iterator.next();
    if (callToolLineResult.done) {
      throw new Error("Expected tools/call request line to be written");
    }

    const callToolRequest = JSON.parse(callToolLineResult.value) as {
      id: number;
    };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: callToolRequest.id,
        result: {
          content: [
            {
              type: "text",
              text: "done",
            },
          ],
        },
      })}\n`
    );

    await expect(callToolPromise).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "done",
        },
      ],
    });

    const addedAbortListener = addEventListenerSpy.mock.calls[0]?.[1];
    expect(addedAbortListener).toBeDefined();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", addedAbortListener);

    expect(writable.readableLength).toBe(0);
    abortController.abort("too late");
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(writable.readableLength).toBe(0);

    await client.close();
  });

  it("rejects malformed successful tool results", async () => {
    const { client, readable, iterator, connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "server", version: "1.0.0" },
    });
    await connectPromise;
    await iterator.next();

    const requestPromise = client.callTool({ name: "bad", arguments: {} });
    const requestLine = await iterator.next();
    if (requestLine.done) {
      throw new Error("Expected tools/call request line to be written");
    }
    const request = JSON.parse(requestLine.value) as { id: number };
    readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text" }] } })}\n`);

    await expect(requestPromise).rejects.toThrow("Invalid tool result");
    await client.close();
  });

  it("does not dispatch a pre-aborted tool call", async () => {
    const { client, writable, iterator, connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "server", version: "1.0.0" },
    });
    await connectPromise;
    await iterator.next();
    const controller = new AbortController();
    controller.abort("already cancelled");

    await expect(client.callTool({ name: "echo" }, { signal: controller.signal })).rejects.toBe(
      "already cancelled"
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writable.readableLength).toBe(0);
    await client.close();
  });
});

describe("McpClient setLogLevel", () => {
  it("sends logging/setLevel with level and resolves on success response", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            logging: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const setLogLevelPromise = client.setLogLevel("info");
    const setLogLevelLineResult = await iterator.next();
    if (setLogLevelLineResult.done) {
      throw new Error("Expected logging/setLevel request line to be written");
    }

    const setLogLevelRequest = JSON.parse(setLogLevelLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(setLogLevelRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "logging/setLevel",
      params: {
        level: "info",
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: setLogLevelRequest.id,
        result: {},
      })}\n`
    );

    await expect(setLogLevelPromise).resolves.toBeUndefined();
  });
});

describe("McpClient sendRootsChanged", () => {
  it("writes notifications/roots/list_changed to the transport", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      capabilities: {
        roots: {
          listChanged: true,
        },
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    await client.sendRootsChanged();

    const rootsChangedLineResult = await iterator.next();
    if (rootsChangedLineResult.done) {
      throw new Error("Expected roots/list_changed notification line to be written");
    }

    expect(JSON.parse(rootsChangedLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/roots/list_changed",
    });
  });

  it("rejects when roots list changes were not advertised", async () => {
    const { client, connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: {},
      serverInfo: { name: "server", version: "1.0.0" },
    });
    await connectPromise;

    await expect(client.sendRootsChanged()).rejects.toThrow(
      "Client did not advertise roots list changes"
    );
    await client.close();
  });
});

describe("McpClient cancel", () => {
  it("sends notifications/cancelled with requestId and reason", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    await client.cancel(1, "user cancelled");

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: 1,
        reason: "user cancelled",
      },
    });

    await client.close();
  });

  it("sends notifications/cancelled with requestId and without reason", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    await client.cancel(1);

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: 1,
      },
    });

    await client.close();
  });

  it("does not throw when cancelling an already-completed request", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const pingPromise = client.ping();
    const pingLineResult = await iterator.next();
    if (pingLineResult.done) {
      throw new Error("Expected ping request line to be written");
    }

    const pingRequest = JSON.parse(pingLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: pingRequest.id,
        result: {},
      })}\n`
    );
    await expect(pingPromise).resolves.toBeUndefined();

    await expect(client.cancel(pingRequest.id)).resolves.toBeUndefined();

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: pingRequest.id,
      },
    });

    await client.close();
  });

  it("does not throw when cancelling an unknown request id", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const unknownRequestId = "missing-request-id";
    await expect(client.cancel(unknownRequestId)).resolves.toBeUndefined();

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: unknownRequestId,
      },
    });

    await client.close();
  });

  it("ignores a response that arrives after request cancellation", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const abortController = new AbortController();
    const callToolPromise = client.callTool(
      {
        name: "echo",
        arguments: {
          message: "hello from test",
        },
      },
      { signal: abortController.signal }
    );
    const callToolRejection = expect(callToolPromise).rejects.toBe("user cancelled");
    const callToolLineResult = await iterator.next();
    if (callToolLineResult.done) {
      throw new Error("Expected tools/call request line to be written");
    }

    const callToolRequest = JSON.parse(callToolLineResult.value) as { id: number };
    abortController.abort("user cancelled");

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: callToolRequest.id,
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: callToolRequest.id,
        result: {
          content: [
            {
              type: "text",
              text: "late tool result",
            },
          ],
        },
      })}\n`
    );

    await callToolRejection;

    const pingPromise = client.ping();
    const pingLineResult = await iterator.next();
    if (pingLineResult.done) {
      throw new Error("Expected ping request line to be written");
    }

    const pingRequest = JSON.parse(pingLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: pingRequest.id,
        result: {},
      })}\n`
    );
    await expect(pingPromise).resolves.toBeUndefined();

    await client.close();
  });
});

describe("McpClient ping", () => {
  it("sends ping request and resolves when the server returns an empty response", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const pingPromise = client.ping();
    const pingLineResult = await iterator.next();
    if (pingLineResult.done) {
      throw new Error("Expected ping request line to be written");
    }

    const pingRequest = JSON.parse(pingLineResult.value) as {
      id: number;
      method: string;
    };
    expect(pingRequest.method).toBe("ping");

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: pingRequest.id,
        result: {},
      })}\n`
    );

    await expect(pingPromise).resolves.toBeUndefined();
  });

  it("rejects when ping response is not received before request timeout", async () => {
    vi.useFakeTimers();
    try {
      const readable = new PassThrough();
      const writable = new PassThrough();
      const transport: McpTransport = {
        readable,
        writable,
        closed: new Promise(() => {}),
        dispose: vi.fn(),
      };
      const client = new McpClient({
        clientInfo: {
          name: "tiny-mcp-client",
          version: "0.1.0",
        },
      });

      const connectPromise = client.connect(transport);
      const iterator = readLines(writable)[Symbol.asyncIterator]();
      const initializeLineResult = await iterator.next();
      if (initializeLineResult.done) {
        throw new Error("Expected initialize request line to be written");
      }

      const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
      readable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: initializeRequest.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: {
              name: "server",
              version: "1.0.0",
            },
          },
        })}\n`
      );

      await connectPromise;

      const initializedLineResult = await iterator.next();
      if (initializedLineResult.done) {
        throw new Error("Expected initialized notification line to be written");
      }

      const pingPromise = client.ping();
      const pingLineResult = await iterator.next();
      if (pingLineResult.done) {
        throw new Error("Expected ping request line to be written");
      }

      const pingRequest = JSON.parse(pingLineResult.value) as {
        method: string;
      };
      expect(pingRequest.method).toBe("ping");

      const timeoutPromise = expect(pingPromise).rejects.toThrow(
        'JSON-RPC request "ping" timed out after 30000ms'
      );

      await vi.advanceTimersByTimeAsync(30_000);

      await timeoutPromise;
      await client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the configured request timeout for client requests", async () => {
    vi.useFakeTimers();

    try {
      const readable = new PassThrough();
      const writable = new PassThrough();
      const transport: McpTransport = {
        readable,
        writable,
        closed: new Promise(() => {}),
        dispose: vi.fn(),
      };
      const client = new McpClient({
        clientInfo: {
          name: "tiny-mcp-client",
          version: "0.1.0",
        },
        requestTimeoutMs: 42_000,
      });

      const connectPromise = client.connect(transport);
      const iterator = readLines(writable)[Symbol.asyncIterator]();
      const initializeLineResult = await iterator.next();
      if (initializeLineResult.done) {
        throw new Error("Expected initialize request line to be written");
      }

      const timeoutPromise = expect(connectPromise).rejects.toThrow(
        'JSON-RPC request "initialize" timed out after 42000ms'
      );

      await vi.advanceTimersByTimeAsync(42_000);

      await timeoutPromise;
      await client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("responds with an empty object when the server sends a ping request", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "server-ping-1",
        method: "ping",
      })}\n`
    );

    const pingResponseLineResult = await iterator.next();
    if (pingResponseLineResult.done) {
      throw new Error("Expected ping response line to be written");
    }

    expect(JSON.parse(pingResponseLineResult.value)).toEqual({
      jsonrpc: "2.0",
      id: "server-ping-1",
      result: {},
    });
  });
});

describe("McpClient close", () => {
  it("can connect, close, and then connect again with a new transport", async () => {
    const firstReadable = new PassThrough();
    const firstWritable = new PassThrough();
    const firstTransport: McpTransport = {
      readable: firstReadable,
      writable: firstWritable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const firstConnectPromise = client.connect(firstTransport);
    const firstIterator = readLines(firstWritable)[Symbol.asyncIterator]();
    const firstInitializeLineResult = await firstIterator.next();
    if (firstInitializeLineResult.done) {
      throw new Error("Expected first initialize request line to be written");
    }

    const firstInitializeRequest = JSON.parse(firstInitializeLineResult.value) as {
      id: number;
    };
    firstReadable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: firstInitializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "first-server",
            version: "1.0.0",
          },
        },
      })}\n`
    );
    await firstConnectPromise;
    await client.close();

    expect(firstTransport.dispose).toHaveBeenCalledTimes(1);
    expect(client.state).toBe("closed");

    const secondReadable = new PassThrough();
    const secondWritable = new PassThrough();
    const secondTransport: McpTransport = {
      readable: secondReadable,
      writable: secondWritable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const secondHandshake = (async () => {
      const secondIterator = readLines(secondWritable)[Symbol.asyncIterator]();
      const secondInitializeLineResult = await secondIterator.next();
      if (secondInitializeLineResult.done) {
        throw new Error("Expected second initialize request line to be written");
      }

      const secondInitializeRequest = JSON.parse(secondInitializeLineResult.value) as {
        id: number;
      };
      secondReadable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: secondInitializeRequest.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: {
              name: "second-server",
              version: "2.0.0",
            },
          },
        })}\n`
      );
    })();

    await expect(client.connect(secondTransport)).resolves.toMatchObject({
      protocolVersion: "2025-03-26",
      serverInfo: {
        name: "second-server",
        version: "2.0.0",
      },
    });
    await secondHandshake;

    expect(client.serverInfo).toEqual({
      name: "second-server",
      version: "2.0.0",
    });
    expect(client.state).toBe("ready");

    await client.close();
    expect(secondTransport.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not use previous capabilities while reconnecting", async () => {
    const client = new McpClient({
      clientInfo: { name: "tiny-mcp-client", version: "0.1.0" },
    });
    const firstReadable = new PassThrough();
    const firstWritable = new PassThrough();
    const firstConnect = client.connect({
      readable: firstReadable,
      writable: firstWritable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    });
    const firstIterator = readLines(firstWritable)[Symbol.asyncIterator]();
    const firstInitializeLine = await firstIterator.next();
    if (firstInitializeLine.done) {
      throw new Error("Expected first initialize request line to be written");
    }
    const firstInitialize = JSON.parse(firstInitializeLine.value) as { id: number };
    firstReadable.write(`${JSON.stringify({ jsonrpc: "2.0", id: firstInitialize.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "first", version: "1" } } })}\n`);
    await firstConnect;
    await client.close();

    const secondReadable = new PassThrough();
    const secondWritable = new PassThrough();
    const secondConnect = client.connect({
      readable: secondReadable,
      writable: secondWritable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    });
    const secondIterator = readLines(secondWritable)[Symbol.asyncIterator]();
    await secondIterator.next();

    expect(client.serverCapabilities).toBeNull();
    await expect(client.listTools()).rejects.toThrow("MCP client has not completed initialization");
    expect(secondWritable.readableLength).toBe(0);

    await client.close();
    await expect(secondConnect).rejects.toThrow("MCP client closed");
  });

  it("rejects connect when closed immediately before initialize handshake completes", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    await client.close();

    expect(transport.dispose).toHaveBeenCalledTimes(1);
    await expect(connectPromise).rejects.toThrow("MCP client closed");
    expect(client.state).toBe("closed");
  });

  it("close with pending requests rejects all requests and disposes message layer + transport", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLine = await iterator.next();
    if (initializeLine.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const activeMessageLayer = (
      client as unknown as {
        messageLayer: JsonRpcMessageLayer | null;
      }
    ).messageLayer;

    if (activeMessageLayer === null) {
      throw new Error("Expected message layer to exist after connect");
    }

    const pendingToolsRequest = activeMessageLayer.sendRequest("tools/list");
    const pendingPromptsRequest = activeMessageLayer.sendRequest("prompts/list");

    await client.close();

    expect(transport.dispose).toHaveBeenCalledTimes(1);
    await expect(connectPromise).rejects.toThrow("MCP client closed");
    await expect(pendingToolsRequest).rejects.toThrow("MCP client closed");
    await expect(pendingPromptsRequest).rejects.toThrow("MCP client closed");
  });

  it("transitions state to closed after close", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLine = await iterator.next();

    if (initializeLine.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLine.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
    expect(client.state).toBe("ready");

    await client.close();

    expect(client.state).toBe("closed");
  });
});

describe("McpClient unexpected transport close", () => {
  it("rejects all pending requests when transport closes unexpectedly", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    let resolveClosed: (closedEvent: McpTransportClosedEvent) => void = () => undefined;
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise((resolve) => {
        resolveClosed = resolve;
      }),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();

    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedNotificationLineResult = await iterator.next();
    if (initializedNotificationLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const activeMessageLayer = (
      client as unknown as {
        messageLayer: JsonRpcMessageLayer | null;
      }
    ).messageLayer;

    if (activeMessageLayer === null) {
      throw new Error("Expected message layer to exist after connect");
    }

    const pendingToolsRequest = activeMessageLayer.sendRequest("tools/list");
    const pendingPromptsRequest = activeMessageLayer.sendRequest("prompts/list");

    const firstPendingRequestLine = await iterator.next();
    if (firstPendingRequestLine.done) {
      throw new Error("Expected first pending request line to be written");
    }

    const secondPendingRequestLine = await iterator.next();
    if (secondPendingRequestLine.done) {
      throw new Error("Expected second pending request line to be written");
    }

    resolveClosed({
      reason: new Error("transport closed unexpectedly"),
    });

    await expect(pendingToolsRequest).rejects.toThrow("transport closed unexpectedly");
    await expect(pendingPromptsRequest).rejects.toThrow("transport closed unexpectedly");
  });

  it("transitions state to closed when transport closes unexpectedly", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    let resolveClosed: (closedEvent: McpTransportClosedEvent) => void = () => undefined;
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise((resolve) => {
        resolveClosed = resolve;
      }),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();

    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
    expect(client.state).toBe("ready");

    resolveClosed({
      reason: new Error("transport crashed"),
    });

    await Promise.resolve();

    expect(client.state).toBe("closed");
  });

  it("rejects pending requests on stdio process crash and exposes stderr output", async () => {
    const crashingServerScript = [
      'const readline = require("node:readline");',
      "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
      'rl.on("line", (line) => {',
      "  const message = JSON.parse(line);",
      '  if (message.method === "initialize") {',
      "    process.stdout.write(JSON.stringify({",
      '      jsonrpc: "2.0",',
      "      id: message.id,",
      "      result: {",
      '        protocolVersion: "2025-03-26",',
      "        capabilities: { tools: {} },",
      '        serverInfo: { name: "crashing-server", version: "0.0.0-test" }',
      "      }",
      '    }) + "\\n");',
      "    return;",
      "  }",
      '  if (message.method === "notifications/initialized") {',
      "    return;",
      "  }",
      '  if (message.method === "tools/list") {',
      '    process.stderr.write("crash: tools/list before response\\n");',
      "    process.exit(1);",
      "  }",
      "});",
    ].join("\n");
    const transport = new StdioTransport({
      command: process.execPath,
      args: ["-e", crashingServerScript],
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    await client.connect(transport);

    const pendingToolsRequest = client.listTools();
    await expect(pendingToolsRequest).rejects.toThrow("Stdio transport process exited");

    const closedEvent = await transport.closed;
    expect(closedEvent.reason).toBeInstanceOf(Error);
    expect(closedEvent.reason.message).toBe("Stdio transport process exited");
    expect(closedEvent.code).toBe(1);
    expect(closedEvent.signal).toBeUndefined();
    expect(transport.getStderrOutput()).toContain("crash: tools/list before response");
    expect(client.state).toBe("closed");
  });
});

describe("McpClient capability gating", () => {
  const createConnectedClient = async (
    serverCapabilities: ServerCapabilities
  ): Promise<{ client: McpClient; closeClient: () => Promise<void> }> => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();

    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: serverCapabilities,
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    return {
      client,
      closeClient: async () => {
        await client.close();
      },
    };
  };

  it("listTools throws when server has no tools capability", async () => {
    const { client, closeClient } = await createConnectedClient({});

    try {
      await expect(client.listTools()).rejects.toThrow("Server does not support tools");
    } finally {
      await closeClient();
    }
  });

  it("listTools throws when server advertises null tools capability", async () => {
    const { connectPromise } = await startClientHandshake({
      protocolVersion: "2025-03-26",
      capabilities: { tools: null },
      serverInfo: { name: "server", version: "1.0.0" },
    });

    await expect(connectPromise).rejects.toThrow("Invalid initialize result");
  });

  it("does not authorize subscriptions after exposed capabilities are mutated", async () => {
    const { client, closeClient } = await createConnectedClient({ resources: {} });

    try {
      (client.serverCapabilities as { resources: { subscribe?: boolean } }).resources.subscribe = true;
      await expect(client.subscribe("file:///readme.txt")).rejects.toThrow(
        "Server does not support resource subscriptions"
      );
    } finally {
      await closeClient();
    }
  });

  it("listResources throws when server has no resources capability", async () => {
    const { client, closeClient } = await createConnectedClient({});

    try {
      await expect(client.listResources()).rejects.toThrow("Server does not support resources");
    } finally {
      await closeClient();
    }
  });

  it("subscribe throws when server resources.subscribe is not true", async () => {
    const { client, closeClient } = await createConnectedClient({
      resources: {},
    });

    try {
      await expect(client.subscribe("file:///readme.txt")).rejects.toThrow(
        "Server does not support resource subscriptions"
      );
    } finally {
      await closeClient();
    }
  });

  it("unsubscribe throws when server resources.subscribe is not true", async () => {
    const { client, closeClient } = await createConnectedClient({
      resources: {},
    });

    try {
      await expect(client.unsubscribe("file:///readme.txt")).rejects.toThrow(
        "Server does not support resource subscriptions"
      );
    } finally {
      await closeClient();
    }
  });

  it("listPrompts throws when server has no prompts capability", async () => {
    const { client, closeClient } = await createConnectedClient({});

    try {
      await expect(client.listPrompts()).rejects.toThrow("Server does not support prompts");
    } finally {
      await closeClient();
    }
  });

  it("complete throws when server has no completions capability", async () => {
    const { client, closeClient } = await createConnectedClient({});

    try {
      await expect(
        client.complete({
          ref: {
            type: "ref/prompt",
            name: "code_review",
          },
          argument: {
            name: "language",
            value: "py",
          },
        })
      ).rejects.toThrow("Server does not support completions");
    } finally {
      await closeClient();
    }
  });

  it("setLogLevel throws when server has no logging capability", async () => {
    const { client, closeClient } = await createConnectedClient({});

    try {
      await expect(client.setLogLevel("info")).rejects.toThrow("Server does not support logging");
    } finally {
      await closeClient();
    }
  });
});
