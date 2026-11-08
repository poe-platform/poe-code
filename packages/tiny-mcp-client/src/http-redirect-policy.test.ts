import { expect, it, onTestFinished, vi } from "vitest";
import { HttpTransport, McpClient } from "./internal.js";
import { discoverOAuthMetadata } from "./oauth-discovery.js";

it("disables automatic redirects for authenticated MCP requests", async () => {
  const redirects: unknown[] = [];
  const transport = new HttpTransport({ url: "https://example.test/mcp", fetch: async (_url, init) => {
    redirects.push(init?.redirect);
    const request = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: {}, ttlMs: 0, cacheScope: "private"
    } });
  } });
  onTestFinished(() => transport.dispose());
  await new McpClient({ clientInfo: { name: "test", version: "1" } }).connect(transport);
  expect(redirects).toEqual(["error"]);
});

it("rejects redirected MCP responses from injected fetch adapters and cancels their bodies", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }));
  Object.defineProperty(response, "redirected", { value: true });
  const transport = new HttpTransport({ url: "https://example.test/mcp", fetch: async () => response });
  onTestFinished(() => transport.dispose());
  const client = new McpClient({ clientInfo: { name: "test", version: "1" }, requestTimeoutMs: 50 });
  await expect(client.connect(transport)).rejects.toThrow("redirect");
  expect(cancel).toHaveBeenCalledOnce();
});

it("disables redirects for every OAuth metadata discovery candidate", async () => {
  const redirects: unknown[] = [];
  const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    redirects.push(init?.redirect);
    return new Response(null, { status: 404 });
  });
  await expect(discoverOAuthMetadata("https://example.test/mcp", { fetch })).rejects.toThrow("404");
  expect(redirects).toEqual(["error", "error"]);
});

it("rejects redirected OAuth metadata before consuming it", async () => {
  const response = Response.json({});
  const cancel = vi.spyOn(response.body!, "cancel");
  Object.defineProperty(response, "redirected", { value: true });
  await expect(discoverOAuthMetadata("https://example.test/mcp", {
    resourceMetadataUrl: "https://example.test/metadata", fetch: async () => response
  })).rejects.toThrow("redirect");
  expect(cancel).toHaveBeenCalledOnce();
});
