import { describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import type { CallToolResult } from "tiny-stdio-mcp-server";
import * as toolcraft from "./index.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";

async function invokeMCP(command: toolcraft.Command<any, any, any, any>, casing: "snake" | "camel" = "snake") {
  const server = createMCPServer(toolcraft.defineGroup({ name: "audit", children: [command] }), {
    name: "audit", version: "1", casing, errorReports: false
  });
  const session = server.createMessageSession(() => {});
  try {
    await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    await session.handleMessage("notifications/initialized");
    return await session.handleMessage("tools/call", { name: "audit__check", arguments: {} });
  } finally {
    session.close();
  }
}

describe("explicit MCP result ownership", () => {
  it("tags a copy without changing enumerable fields, references, or the source", () => {
    const original = Object.freeze({
      content: [{ type: "text" as const, text: "message" }],
      structuredContent: { result: "value", cursor: "next" },
      _meta: { request: "one" }
    });
    const result = toolcraft.asMCPResult(original);
    expect(result).not.toBe(original);
    expect(result).toStrictEqual(original);
    expect(result.content).toBe(original.content);
    expect(result.structuredContent).toBe(original.structuredContent);
    expect(result._meta).toBe(original._meta);
    expect(Object.keys(result)).toEqual(Object.keys(original));
    expect(JSON.stringify(result)).toBe(JSON.stringify(original));
    expect(Object.getOwnPropertySymbols(original)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(result, Symbol.for("toolcraft.mcp-result"))).toMatchObject({ value: true, enumerable: false });
    expect(toolcraft.asMCPResult(result)).toStrictEqual(original);
  });

  it.each([null, undefined, 0, "text", [], {}, { content: "domain" }])("rejects non-envelope input %j", (value) => {
    expect(() => toolcraft.asMCPResult(value as never)).toThrow("MCP results must contain a content array");
  });
});

describe.each([false, true])("protocol failures with declared success schema: %s", (typed) => {
  const failures: Array<{ name: string; envelope: CallToolResult & { _meta?: unknown }; message: string }> = [
    { name: "text only", envelope: { content: [{ type: "text", text: "upstream unavailable" }], isError: true }, message: "upstream unavailable" },
    { name: "matching diagnostic", envelope: { content: [{ type: "text", text: "upstream unavailable" }], structuredContent: { id: "diagnostic" }, isError: true }, message: "upstream unavailable" },
    { name: "non-success payload", envelope: { content: [{ type: "text", text: "first" }, { type: "text", text: "second" }], structuredContent: { reason: "retry-later" }, isError: true, _meta: { trace: "request" } }, message: "first\nsecond" },
    { name: "structured only", envelope: { content: [], structuredContent: { reason: "retry-later" }, isError: true }, message: '{"reason":"retry-later"}' },
    { name: "empty failure", envelope: { content: [], isError: true }, message: "Upstream tool failed." }
  ];

  describe.each(failures)("$name", ({ envelope, message }) => {
    it("preserves the MCP error and bypasses success-only transforms and validation", async () => {
      const marked = toolcraft.asMCPResult(envelope);
      const handler = vi.fn(() => marked);
      const mcpResult = vi.fn(() => { throw new Error("Success transform must not run"); });
      const command = toolcraft.defineCommand({
        name: "check", scope: ["mcp"], params: S.Object({}),
        ...(typed ? { result: S.Object({ id: S.String() }), mcpResult } : {}), handler
      });
      const response = await invokeMCP(command);
      expect(response.error).toBeUndefined();
      expect(response.result).toStrictEqual(envelope);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(mcpResult).not.toHaveBeenCalled();
    });

    it("rejects typed SDK failures and preserves the untyped envelope contract", async () => {
      const marked = toolcraft.asMCPResult(envelope);
      const handler = vi.fn(() => marked);
      const command = toolcraft.defineCommand({
        name: "check", params: S.Object({}),
        ...(typed ? { result: S.Object({ id: S.String() }) } : {}), handler
      });
      const sdk = createSDK(toolcraft.defineGroup({ name: "audit", children: [command] }), { errorReports: false });
      if (typed) {
        await expect(sdk.check({})).rejects.toMatchObject({ name: "UserError", message, cause: marked });
      } else {
        await expect(sdk.check({})).resolves.toBe(marked);
      }
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});

describe("successful and ordinary results", () => {
  it("forwards an explicitly marked untyped success without a second protocol wrapper", async () => {
    const envelope = toolcraft.asMCPResult({ content: [{ type: "text", text: "upstream text" }], structuredContent: { id: "one" }, _meta: { trace: "request" } });
    const command = toolcraft.defineCommand({ name: "check", scope: ["mcp"], params: S.Object({}), handler: () => envelope });
    expect((await invokeMCP(command)).result).toStrictEqual(envelope);
  });

  it.each(["snake", "camel"] as const)("validates and serializes marked typed successes in %s casing", async (casing) => {
    const envelope = toolcraft.asMCPResult({ content: [{ type: "text", text: "upstream text" }], structuredContent: { "display-name": "one" }, _meta: { trace: "request" } });
    const command = toolcraft.defineCommand({ name: "check", scope: ["mcp"], params: S.Object({}), result: S.Object({ "display-name": S.String() }), handler: () => envelope });
    const response = await invokeMCP(command, casing);
    expect(response.error).toBeUndefined();
    expect(response.result).toStrictEqual({ ...envelope, structuredContent: { [casing === "snake" ? "display_name" : "displayName"]: "one" } });
    expect(envelope.structuredContent).toStrictEqual({ "display-name": "one" });
  });

  it.each([undefined, { wrong: "field" }, { id: 42 }])("still rejects malformed marked typed successes %j", async (structuredContent) => {
    const envelope = toolcraft.asMCPResult({ content: [], ...(structuredContent === undefined ? {} : { structuredContent }) });
    const command = toolcraft.defineCommand({ name: "check", scope: ["mcp"], params: S.Object({}), result: S.Object({ id: S.String() }), handler: () => envelope });
    const response = await invokeMCP(command);
    expect(response.error).toMatchObject({ code: -32603 });
    expect(response.result).toBeUndefined();
  });

  it("passes the actual envelope to a declared MCP success transform", async () => {
    const envelope = toolcraft.asMCPResult({ content: [{ type: "text", text: "upstream text" }], structuredContent: { upstreamId: "one" } });
    const transform = vi.fn((result: typeof envelope) => ({ id: result.structuredContent.upstreamId }));
    const command = toolcraft.defineCommand({ name: "check", scope: ["mcp"], params: S.Object({}), result: S.Object({ id: S.String() }), handler: () => envelope, mcpResult: transform });
    const response = await invokeMCP(command);
    expect(response.result).toStrictEqual({ ...envelope, structuredContent: { id: "one" } });
    expect(transform).toHaveBeenCalledWith(envelope);
  });

  it.each([false, true])("does not interpret unmarked domain fields as protocol errors with schema %s", async (typed) => {
    const value = { content: [], isError: true };
    const command = toolcraft.defineCommand({ name: "check", scope: ["sdk", "mcp"], params: S.Object({}), ...(typed ? { result: S.Object({ content: S.Json(), isError: S.Boolean() }) } : {}), handler: () => value });
    const root = toolcraft.defineGroup({ name: "audit", children: [command] });
    await expect(createSDK(root, { errorReports: false }).check({})).resolves.toBe(value);
    const response = await invokeMCP(command);
    expect(response.error).toBeUndefined();
    expect(response.result).not.toHaveProperty("isError", true);
    const envelope = response.result as CallToolResult;
    if (typed) expect(envelope.structuredContent).toEqual({ content: [], is_error: true });
    else expect(envelope.content).toEqual([{ type: "text", text: JSON.stringify(value) }]);
  });
});
