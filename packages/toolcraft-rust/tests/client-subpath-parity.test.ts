import assert from "node:assert/strict";
import { it } from "vitest";
import * as ownClient from "tiny-mcp-client-rust";
import { createServer } from "tiny-stdio-mcp-server-rust";

it("Native client subpath exposes exactly the reference exports with own identities", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/tiny-mcp-client"),
    import("toolcraft/tiny-mcp-client")
  ]);
  assert.deepEqual(Object.keys(native).sort(), Object.keys(reference).sort());
  for (const name of Object.keys(reference)) assert.equal(native[name], ownClient[name], name);
  assert.equal(Object.hasOwn(native, "parseJsonRpcMessage"), false);
});

it("Native client subpath discovers and calls tools through an own in-memory server", async () => {
  const api = await import("toolcraft-rust/tiny-mcp-client");
  const server = createServer({ name: "client-subpath", version: "1" });
  server.registerTool({ name: "echo", inputSchema: { type: "object" } }, (args) => ({
    content: [{ type: "text", text: String(args.message) }]
  }));
  const { client, cleanup } = await api.createTestPair(
    server,
    () => new api.McpClient({ clientInfo: { name: "consumer", version: "1" } })
  );
  try {
    assert.equal(client instanceof ownClient.McpClient, true);
    assert.equal(client.state, "ready");
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      ["echo"]
    );
    const result = await client.callTool({ name: "echo", arguments: { message: "hello" } });
    assert.deepEqual(result.content, [{ type: "text", text: "hello" }]);
  } finally {
    await cleanup();
  }
  assert.equal(client.state, "closed");
});
