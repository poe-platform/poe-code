import { expect, it } from "vitest";
import { HttpTransport, McpClient } from "./internal.js";

it.each([
  { contentType: "application/jsonp", sse: false, valid: false },
  { contentType: "text/plain; hint=application/json", sse: false, valid: false },
  { contentType: "text/event-streaming", sse: true, valid: false },
  { contentType: "text/plain; hint=text/event-stream", sse: true, valid: false },
  { contentType: "application/json; charset=utf-8", sse: false, valid: true },
  { contentType: "Application/JSON; charset=UTF-8", sse: false, valid: true },
  { contentType: "Text/Event-Stream; charset=UTF-8", sse: true, valid: true }
])("handles the actual response media type $contentType", async ({ contentType, sse, valid }) => {
  let response: Response | undefined;
  const transport = new HttpTransport({ url: "https://mcp.invalid/media", fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, ttlMs: 0, cacheScope: "private"
    } });
    const encoded = JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete", content: [{ type: "text", text: "ready" }] } });
    response = new Response(sse ? `data: ${encoded}\n\n` : encoded, { headers: { "Content-Type": contentType } });
    return response;
  } });
  const client = new McpClient({ clientInfo: { name: "media", version: "1" } });
  try {
    await client.connect(transport);
    const called = client.callTool({ name: "ready" });
    if (valid) await expect(called).resolves.toMatchObject({ content: [{ text: "ready" }] });
    else await expect(called).rejects.toThrow("unsupported response content type");
    expect(response?.body?.locked).toBe(false);
  } finally { await client.close(); await transport.closed; }
});
