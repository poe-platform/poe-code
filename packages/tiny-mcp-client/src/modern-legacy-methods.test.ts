import { expect, it, vi } from "vitest";
import { createInMemoryTransportPair, JsonRpcMessageLayer, McpClient } from "./internal.js";

it("uses discovery for modern connection health instead of the removed ping method", async () => {
  const pair = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(pair.serverTransport.readable, pair.serverTransport.writable);
  const discover = vi.fn(() => ({ resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: {}, ttlMs: 0, cacheScope: "private" }));
  const ping = vi.fn(() => ({ resultType: "complete" }));
  server.onRequest("server/discover", discover);
  server.onRequest("ping", ping);
  const client = new McpClient({ clientInfo: { name: "health", version: "1" } });
  try {
    await client.connect(pair.clientTransport);
    await client.ping();
    expect(discover).toHaveBeenCalledTimes(2);
    expect(ping).not.toHaveBeenCalled();
  } finally { await client.close(); server.dispose(); }
});

it("rejects modern log-level changes before sending the removed wire method", async () => {
  const pair = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(pair.serverTransport.readable, pair.serverTransport.writable);
  server.onRequest("server/discover", () => ({ resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { logging: {} }, ttlMs: 0, cacheScope: "private" }));
  const change = vi.fn(() => ({ resultType: "complete" }));
  server.onRequest("logging/setLevel", change);
  const client = new McpClient({ clientInfo: { name: "logging", version: "1" } });
  try {
    await client.connect(pair.clientTransport);
    await expect(client.setLogLevel("info")).rejects.toThrow("legacy MCP");
    expect(change).not.toHaveBeenCalled();
  } finally { await client.close(); server.dispose(); }
});
