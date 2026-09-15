import "../vitest.setup.js";
import { expect, it } from "vitest";
import { createHttpServer } from "./index.js";

it.each([
  { headers: {}, rejected: true },
  { headers: { "Mcp-Param-Tenant": "wrong" }, rejected: true },
  { headers: { "Mcp-Param-Tenant": "=?base64?5LiW55WM?=" }, rejected: false }
])(
  "validates recognized parameter headers before executing the tool: %j",
  async ({ headers, rejected }) => {
    const server = createHttpServer({ name: "parameters", version: "1", enableJsonResponse: true });
    let called = false;
    server.registerTool(
      {
        name: "tenant",
        description: "Tenant",
        inputSchema: {
          type: "object",
          properties: {
            tenant: {
              type: "object",
              properties: { id: { type: "string", "x-mcp-header": "Tenant" } }
            }
          }
        }
      },
      () => {
        called = true;
        return "done";
      }
    );
    const handle = await server.listenHttp();
    try {
      const response = await fetch(handle.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/call",
          "Mcp-Name": "tenant",
          ...headers
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "tenant",
            arguments: { tenant: { id: "世界" } },
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {}
            }
          }
        })
      });
      expect(called).toBe(!rejected);
      expect(response.status).toBe(rejected ? 400 : 200);
      if (rejected) expect(await response.json()).toMatchObject({ error: { code: -32020 } });
    } finally {
      await handle.close();
    }
  }
);
