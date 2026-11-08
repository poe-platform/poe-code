import { expect, it } from "vitest";
import { createServer, defineSchema } from "./index.js";

const _meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

it.each([
  [{ type: "array", items: { type: "number" } }, [1, 2]],
  [{ type: "string" }, "value"],
  [{ type: "number" }, 0.5],
  [{ type: "boolean" }, false],
  [{ type: "null" }, null],
  [{ anyOf: [{ type: "number" }, { type: "null" }] }, null]
])("validates modern output schema %j and preserves JSON result %j", async (outputSchema, value) => {
  const server = createServer({ name: "outputs", version: "1" });
  server.registerTool({ name: "value", inputSchema: defineSchema({}), outputSchema }, () => value);
  expect(await server.handleMessage("tools/list", { _meta })).toMatchObject({
    result: { tools: [{ name: "value", outputSchema }] }
  });
  expect(await server.handleMessage("tools/call", { name: "value", _meta })).toMatchObject({
    result: { structuredContent: value, resultType: "complete" }
  });
});

it("rejects an array output that fails its item schema", async () => {
  const server = createServer({ name: "outputs", version: "1" });
  server.registerTool({ name: "value", inputSchema: defineSchema({}), outputSchema: {
    type: "array", items: { type: "number" }
  } }, () => ["invalid"]);
  expect(await server.handleMessage("tools/call", { name: "value", _meta })).toMatchObject({
    error: { code: -32603 }
  });
});

it("serves non-object output tools as unstructured content to legacy clients", async () => {
  const server = createServer({ name: "outputs", version: "1" });
  server.registerTool({ name: "value", inputSchema: defineSchema({}), outputSchema: {
    type: "string"
  } }, () => "value");
  await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  const listed = await server.handleMessage("tools/list");
  const tools = (listed.result as { tools: Record<string, unknown>[] }).tools;
  expect(tools[0]).not.toHaveProperty("outputSchema");
  expect(await server.handleMessage("tools/call", { name: "value" })).toMatchObject({
    result: { content: [{ type: "text", text: "value" }] }
  });
});
