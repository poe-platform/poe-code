import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createFetchServer, defineSchema } from "./fetch.js";

describe("Fetch transport interoperability and lifetime", () => {
  it("connects the official SDK and returns standards-compliant image resources", async () => {
    const server = createFetchServer<{ userId: string }>({ name: "images", version: "1" })
      .tool("generate_image", "Generate an image", defineSchema({ prompt: { type: "string" } }),
        (_, { context }) => ({ content: [
          { type: "text", text: context.userId },
          { type: "resource_link", name: "image.png", uri: "https://example.com/image.png", mimeType: "image/png" }
        ] }));
    const client = new Client({ name: "sdk-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL("https://example.com/mcp"), {
      fetch: (input, init) => server.fetch(new Request(input, init), { userId: "alice" })
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(["generate_image"]);
      expect(await client.callTool({ name: "generate_image", arguments: { prompt: "a cat" } })).toMatchObject({
        content: [{ type: "text", text: "alice" }, { type: "resource_link", mimeType: "image/png" }]
      });
    } finally { await client.close(); }
  });

  it("propagates caller cancellation to the running tool", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    let toolSignal: AbortSignal | undefined;
    const server = createFetchServer({ name: "cancel", version: "1" })
      .tool("wait", "Wait", defineSchema({}), (_, { signal }) => new Promise<string>(resolve => {
        toolSignal = signal;
        signal.addEventListener("abort", () => resolve("cancelled"), { once: true });
        started();
      }));
    const response = server.fetch(new Request("https://example.com/mcp", {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait", arguments: {} } })
    }));
    await running;
    controller.abort();
    await expect(response).rejects.toThrow();
    expect(toolSignal?.aborted).toBe(true);
  });

  it("rejects cross-origin requests before reading their bodies", async () => {
    const server = createFetchServer({ name: "origins", version: "1" });
    const result = await server.fetch(new Request("https://example.com/mcp", {
      method: "POST", headers: { origin: "https://evil.example" }, body: "not JSON"
    }));
    expect(result.status).toBe(403);
  });

  it("rejects modern request metadata without matching transport headers", async () => {
    const server = createFetchServer({ name: "headers", version: "1" });
    const response = await server.fetch(new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      } } })
    }));
    expect(response.status).toBe(400);
  });
});
