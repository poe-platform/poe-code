import { expect, it } from "vitest";
import { createHttpServer, defineSchema } from "./index.js";

it.each(["tool", "registerTool"])(
  "%s preserves the core request context for HTTP tool handlers",
  async (registration) => {
    const server = createHttpServer({ name: "context", version: "1" });
    let context: unknown;
    const handler = (_args: unknown, request: unknown) => {
      context = request;
      return "done";
    };
    if (registration === "tool") server.tool("retry", "Retry", defineSchema({}), handler);
    else
      server.registerTool(
        { name: "retry", description: "Retry", inputSchema: { type: "object" } },
        handler
      );
    await server.handleMessage("tools/call", {
      name: "retry",
      requestState: "opaque",
      inputResponses: {},
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    });
    expect(context).toMatchObject({
      request: expect.any(Object),
      signal: expect.any(AbortSignal),
      requestState: "opaque",
      inputResponses: {},
      clientCapabilities: {}
    });
  }
);
