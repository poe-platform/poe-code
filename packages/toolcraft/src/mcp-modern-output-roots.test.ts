import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

it("retains resource links returned as native tool content blocks", async () => {
  const link = { type: "resource_link" as const, name: "document", uri: "file:///document" };
  const root = defineGroup({ name: "root", children: [defineCommand({ name: "link", scope: ["mcp"], params: S.Object({}), handler: () => link })] });
  const session = createMCPServer(root, { name: "root", version: "1", errorReports: false }).createMessageSession();
  try {
    expect(await session.handleMessage("tools/call", { _meta: metadata, name: "root__link", arguments: {} }))
      .toMatchObject({ result: { content: [link] } });
  } finally { session.close(); }
});

describe.each(["modern", "legacy"] as const)("Toolcraft %s MCP output roots", (era) => {
  it.each([
    { schema: S.String(), value: "ready", wire: { type: "string" } },
    { schema: S.Number(), value: 1.5, wire: { type: "number" } },
    { schema: S.Boolean(), value: true, wire: { type: "boolean" } },
    { schema: S.Enum([null]), value: null, wire: { type: "null", enum: [null] } },
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
  it("maps a handler result to a scalar without changing its SDK value", async () => {
    const command = defineCommand({
      name: "value", scope: ["mcp", "sdk"], params: S.Object({}), result: S.String(),
      handler: () => ({ display: "ready" }), mcpResult: (result) => result.display
    });
    const root = defineGroup({ name: "root", children: [command] });
    expect(await createSDK(root, { errorReports: false }).value({})).toEqual({ display: "ready" });
    const session = createMCPServer(root, {
      name: "root", version: "1", errorReports: false
    }).createMessageSession(() => undefined);
    try {
      if (era === "legacy") await session.handleMessage("initialize", { protocolVersion: "2025-11-25" });
      const params = era === "modern" ? { _meta: metadata } : {};
      expect(await session.handleMessage("tools/call", { ...params, name: "root__value", arguments: {} }))
        .toMatchObject({ result: { content: [{ type: "text", text: '"ready"' }] } });
    } finally { session.close(); }
  });
});
