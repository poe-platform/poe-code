import { describe, expect, it, vi } from "vitest";
import { HttpTransport, McpClient, type HttpTransportFetch } from "./internal.js";

const url = "https://legacy.example/sse";

function fixture(endpoint = "/messages?session=abc", options: { end?: boolean; contentType?: string; prelude?: string } = {}) {
  let stream: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const requests: { url: string; method: string; headers: Headers }[] = [];
  const encode = new TextEncoder();
  const fetch = vi.fn<HttpTransportFetch>(async (input, init) => {
    requests.push({ url: input.toString(), method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    if (init?.method === "GET") return new Response(new ReadableStream({
      start(controller) {
        stream = controller;
        controller.enqueue(encode.encode(`${options.prelude ?? ""}event: endpoint\ndata: ${endpoint}\n\n`));
        if (options.end) controller.close();
      },
      cancel
    }), { headers: { "Content-Type": options.contentType ?? "text/event-stream" } });
    if (input.toString() !== new URL(endpoint, url).href) throw new Error("POST did not use announced endpoint");
    const request = JSON.parse(String(init?.body));
    if (request.id !== undefined) {
      const result = request.method === "initialize" ? {
        protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "legacy", version: "1" }
      } : { tools: [{ name: "ping", inputSchema: { type: "object" } }] };
      stream.enqueue(encode.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n\n`));
    }
    return new Response(null, { status: 202 });
  });
  return { fetch, requests, cancel };
}

describe("legacy remote SSE transport", () => {
  it("opens GET first and sends RPC messages to the announced endpoint", async () => {
    const remote = fixture();
    const transport = new HttpTransport({ url, mode: "sse", fetch: remote.fetch, headers: { Authorization: "Bearer token" } });
    const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-03-26" });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools[0].name).toBe("ping");
      expect(remote.requests[0]).toMatchObject({ url, method: "GET" });
      expect(remote.requests.filter(request => request.method === "POST").map(request => request.url))
        .toEqual(Array(3).fill("https://legacy.example/messages?session=abc"));
      expect(remote.requests.every(request => request.headers.get("authorization") === "Bearer token")).toBe(true);
    } finally { await client.close(); }
    expect(remote.cancel).toHaveBeenCalledOnce();
  });

  it.each(["https://attacker.example/messages", "http://legacy.example/messages", "https://user:password@legacy.example/messages", "/messages#fragment", "/messages#", "file:///tmp/messages"])(
    "rejects unsafe endpoint %s before transmitting credentials", async endpoint => {
      const remote = fixture(endpoint);
      const transport = new HttpTransport({ url, mode: "sse", fetch: remote.fetch, headers: { Authorization: "Bearer token" } });
      const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-03-26" });
      try {
        await expect(client.connect(transport)).rejects.toThrow("endpoint");
        expect(remote.requests.map(request => request.method)).toEqual(["GET"]);
      } finally { await client.close(); }
      expect(remote.cancel).toHaveBeenCalledOnce();
    }
  );

  it("fails promptly if the stream closes during setup", async () => {
    const remote = fixture("/messages", { end: true });
    const transport = new HttpTransport({ url, mode: "sse", fetch: remote.fetch });
    const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-03-26" });
    try { await expect(client.connect(transport)).rejects.toThrow("stream ended"); }
    finally { await client.close(); }
  });

  it("rejects non-SSE GET responses rather than waiting for an RPC timeout", async () => {
    const remote = fixture("/messages", { contentType: "application/json" });
    const transport = new HttpTransport({ url, mode: "sse", fetch: remote.fetch });
    const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-03-26" });
    try { await expect(client.connect(transport)).rejects.toThrow("content type"); }
    finally { await client.close(); }
    expect(remote.cancel).toHaveBeenCalledOnce();
  });

  it("ignores unrelated event types before the endpoint announcement", async () => {
    const remote = fixture("/messages", { prelude: "event: keepalive\ndata: ignored\n\n" });
    const transport = new HttpTransport({ url, mode: "sse", fetch: remote.fetch });
    const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-03-26" });
    try { await client.connect(transport); expect((await client.listTools()).tools).toHaveLength(1); }
    finally { await client.close(); }
  });
});
