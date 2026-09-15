import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { createMCPServer } from "./mcp.js";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

describe.each(["modern", "legacy"] as const)("Toolcraft %s MCP output roots", (era) => {
  it.each([
    { schema: S.String(), value: "ready", wire: { type: "string" } },
    { schema: S.Number(), value: 1.5, wire: { type: "number" } },
    { schema: S.Boolean(), value: true, wire: { type: "boolean" } },
    { schema: S.Array(S.String()), value: ["ready"], wire: { type: "array", items: { type: "string" } } }
  ])("preserves $wire.type schema and structured result", async ({ schema, value, wire }) => {
    const command = defineCommand({ name: "value", scope: ["mcp"], params: S.Object({}), result: schema, handler: () => value });
    const session = createMCPServer(defineGroup({ name: "root", children: [command] }), {
      name: "root", version: "1", errorReports: false
    }).createMessageSession(() => undefined);
    try {
      if (era === "legacy") await session.handleMessage("initialize", { protocolVersion: "2025-11-25" });
      const params = era === "modern" ? { _meta: metadata } : {};
      const listing = await session.handleMessage("tools/list", params);
      if (era === "modern") expect(listing).toMatchObject({ result: { tools: [{ outputSchema: wire }] } });
      else {
        expect(listing).toMatchObject({ result: { tools: [{ name: "root__value" }] } });
        expect((listing.result as { tools: unknown[] }).tools[0]).not.toHaveProperty("outputSchema");
      }
      const response = await session.handleMessage("tools/call", { ...params, name: "root__value", arguments: {} });
      if (era === "modern") expect(response).toMatchObject({ result: { structuredContent: value } });
      else {
        expect(response).toMatchObject({ result: { content: [{ type: "text", text: JSON.stringify(value) }] } });
        expect(response).not.toHaveProperty("result.structuredContent");
      }
    } finally { session.close(); }
  });
  it.each([
    { schema: S.Array(S.String(), { minItems: 2 }), value: ["one"] },
    { schema: S.Array(S.String(), { maxItems: 1 }), value: ["one", "two"] }
  ])("rejects arrays outside their declared cardinality", async ({ schema, value }) => {
    const command = defineCommand({ name: "value", scope: ["mcp"], params: S.Object({}), result: schema, handler: () => value });
    const session = createMCPServer(defineGroup({ name: "root", children: [command] }), {
      name: "root", version: "1", errorReports: false
    }).createMessageSession(() => undefined);
    try {
      if (era === "legacy") await session.handleMessage("initialize", { protocolVersion: "2025-11-25" });
      const params = era === "modern" ? { _meta: metadata } : {};
      expect(await session.handleMessage("tools/call", { ...params, name: "root__value", arguments: {} }))
        .toMatchObject({ error: { code: -32603 } });
    } finally { session.close(); }
  });
});
