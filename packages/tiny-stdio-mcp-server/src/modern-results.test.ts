import { describe, expect, it, vi } from "vitest";
import { createServer, defineSchema } from "./index.js";

const params = {
  _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {}
  }
};

describe("modern MCP result validation", () => {
  it("rejects hidden serialization hooks in modern structured content", async () => {
    const toJSON = vi.fn(() => "different wire value");
    const structuredContent = Object.defineProperty({ value: 1 }, "toJSON", { value: toJSON });
    const server = createServer({ name: "results", version: "1" }).registerTool(
      { name: "json", inputSchema: defineSchema({}) },
      () => ({ content: [], structuredContent })
    );
    expect(await server.handleMessage("tools/call", { name: "json", ...params })).toMatchObject({ result: { isError: true } });
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("rejects structured content accessors without executing them", async () => {
    const getter = vi.fn(() => "value");
    const structuredContent = Object.defineProperty({}, "value", { enumerable: true, get: getter });
    const server = createServer({ name: "results", version: "1" }).registerTool(
      { name: "json", inputSchema: defineSchema({}) },
      () => ({ content: [], structuredContent })
    );
    expect(await server.handleMessage("tools/call", { ...params, name: "json" })).toMatchObject({
      result: { isError: true }
    });
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([null, true, 42, "result", [1, { nested: [false] }]].map((value) => [value]))(
    "preserves spec-legal JSON structured content %j",
    async (structuredContent) => {
      const server = createServer({ name: "results", version: "1" }).registerTool(
        { name: "json", inputSchema: defineSchema({}) },
        () => ({ content: [], structuredContent }) as never
      );
      expect(await server.handleMessage("tools/call", { ...params, name: "json" })).toMatchObject({
        result: { content: [], structuredContent, resultType: "complete" }
      });
    }
  );

  it.each([Infinity, NaN, { value: undefined }, { value: BigInt(1) }])(
    "rejects non-JSON structured content %s",
    async (structuredContent) => {
      const server = createServer({ name: "results", version: "1" }).registerTool(
        { name: "json", inputSchema: defineSchema({}) },
        () => ({ content: [], structuredContent }) as never
      );
      expect(await server.handleMessage("tools/call", { ...params, name: "json" })).toMatchObject({
        result: { isError: true }
      });
    }
  );

  it("rejects cyclic structured content without overflowing or serializing a cycle", async () => {
    const structuredContent: Record<string, unknown> = {};
    structuredContent.self = structuredContent;
    const server = createServer({ name: "results", version: "1" }).registerTool(
      { name: "json", inputSchema: defineSchema({}) },
      () => ({ content: [], structuredContent })
    );
    expect(await server.handleMessage("tools/call", { ...params, name: "json" })).toMatchObject({
      result: { isError: true }
    });
  });
  it("rejects an undefined custom-method result instead of leaving the request unanswered", async () => {
    const server = createServer({ name: "results", version: "1" }).method(
      "custom",
      () => undefined
    );
    expect(await server.handleMessage("custom", params)).toMatchObject({ error: { code: -32603 } });
  });
  it.each(["unknown", null, 123])("rejects unrecognized resultType %s", async (resultType) => {
    const server = createServer({ name: "results", version: "1" }).method("custom", () => ({
      resultType
    }));
    expect(await server.handleMessage("custom", params)).toMatchObject({ error: { code: -32603 } });
  });

  it.each([-1, 1.5, Infinity, "100", Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid resource cache TTL %s",
    async (ttlMs) => {
      const server = createServer({ name: "results", version: "1" }).resource(
        { uri: "memo://hello", name: "hello" },
        () => ({ contents: [{ uri: "memo://hello", text: "hello" }], ttlMs })
      );
      expect(
        await server.handleMessage("resources/read", { ...params, uri: "memo://hello" })
      ).toMatchObject({ error: { code: -32603 } });
    }
  );

  it("rejects invalid resource cache scope", async () => {
    const server = createServer({ name: "results", version: "1" }).resource(
      { uri: "memo://hello", name: "hello" },
      () => ({ contents: [{ uri: "memo://hello", text: "hello" }], cacheScope: "shared" })
    );
    expect(
      await server.handleMessage("resources/read", { ...params, uri: "memo://hello" })
    ).toMatchObject({ error: { code: -32603 } });
  });

  it("preserves valid author cache hints and extra response metadata", async () => {
    const server = createServer({ name: "results", version: "1" }).resource(
      { uri: "memo://hello", name: "hello" },
      () => ({
        contents: [{ uri: "memo://hello", text: "hello" }],
        ttlMs: 1000,
        cacheScope: "public",
        _meta: { "example.com/receipt": "valid" }
      })
    );
    expect(
      await server.handleMessage("resources/read", { ...params, uri: "memo://hello" })
    ).toMatchObject({
      result: {
        ttlMs: 1000,
        cacheScope: "public",
        _meta: {
          "example.com/receipt": "valid",
          "io.modelcontextprotocol/serverInfo": { name: "results", version: "1" }
        }
      }
    });
  });

  it("uses Invalid Params for modern missing resources", async () => {
    const server = createServer({ name: "results", version: "1" });
    expect(
      await server.handleMessage("resources/read", { ...params, uri: "memo://missing" })
    ).toMatchObject({ error: { code: -32602 } });
  });
});
