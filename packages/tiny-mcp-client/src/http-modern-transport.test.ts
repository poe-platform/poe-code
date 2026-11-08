import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer, McpError } from "./index.js";

const params = {
  name: "世界",
  _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {}
  }
};

it("mirrors modern standard headers and ignores obsolete response sessions", async () => {
  const methods: string[] = [];
  const headers: Headers[] = [];
  const transport = new HttpTransport({
    url: "https://mcp.invalid/modern",
    fetch: async (_url, init) => {
      methods.push(init?.method ?? "");
      if (init?.method !== "POST") return new Response(null, { status: 405 });
      headers.push(new Headers(init.headers));
      const request = JSON.parse(String(init.body));
      return Response.json(
        { jsonrpc: "2.0", id: request.id, result: { resultType: "complete" } },
        { headers: { "Mcp-Session-Id": "obsolete" } }
      );
    }
  });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
  try {
    await layer.sendRequest("tools/call", params);
    expect(headers[0]?.get("MCP-Protocol-Version")).toBe("2026-07-28");
    expect(headers[0]?.get("Mcp-Method")).toBe("tools/call");
    expect(headers[0]?.get("Mcp-Name")).toBe("=?base64?5LiW55WM?=");
  } finally {
    layer.dispose();
    transport.dispose();
  }
  expect(methods).toEqual(["POST"]);
});

it("forwards modern protocol errors without disposing a usable transport", async () => {
  const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    return request.method === "bad"
      ? Response.json(
          { jsonrpc: "2.0", id: request.id, error: { code: -32020, message: "Header mismatch" } },
          { status: 400 }
        )
      : Response.json({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete" } });
  });
  const transport = new HttpTransport({ url: "https://mcp.invalid/modern", fetch });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
  try {
    const failed = await layer.sendRequest("bad", params).catch((error) => error);
    expect(failed).toBeInstanceOf(McpError);
    expect(failed).toMatchObject({ code: -32020 });
    expect(await layer.sendRequest("good", params)).toMatchObject({ resultType: "complete" });
  } finally {
    layer.dispose();
    transport.dispose();
  }
});
