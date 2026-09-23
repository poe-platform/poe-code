import { describe, expect, it } from "vitest";
import { createFetchServer, defineSchema } from "./fetch.js";

function request(method: string, params?: Record<string, unknown>, options: RequestInit = {}) {
  return new Request("https://mcp.example/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    ...options
  });
}

describe("Fetch-native stateless MCP", () => {
  it("initializes, discovers tools, and passes typed results through", async () => {
    const server = createFetchServer({ name: "fetch-test", version: "1" })
      .tool("echo", "Echo text", defineSchema({ text: { type: "string" } }), ({ text }) => text);
    const initialized = await server.fetch(request("initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
    }));
    expect(initialized.headers.has("mcp-session-id")).toBe(false);
    expect((await initialized.json()).result).toMatchObject({ protocolVersion: "2025-11-25" });
    const listed = await server.fetch(request("tools/list"));
    expect((await listed.json()).result.tools).toMatchObject([{ name: "echo" }]);
    const called = await server.fetch(request("tools/call", { name: "echo", arguments: { text: "hello" } }));
    expect((await called.json()).result.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("does not execute tool notifications", async () => {
    let calls = 0;
    const server = createFetchServer({ name: "test", version: "1" })
      .tool("charge", "Charge", defineSchema({}), () => { calls++; return "charged"; });
    const response = await server.fetch(request("ignored", undefined, {
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "charge", arguments: {} } })
    }));
    expect(response.status).toBe(202);
    expect(calls).toBe(0);
  });

  it("isolates trusted context for concurrent callers using the same RPC id", async () => {
    const server = createFetchServer<{ userId: string }>({ name: "test", version: "1" })
      .tool("identity", "Identity", defineSchema({}), async (_, context) => {
        await Promise.resolve();
        return context.context.userId;
      });
    const responses = await Promise.all(["alice", "bob"].map(userId =>
      server.fetch(request("tools/call", { name: "identity", arguments: {}, _meta: { userId: "victim" } }), { userId })
    ));
    expect(await Promise.all(responses.map(async response => (await response.json()).result.content[0].text)))
      .toEqual(["alice", "bob"]);
  });

  it("rejects oversized streamed bodies before executing tools", async () => {
    const server = createFetchServer({ name: "test", version: "1", maxRequestBytes: 32 });
    const response = await server.fetch(request("tools/list"));
    expect(response.status).toBe(413);
  });

  it.each(["GET", "DELETE", "PUT"])("rejects %s with the stateless Allow header", async method => {
    const server = createFetchServer({ name: "test", version: "1" });
    const response = await server.fetch(new Request("https://mcp.example/mcp", { method }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("validates media types and JSON without invoking tools", async () => {
    const server = createFetchServer({ name: "test", version: "1" });
    expect((await server.fetch(request("ping", undefined, { headers: { "content-type": "text/plain" } }))).status).toBe(415);
    expect((await server.fetch(request("ping", undefined, { headers: { "content-type": "application/json", accept: "text/html" } }))).status).toBe(406);
    const response = await server.fetch(request("ping", undefined, { body: "{" }));
    expect((await response.json()).error.code).toBe(-32700);
  });

  it("rejects batches atomically and keeps errors free of handler secrets", async () => {
    let calls = 0;
    const server = createFetchServer({ name: "test", version: "1" })
      .tool("fail", "Fail", defineSchema({}), () => { calls++; throw new Error("secret-token"); });
    const message = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fail", arguments: {} } };
    const batch = await server.fetch(request("ignored", undefined, { body: JSON.stringify([message]) }));
    expect(batch.status).toBe(400);
    expect(calls).toBe(0);
    expect(await (await server.fetch(request("tools/call", message.params))).text()).not.toContain("secret-token");
  });
});
