import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer, McpClient } from "./index.js";

it("excludes invalid header annotations without losing valid tools", async () => {
  const onWarning = vi.fn();
  const tools = [
    {
      name: "bad",
      inputSchema: {
        type: "object",
        properties: { value: { type: "number", "x-mcp-header": "Value" } }
      }
    },
    {
      name: "good",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string", "x-mcp-header": "Value" } }
      }
    }
  ];
  const transport = new HttpTransport({
    url: "https://mcp.invalid/tools",
    onWarning,
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (request.method.startsWith("notifications/")) return new Response(null, { status: 202 });
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result:
          request.method === "initialize"
            ? {
                protocolVersion: "2025-03-26",
                capabilities: { tools: {} },
                serverInfo: { name: "headers", version: "1" }
              }
            : { tools }
      });
    }
  });
  const client = new McpClient({ protocolVersion: "2025-03-26", clientInfo: { name: "filter", version: "1" } });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["good"]);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("bad"));
  } finally {
    await client.close();
  }
});

it("mirrors cached nested schema annotations on modern HTTP calls", async () => {
  const headers: Headers[] = [];
  const transport = new HttpTransport({
    url: "https://mcp.invalid/parameters",
    fetch: async (_url, init) => {
      headers.push(new Headers(init?.headers));
      const request = JSON.parse(String(init?.body));
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete" } });
    }
  });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
  try {
    transport.filterTools([
      {
        name: "tenant",
        inputSchema: {
          type: "object",
          properties: {
            tenant: {
              type: "object",
              properties: { id: { type: "string", "x-mcp-header": "Tenant" } }
            },
            enabled: { type: "boolean", "x-mcp-header": "Enabled" }
          }
        }
      }
    ]);
    await layer.sendRequest("tools/call", {
      name: "tenant",
      arguments: { tenant: { id: "世界" }, enabled: false },
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    });
    expect(headers[0]?.get("Mcp-Param-Tenant")).toBe("=?base64?5LiW55WM?=");
    expect(headers[0]?.get("Mcp-Param-Enabled")).toBe("false");
  } finally {
    layer.dispose();
    transport.dispose();
  }
});

it("omits recognized template headers when their argument is absent", async () => {
  let received: Headers | undefined;
  const transport = new HttpTransport({
    url: "https://mcp.invalid/parameters",
    headers: { "Mcp-Param-Count": "spoofed" },
    fetch: async (_url, init) => {
      received = new Headers(init?.headers);
      const request = JSON.parse(String(init?.body));
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete" } });
    }
  });
  transport.filterTools([
    {
      name: "check",
      inputSchema: {
        type: "object",
        properties: { count: { type: "integer", "x-mcp-header": "Count" } }
      }
    }
  ]);
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
  try {
    await layer.sendRequest("tools/call", {
      name: "check",
      arguments: {},
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    });
    expect(received?.get("Mcp-Param-Count")).toBeNull();
  } finally {
    layer.dispose();
    transport.dispose();
  }
});

it.each([null, "tool", { inputSchema: { type: "object" } }])(
  "rejects malformed tool entries %j with an MCP error",
  async (tool) => {
    const transport = new HttpTransport({
      url: "https://mcp.invalid/tools",
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        if (request.method.startsWith("notifications/")) return new Response(null, { status: 202 });
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result:
            request.method === "initialize"
              ? {
                  protocolVersion: "2025-03-26",
                  capabilities: { tools: {} },
                  serverInfo: { name: "validation", version: "1" }
                }
              : { tools: [tool] }
        });
      }
    });
    const client = new McpClient({ protocolVersion: "2025-03-26", clientInfo: { name: "validation", version: "1" } });
    try {
      await client.connect(transport);
      expect(await client.listTools().catch((error) => error)).toMatchObject({ code: -32600 });
    } finally {
      await client.close();
    }
  }
);
