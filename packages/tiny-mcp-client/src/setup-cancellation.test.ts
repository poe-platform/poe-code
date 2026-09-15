import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { createInMemoryTransportPair, JsonRpcMessageLayer, McpClient } from "./internal.js";

const requestCases = [
  { method: "resources/list", invoke: (client: McpClient, signal: AbortSignal) => client.listResources({}, { signal }) },
  { method: "resources/templates/list", invoke: (client: McpClient, signal: AbortSignal) => client.listResourceTemplates({}, { signal }) },
  { method: "resources/read", invoke: (client: McpClient, signal: AbortSignal) => client.readResource({ uri: "file:///value" }, { signal }) },
  { method: "prompts/list", invoke: (client: McpClient, signal: AbortSignal) => client.listPrompts({}, { signal }) },
  { method: "prompts/get", invoke: (client: McpClient, signal: AbortSignal) => client.getPrompt({ name: "value" }, { signal }) },
  { method: "completion/complete", invoke: (client: McpClient, signal: AbortSignal) => client.complete({ ref: { type: "ref/prompt", name: "value" }, argument: { name: "value", value: "a" } }, { signal }) },
  { method: "logging/setLevel", legacy: true, invoke: (client: McpClient, signal: AbortSignal) => client.setLogLevel("info", { signal }) },
  { method: "ping", legacy: true, invoke: (client: McpClient, signal: AbortSignal) => client.ping({ signal }) },
  { method: "subscriptions/listen", invoke: (client: McpClient, signal: AbortSignal) => client.subscribe("file:///value", { signal }) },
  { method: "resources/subscribe", legacy: true, invoke: (client: McpClient, signal: AbortSignal) => client.subscribe("file:///value", { signal }) },
  { method: "resources/unsubscribe", legacy: true, invoke: (client: McpClient, signal: AbortSignal) => client.unsubscribe("file:///value", { signal }) }
];

it("cancels a duplicate modern subscription waiter without canceling its owner", async () => {
  const pair = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(pair.serverTransport.readable, pair.serverTransport.writable);
  const client = new McpClient({ clientInfo: { name: "duplicate-cancel", version: "1" } });
  server.onRequest("server/discover", () => ({ resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { resources: {} }, ttlMs: 0, cacheScope: "private" }));
  const entered = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<unknown>();
  server.onRequest("subscriptions/listen", () => { entered.resolve(); return reply.promise; });
  const controller = new AbortController();
  const reason = new Error("cancel duplicate waiter");
  let ownerOutcome: unknown;
  let owner: Promise<unknown> | undefined;
  let duplicate: Promise<unknown> | undefined;
  try {
    await client.connect(pair.clientTransport);
    owner = client.subscribe("file:///value").then(() => "resolved", (error: unknown) => error).then(value => { ownerOutcome = value; return value; });
    await entered.promise;
    duplicate = client.subscribe("file:///value", { signal: controller.signal }).then(() => "resolved", (error: unknown) => error);
    controller.abort(reason);
    expect(await Promise.race([duplicate, setImmediate().then(() => "still pending")])).toBe(reason);
    expect(ownerOutcome).toBeUndefined();
  } finally {
    await client.close();
    reply.resolve({});
    server.dispose(); pair.clientTransport.dispose();
    await Promise.all([owner, duplicate]);
  }
});

it.each(requestCases)("cancels pending $method requests with the original reason", async ({ method, legacy, invoke }) => {
  const pair = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(pair.serverTransport.readable, pair.serverTransport.writable);
  const client = new McpClient({ clientInfo: { name: "request-cancel", version: "1" }, ...(legacy ? { protocolVersion: "2025-03-26" as const } : {}) });
  const capabilities = { resources: { subscribe: true }, prompts: {}, completions: {}, logging: {} };
  server.onRequest("server/discover", () => ({ resultType: "complete", supportedVersions: ["2026-07-28"], capabilities, ttlMs: 0, cacheScope: "private" }));
  server.onRequest("initialize", () => ({ protocolVersion: "2025-03-26", capabilities, serverInfo: { name: "server", version: "1" } }));
  const entered = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<unknown>();
  server.onRequest(method, () => { entered.resolve(); return reply.promise; });
  const controller = new AbortController();
  const reason = new Error("cancel request");
  let operation: Promise<unknown> | undefined;
  try {
    await client.connect(pair.clientTransport);
    operation = invoke(client, controller.signal);
    const observed = operation.then(() => "resolved", (error: unknown) => error);
    await entered.promise;
    controller.abort(reason);
    expect(await Promise.race([observed, setImmediate().then(() => "still pending")])).toBe(reason);
    expect(client.state).toBe("ready");
  } finally {
    reply.resolve({});
    server.dispose(); pair.clientTransport.dispose();
    await operation?.catch(() => undefined);
  }
});

it.each(["server/discover", "initialize", "subscriptions/listen", "tools/list"])("cancels pending %s without waiting for the server", async (method) => {
  const { clientTransport, serverTransport } = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(serverTransport.readable, serverTransport.writable);
  const client = new McpClient({ clientInfo: { name: "cancel", version: "1" }, ...(method === "subscriptions/listen" ? { onToolsChanged: async () => {} } : {}) });
  const entered = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<unknown>();
  const controller = new AbortController();
  const reason = new Error("cancel setup");
  server.onRequest("server/discover", () => ({ resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, ttlMs: 0, cacheScope: "private" }));
  if (method === "initialize") server.onRequest("server/discover", () => { throw new Error("legacy only"); });
  server.onRequest(method, () => { entered.resolve(); return reply.promise; });
  let operation: Promise<unknown> | undefined;
  try {
    if (method === "tools/list") {
      await client.connect(clientTransport);
      operation = client.listTools({}, { signal: controller.signal });
    } else operation = client.connect(clientTransport, { signal: controller.signal });
    const observed = operation.then(() => "resolved", (error: unknown) => error);
    await entered.promise;
    controller.abort(reason);
    expect(await Promise.race([observed, setImmediate().then(() => "still pending")])).toBe(reason);
    if (method !== "tools/list") expect(client.state).toBe("disconnected");
  } finally {
    reply.resolve({});
    server.dispose(); clientTransport.dispose();
    await operation?.catch(() => undefined);
  }
});
