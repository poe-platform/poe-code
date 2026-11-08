import { expect, it, onTestFinished, vi } from "vitest";
import { createInMemoryTransportPair, JsonRpcMessageLayer, McpClient } from "./internal.js";

const cases = [
  { label: "negative TTL", changes: { ttlMs: -1 } },
  { label: "fractional TTL", changes: { ttlMs: 0.5 } },
  { label: "string TTL", changes: { ttlMs: "1" } },
  { label: "invalid scope", changes: { cacheScope: "shared" } },
  { label: "missing TTL", omit: "ttlMs", changes: {} },
  { label: "missing scope", omit: "cacheScope", changes: {} }
];

it.each(cases)("rejects discovery cache metadata: $label", async ({ changes, omit }) => {
  const { clientTransport, serverTransport } = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(serverTransport.readable, serverTransport.writable);
  const client = new McpClient({ clientInfo: { name: "test", version: "1" } });
  onTestFinished(() => { server.dispose(); clientTransport.dispose(); });
  const result: Record<string, unknown> = { resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: {}, ttlMs: 0, cacheScope: "private", ...changes };
  if (omit !== undefined) Reflect.deleteProperty(result, omit);
  const initialize = vi.fn(() => ({})); server.onRequest("initialize", initialize);
  server.onRequest("server/discover", () => result);
  await expect(client.connect(clientTransport)).rejects.toMatchObject({ code: -32600, message: expect.stringContaining("cache") });
  expect(initialize).not.toHaveBeenCalled();
});

it.each(cases)("rejects tools/list cache metadata before exposing tools: $label", async ({ changes, omit }) => {
  const { clientTransport, serverTransport } = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(serverTransport.readable, serverTransport.writable);
  const client = new McpClient({ clientInfo: { name: "test", version: "1" } });
  onTestFinished(() => { server.dispose(); clientTransport.dispose(); });
  server.onRequest("server/discover", () => ({ resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, ttlMs: 0, cacheScope: "private" }));
  await client.connect(clientTransport);
  const result: Record<string, unknown> = { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "private", ...changes };
  if (omit !== undefined) Reflect.deleteProperty(result, omit);
  server.onRequest("tools/list", () => result);
  await expect(client.listTools()).rejects.toMatchObject({ code: -32600, message: expect.stringContaining("cache") });
});
