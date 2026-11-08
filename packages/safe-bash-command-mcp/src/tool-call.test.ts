import { expect, it, vi } from "vitest";
import { callRemoteMcpTool } from "./index.js";
import type { SchemaFetchOptions } from "./schema.js";

const server = { name: "account", url: "https://account.example/mcp", transport: "http" as const,
  protocolVersion: "2025-03-26" as const, headers: { Authorization: "Bearer test-token" } };
const request = { name: "get-user", arguments: { user_id: "self" } };
type Rpc = { id?: number; method: string; params?: unknown };
function remote(override?: (rpc: Rpc, init: RequestInit) => Response | Promise<Response | undefined> | undefined) {
  const calls: Rpc[] = [];
  const fetch = vi.fn<NonNullable<SchemaFetchOptions["fetch"]>>(async (url, init = {}) => {
    expect(String(url)).toBe(server.url);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-token");
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    if (init.method !== "POST") return new Response(null, { status: 405 });
    const rpc: Rpc = JSON.parse(String(init.body)); calls.push(rpc);
    const response = await override?.(rpc, init);
    if (response) return response;
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    const result = rpc.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: { tools: {} },
      serverInfo: { name: "account", version: "1" } } : { content: [{ type: "text", text: "account details" }] };
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result }, { headers: { "Mcp-Session-Id": "call-session" } });
  });
  return { calls, fetch };
}

it("calls a known tool through the bundled client without discovery and disposes the session", async () => {
  const f = remote();
  expect(await callRemoteMcpTool(server, request, { fetch: f.fetch })).toEqual({ content: [{ type: "text", text: "account details" }] });
  expect(f.calls.map(call => call.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
  expect(f.calls.at(-1)?.params).toEqual(request);
  expect(f.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
});

it("captures parameters, endpoint, headers and options before asynchronous setup", async () => {
  const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const f = remote(async rpc => { if (rpc.method === "initialize") { entered.resolve(); await resume.promise; } });
  const owned = structuredClone(server), params = structuredClone(request), options = { fetch: f.fetch };
  const pending = callRemoteMcpTool(owned, params, options);
  await entered.promise;
  owned.url = "https://changed.example/mcp"; owned.headers.Authorization = "changed";
  params.arguments.user_id = "another";
  options.fetch = vi.fn(() => { throw new Error("changed fetch"); });
  resume.resolve(); await pending;
  expect(f.calls.at(-1)?.params).toEqual(request);
});

it.each([401, 404, 405, 429, 500])("does not replay a tool or change transport after HTTP %s", async status => {
  const f = remote(rpc => rpc.method === "tools/call" ? new Response(null, { status }) : undefined);
  await expect(callRemoteMcpTool(server, request, { fetch: f.fetch })).rejects.toMatchObject({ status });
  expect(f.calls.filter(call => call.method === "tools/call")).toHaveLength(1);
});

it("preserves tool error results for the caller", async () => {
  const result = { isError: true, content: [{ type: "text", text: "denied" }] };
  const f = remote(rpc => rpc.method === "tools/call" ? Response.json({ jsonrpc: "2.0", id: rpc.id, result }) : undefined);
  expect(await callRemoteMcpTool(server, request, { fetch: f.fetch })).toEqual(result);
});

it.each([{ content: "invalid" }, { content: [{ type: "text", text: "x".repeat(2048) }] }])("rejects invalid or oversized results", async result => {
  const f = remote(rpc => rpc.method === "tools/call" ? Response.json({ jsonrpc: "2.0", id: rpc.id, result }) : undefined);
  await expect(callRemoteMcpTool(server, request, { fetch: f.fetch, maxResponseBytes: 1024 })).rejects.toThrow();
});

it("aborts transport work and does not accept a late tool result", async () => {
  const controller = new AbortController(), reason = new Error("stop");
  const f = remote((rpc, init) => {
    if (rpc.method === "tools/call") { controller.abort(reason); expect(init.signal?.aborted).toBe(true); }
  });
  await expect(callRemoteMcpTool(server, request, { fetch: f.fetch, signal: controller.signal })).rejects.toBe(reason);
  expect(f.calls.filter(call => call.method === "tools/call")).toHaveLength(1);
});

it("rejects pre-cancellation and excessive input before egress", async () => {
  const f = remote();
  await expect(callRemoteMcpTool(server, request, { fetch: f.fetch, signal: AbortSignal.abort() })).rejects.toThrow();
  await expect(callRemoteMcpTool(server, request, { fetch: f.fetch, maxInputBytes: 1 })).rejects.toThrow("input byte limit");
  expect(f.fetch).not.toHaveBeenCalled();
});

it("closes a still-open SSE response after the tool result", async () => {
  const cancel = vi.fn();
  const f = remote(rpc => rpc.method === "tools/call" ? new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id,
      result: { content: [{ type: "text", text: "streamed result" }] } })}\n\n`));
  }, cancel }), { headers: { "Content-Type": "text/event-stream" } }) : undefined);
  expect(await callRemoteMcpTool(server, request, { fetch: f.fetch })).toEqual({ content: [{ type: "text", text: "streamed result" }] });
  expect(cancel).toHaveBeenCalledOnce();
});


it.each([301, 302, 303, 307, 308])("rejects manual HTTP %s without retrying the tool or reading redirect content", async status => {
  const cancel = vi.fn();
  const f = remote(rpc => rpc.method === "tools/call" ? new Response(new ReadableStream({ cancel }), {
    status, headers: { location: "https://other.example/mcp" }
  }) : undefined);
  await expect(callRemoteMcpTool(server, request, { fetch: f.fetch, requestTimeoutMs: 50 })).rejects.toThrow("redirect");
  expect(f.calls.filter(call => call.method === "tools/call")).toHaveLength(1);
  expect(cancel).toHaveBeenCalledOnce();
});
