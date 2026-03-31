import type { Readable } from "node:stream";
import { describe, expect, it, vi } from "bun:test";
import { HttpTransport, type McpTransport, readLines } from "./internal.js";

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
