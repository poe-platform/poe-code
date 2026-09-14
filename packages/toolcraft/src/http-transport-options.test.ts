import { setImmediate } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodeFetch } from "tiny-http-mcp-server/test-support";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { MCP_STREAM_METHODS } from "./mcp.js";
import {
  createHTTPMCPServer,
  runHTTPMCP,
  type RunHTTPMCPOptions,
  type ToolcraftHTTPServerHandle
} from "./http.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

const root = defineGroup({
  name: "audit",
  children: [defineCommand({ name: "check", scope: ["mcp"], params: S.Object({}), handler: () => "ready" })]
});

async function openServer(entrypoint: "create" | "run", options: Partial<RunHTTPMCPOptions> = {}) {
  const config = { name: "audit", version: "1", enableJsonResponse: true, errorReports: false as const, ...options };
  const handle = entrypoint === "run"
    ? await runHTTPMCP(root, { ...config, port: 0 })
    : await (await createHTTPMCPServer(root, config)).listenHttp({ port: 0 });
  cleanups.push(handle.close);
  return handle;
}

async function initialize(handle: ToolcraftHTTPServerHandle, subject?: string) {
  const response = await nodeFetch(handle.url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(subject === undefined ? {} : { authorization: `Bearer ${subject}` })
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } }
    })
  });
  await response.text();
  return response;
}

describe.each(["create", "run"] as const)("HTTP %s option forwarding", (entrypoint) => {
  it("preserves the stateful default when sessionIdGenerator is absent", async () => {
    const response = await initialize(await openServer(entrypoint));
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();
  });

  it("preserves explicit stateless mode", async () => {
    const response = await initialize(await openServer(entrypoint, { sessionIdGenerator: undefined }));
    expect(response.status).toBe(200);
    expect(response.headers.has("mcp-session-id")).toBe(false);
  });

  it("uses an explicit session generator", async () => {
    const sessionIdGenerator = vi.fn(() => "custom-session");
    const response = await initialize(await openServer(entrypoint, { sessionIdGenerator }));
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBe("custom-session");
    expect(sessionIdGenerator).toHaveBeenCalledOnce();
  });

  it.each([-1, 1.5, NaN, Infinity])("rejects invalid maxQueuedToolCalls %s", async (maxQueuedToolCalls) => {
    await expect(openServer(entrypoint, { maxQueuedToolCalls })).rejects.toThrow("maxQueuedToolCalls must be a safe integer");
  });

  it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid maxSessionsPerSubject %s", async (maxSessionsPerSubject) => {
    await expect(openServer(entrypoint, { maxSessionsPerSubject })).rejects.toThrow("maxSessionsPerSubject must be an integer");
  });

  it.each([1, 2])("enforces %s sessions per subject and recovers capacity after deletion", async (maxSessionsPerSubject) => {
    let nextSession = 0;
    const handle = await openServer(entrypoint, {
      sessionIdGenerator: () => `session-${++nextSession}`,
      maxSessionsPerSubject,
      oauth: {
        resource: "http://127.0.0.1/mcp",
        authorizationServers: ["https://auth.example.test"],
        verifier: {
          async verify({ token }) {
            return {
              token,
              issuer: "https://auth.example.test",
              audience: ["http://127.0.0.1/mcp"],
              scopes: [],
              expiresAt: Math.floor(Date.now() / 1000) + 60,
              claims: {},
              subject: token
            };
          }
        }
      }
    });
    let sessionId = "";
    for (let count = 0; count < maxSessionsPerSubject; count += 1) {
      const response = await initialize(handle, "subject-a");
      expect(response.status).toBe(200);
      sessionId = response.headers.get("mcp-session-id") ?? "";
      expect(sessionId).not.toBe("");
    }
    expect((await initialize(handle, "subject-a")).status).toBe(429);
    expect((await initialize(handle, "subject-b")).status).toBe(200);
    const deleted = await nodeFetch(handle.url, {
      method: "DELETE",
      headers: { authorization: "Bearer subject-a", "mcp-session-id": sessionId }
    });
    await deleted.text();
    expect(deleted.status).toBe(204);
    expect((await initialize(handle, "subject-a")).status).toBe(200);
  });
});

it.each([0, 1, 2])("preserves a queued-call capacity of %s in the HTTP server", async (maxQueuedToolCalls) => {
  let release!: () => void;
  let signalStarted!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const handler = vi.fn(async () => { signalStarted(); await held; return "done"; });
  const commands = defineGroup({ name: "audit", children: [defineCommand({ name: "held", scope: ["mcp"], params: S.Object({}), handler })] });
  const server = await createHTTPMCPServer(commands, {
    name: "audit", version: "1", errorReports: false, sessionIdGenerator: undefined,
    maxConcurrentToolCalls: 1, maxQueuedToolCalls
  });
  const handle = await server.listenHttp({ port: 0 });
  cleanups.push(handle.close);
  await server.handleMessage("initialize", {});
  const calls = [server.handleMessage("tools/call", { name: "audit__held", arguments: {} })];
  try {
    await started;
    for (let count = 0; count < maxQueuedToolCalls; count += 1) {
      calls.push(server.handleMessage("tools/call", { name: "audit__held", arguments: {} }));
    }
    let overflowResult: unknown;
    const overflow = server.handleMessage("tools/call", { name: "audit__held", arguments: {} }).then((result) => {
      overflowResult = result;
      return result;
    });
    calls.push(overflow);
    await setImmediate();
    expect(overflowResult).toMatchObject({ error: { code: -32000, message: "Too many queued tool calls" } });
    expect(handler).toHaveBeenCalledOnce();
  } finally {
    release();
    await Promise.all(calls);
  }
  expect(handler).toHaveBeenCalledTimes(maxQueuedToolCalls + 1);
});

it("delivers stream events over the default stateful HTTP transport", async () => {
  const commands = defineGroup({
    name: "audit",
    children: [defineStreamCommand({
      name: "watch", scope: ["mcp"], params: S.Object({}), event: S.Number(),
      async *handler() { yield 42; }
    })]
  });
  const handle = await runHTTPMCP(commands, { name: "audit", version: "1", port: 0, enableJsonResponse: true, errorReports: false });
  cleanups.push(handle.close);
  const initialized = await initialize(handle);
  const sessionId = initialized.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-session-id": sessionId ?? ""
  };
  const notification = await nodeFetch(handle.url, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
  });
  await notification.text();
  const abort = new AbortController();
  cleanups.push(async () => { abort.abort(); });
  const events = await nodeFetch(handle.url, { headers: { ...headers, accept: "text/event-stream" }, signal: abort.signal });
  expect(events.status).toBe(200);
  const subscribed = await nodeFetch(handle.url, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: MCP_STREAM_METHODS.subscribe, params: { name: "audit__watch", arguments: {} } })
  });
  const subscription = await subscribed.json() as { result: { subscriptionId: string } };
  const reader = events.body!.getReader();
  let received = "";
  try {
    while (!received.includes('"type":"end"')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += new TextDecoder().decode(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const messages = received.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  expect(messages).toEqual([
    { jsonrpc: "2.0", method: MCP_STREAM_METHODS.notification, params: { subscriptionId: subscription.result.subscriptionId, type: "data", event: 42 } },
    { jsonrpc: "2.0", method: MCP_STREAM_METHODS.notification, params: { subscriptionId: subscription.result.subscriptionId, type: "end" } }
  ]);
});
