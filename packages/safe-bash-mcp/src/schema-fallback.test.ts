import { expect, it, vi } from "vitest";
import type { HttpTransportFetch } from "tiny-mcp-client";
import { fetchRemoteMcpSchema } from "./index.js";

const server = { name: "legacy", url: "https://legacy.example/sse", protocolVersion: "2025-03-26" as const };

it.each([404, 405])("automatically negotiates legacy SSE on POST %s during setup", async status => {
  let stream: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const encoder = new TextEncoder();
  const fetch = vi.fn<HttpTransportFetch>(async (input, init) => {
    if (init?.method === "POST" && input.toString() === server.url)
      return new Response("legacy only", { status });
    if (init?.method === "GET") return new Response(new ReadableStream({
      start(controller) {
        stream = controller;
        controller.enqueue(encoder.encode("event: endpoint\ndata: /messages\n\n"));
      }, cancel
    }), { headers: { "Content-Type": "text/event-stream" } });
    expect(input.toString()).toBe("https://legacy.example/messages");
    const request = JSON.parse(String(init?.body));
    if (request.id !== undefined) {
      const result = request.method === "initialize" ? {
        protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "legacy", version: "1" }
      } : { tools: [{ name: "ping", inputSchema: { type: "object" } }] };
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n\n`));
    }
    return new Response(null, { status: 202 });
  });
  expect((await fetchRemoteMcpSchema(server, { fetch })).tools[0].name).toBe("ping");
  expect(cancel).toHaveBeenCalledOnce();
});

it.each([401, 403, 429, 500, 503])("does not replace HTTP %s with an SSE fallback error", async status => {
  const fetch = vi.fn<HttpTransportFetch>(async () => new Response("primary failure", { status }));
  await expect(fetchRemoteMcpSchema(server, { fetch })).rejects.toMatchObject({ status, method: "POST" });
  expect(fetch.mock.calls.every(([, init]) => init?.method === "POST")).toBe(true);
});

it("preserves the original network error without attempting SSE", async () => {
  const error = new Error("DNS lookup failed");
  const fetch = vi.fn<HttpTransportFetch>(async () => { throw error; });
  await expect(fetchRemoteMcpSchema(server, { fetch })).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledOnce();
});

it("honors an explicitly pinned HTTP transport on legacy mismatch", async () => {
  const fetch = vi.fn<HttpTransportFetch>(async () => new Response("legacy only", { status: 405 }));
  await expect(fetchRemoteMcpSchema({ ...server, transport: "http" }, { fetch })).rejects.toMatchObject({ status: 405 });
  expect(fetch).toHaveBeenCalledOnce();
});

it("retains both causes when legitimate SSE fallback also fails", async () => {
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) =>
    new Response("failed", { status: init?.method === "GET" ? 503 : 405 }));
  await expect(fetchRemoteMcpSchema(server, { fetch })).rejects.toMatchObject({
    cause: { status: 405, method: "POST" },
    errors: [{ status: 405, method: "POST" }, { status: 503, method: "GET" }]
  });
});

it("never switches transports after a successful connection", async () => {
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.method === "initialize") return new Response(JSON.stringify({
      jsonrpc: "2.0", id: request.id, result: {
        protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "server", version: "1" }
      }
    }), { headers: { "Content-Type": "application/json" } });
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    return new Response("listing failed", { status: 405 });
  });
  await expect(fetchRemoteMcpSchema(server, { fetch })).rejects.toMatchObject({ status: 405, method: "POST" });
  expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST", "POST"]);
});

it("cancels an in-flight setup request without attempting fallback", async () => {
  const controller = new AbortController();
  const error = new Error("cancel setup");
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    started();
  }));
  const pending = fetchRemoteMcpSchema(server, { fetch, signal: controller.signal });
  const assertion = expect(pending).rejects.toBe(error);
  await requestStarted;
  controller.abort(error);
  await assertion;
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it.each([404, 405])("does not switch to SSE when initialization completion fails with POST %s", async status => {
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    if (init?.method !== "POST") return new Response(null, { status: 503 });
    const request = JSON.parse(String(init.body));
    if (request.method === "notifications/initialized") return new Response(null, { status });
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "synthetic", version: "1" }
    } });
  });
  await expect(fetchRemoteMcpSchema(server, { fetch })).rejects.toMatchObject({ status, rpcMethod: "notifications/initialized" });
  expect(fetch.mock.calls.every(([, init]) => init?.method === "POST")).toBe(true);
});
