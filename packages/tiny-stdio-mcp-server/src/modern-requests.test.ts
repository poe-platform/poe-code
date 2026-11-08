import { describe, expect, it, vi } from "vitest";
import { createServer, defineSchema } from "./index.js";

function params(values: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...values,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  };
}

describe("modern stateless MCP requests", () => {
  it.each([{ roots: false }, { sampling: [] }, { elicitation: { url: true } }])(
    "rejects malformed declared client capabilities %j",
    async (capabilities) => {
      const server = createServer({ name: "modern", version: "1" });
      expect(await server.handleMessage("tools/list", {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": capabilities
        }
      })).toMatchObject({ error: { code: -32602 } });
    }
  );
  it.each(["tools/list", "prompts/list", "resources/list", "resources/templates/list"])(
    "%s works before initialization and carries complete-result metadata and cache hints",
    async (method) => {
      const server = createServer({ name: "modern", version: "1" });
      expect(await server.handleMessage(method, params())).toMatchObject({
        result: {
          resultType: "complete",
          ttlMs: 0,
          cacheScope: "private",
          _meta: { "io.modelcontextprotocol/serverInfo": { name: "modern", version: "1" } }
        }
      });
      expect(await server.handleMessage(method)).toMatchObject({
        error: { message: "Server not initialized" }
      });
    }
  );

  it("calls tools without initializing the connection or altering argument payloads", async () => {
    const handler = vi.fn(({ value }: { value: string }) => value);
    const server = createServer({ name: "modern", version: "1" }).tool(
      "echo",
      "Echo",
      defineSchema({ value: { type: "string" } }),
      handler
    );
    expect(
      await server.handleMessage(
        "tools/call",
        params({ name: "echo", arguments: { value: "hello" } })
      )
    ).toMatchObject({
      result: {
        resultType: "complete",
        content: [{ type: "text", text: "hello" }]
      }
    });
    expect(handler).toHaveBeenCalledWith(
      { value: "hello" },
      expect.objectContaining({ signal: expect.any(AbortSignal), clientCapabilities: {} })
    );
  });

  it("adds caching hints to resource contents", async () => {
    const server = createServer({ name: "modern", version: "1" }).resource(
      { uri: "memo://hello", name: "hello" },
      () => ({ contents: [{ uri: "memo://hello", text: "hello" }] })
    );
    expect(
      await server.handleMessage("resources/read", params({ uri: "memo://hello" }))
    ).toMatchObject({
      result: {
        resultType: "complete",
        ttlMs: 0,
        cacheScope: "private",
        contents: [{ text: "hello" }]
      }
    });
  });

  it("rejects missing declared client capabilities", async () => {
    const server = createServer({ name: "modern", version: "1" });
    expect(
      await server.handleMessage("tools/list", {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28"
        }
      })
    ).toMatchObject({ error: { code: -32602 } });
  });

  it("rejects an unsupported per-request version even on an initialized legacy connection", async () => {
    const server = createServer({ name: "modern", version: "1" });
    await server.handleMessage("initialize");
    expect(
      await server.handleMessage("tools/list", {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "1900-01-01",
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      })
    ).toMatchObject({ error: { code: -32022, data: { requested: "1900-01-01" } } });
  });

  it.each([
    "initialize",
    "ping",
    "resources/subscribe",
    "resources/unsubscribe",
    "logging/setLevel"
  ])("rejects removed method %s for modern requests", async (method) => {
    const server = createServer({ name: "modern", version: "1" });
    expect(await server.handleMessage(method, params())).toMatchObject({ error: { code: -32601 } });
  });
});
