import { expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { createHttpServer } from "./index.js";
import { createFetchServer } from "./fetch.js";

it("uses standard schemas through HTTP tool registration", async () => {
  const server = createHttpServer({ name: "standard-http", version: "1" });
  server.registerTool({ name: "count", inputSchema: S.Object({ count: S.Optional(S.Number({ default: 3 })) }), outputSchema: S.Object({ count: S.Number() }) }, ({ count }) => ({ count }));
  await server.handleMessage("initialize", {});
  expect(await server.handleMessage("tools/call", { name: "count", arguments: {} })).toMatchObject({ result: { structuredContent: { count: 3 } } });
});

it("parses standard schemas through Fetch HTTP requests", async () => {
  const server = createFetchServer({ name: "standard-fetch", version: "1" })
    .tool("count", "Count", S.Object({ count: S.Optional(S.Number({ default: 3 })) }), ({ count }) => String(count));
  const response = await server.fetch(new Request("https://example.test/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "count", arguments: {} } })
  }));
  expect(await response.json()).toMatchObject({ result: { content: [{ text: "3" }] } });
});
