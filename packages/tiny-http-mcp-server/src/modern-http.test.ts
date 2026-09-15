import "../vitest.setup.js";
import { expect, it, onTestFinished } from "vitest";
import { createHttpServer, defineSchema } from "./index.js";

const _meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

async function endpoint() {
  const server = createHttpServer({ name: "modern-http", version: "1", enableJsonResponse: true });
  server.tool("echo", "Echo", defineSchema({ value: { type: "string" } }), (args) => args.value);
  const handle = await server.listenHttp();
  onTestFinished(() => handle.close());
  return handle.url;
}

async function post(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(method === "tools/call" ? { "Mcp-Name": "echo" } : {}),
      ...headers
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { _meta, ...params } })
  });
}

it.each(["server/discover", "tools/list"])(
  "serves modern %s without initializing or creating a session",
  async (method) => {
    const response = await post(await endpoint(), method);
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(await response.json()).toMatchObject({ id: 1, result: { resultType: "complete" } });
  }
);

it("ignores obsolete session IDs on a modern call", async () => {
  const response = await post(
    await endpoint(),
    "tools/call",
    { name: "echo", arguments: { value: "hello" } },
    { "Mcp-Session-Id": "obsolete" }
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("mcp-session-id")).toBeNull();
  expect(await response.json()).toMatchObject({
    result: { content: [{ type: "text", text: "hello" }], resultType: "complete" }
  });
});

it.each([
  { "Mcp-Method": "tools/call" },
  { "MCP-Protocol-Version": "2025-11-25" },
  { "Mcp-Method": "" },
  { "MCP-Protocol-Version": "" }
])("rejects mismatched standard headers %j", async (headers) => {
  const response = await post(await endpoint(), "tools/list", {}, headers);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: -32020 } });
});

it("requires client capabilities on modern HTTP requests", async () => {
  const response = await post(await endpoint(), "tools/list", {
    _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" }
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: -32602 } });
});

it("returns HTTP 400 when a handler requires an undeclared capability", async () => {
  const server = createHttpServer({ name: "capabilities", version: "1", enableJsonResponse: true });
  server.tool("echo", "Echo", defineSchema({}), () => ({
    resultType: "input_required",
    inputRequests: { roots: { method: "roots/list" } }
  }));
  const handle = await server.listenHttp();
  onTestFinished(() => handle.close());
  const response = await post(handle.url, "tools/call", { name: "echo" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: -32021, data: { requiredCapabilities: { roots: {} } } }
  });
});

it.each(["GET", "DELETE"])("rejects removed modern %s transport routes", async (method) => {
  const response = await fetch(await endpoint(), {
    method,
    headers: { "MCP-Protocol-Version": "2026-07-28", Accept: "text/event-stream" }
  });
  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("POST, OPTIONS");
});

it("rejects singleton batches on modern HTTP", async () => {
  const response = await fetch(await endpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/list"
    },
    body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta } }])
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: -32600 } });
});
