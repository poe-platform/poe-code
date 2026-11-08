import { expect, it, vi } from "vitest";
import { HttpTransport, McpClient } from "./internal.js";

it.each([
  { name: "invalid lead", bytes: [0xff], truncated: false },
  { name: "overlong encoding", bytes: [0xc0, 0xaf], truncated: false },
  { name: "encoded surrogate", bytes: [0xed, 0xa0, 0x80], truncated: false },
  { name: "truncated EOF", bytes: [0xf0, 0x9f], truncated: true }
])("rejects SSE $name bytes and releases the response reader", async ({ bytes, truncated }) => {
  const cancel = vi.fn();
  let body: ReadableStream<Uint8Array> | undefined;
  const transport = new HttpTransport({ url: "https://mcp.invalid/utf8", fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      resultType: "complete", ttlMs: 0, cacheScope: "private", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }
    } });
    body = new ReadableStream({ start(controller) {
      controller.enqueue(Buffer.from(`data: {"jsonrpc":"2.0","id":${request.id},"result":{"resultType":"complete","content":[{"type":"text","text":"`));
      controller.enqueue(Buffer.from(bytes));
      if (truncated) controller.close();
      else controller.enqueue(Buffer.from('"}]}}\n\n'));
    }, cancel });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  } });
  const client = new McpClient({ clientInfo: { name: "utf8", version: "1" } });
  try {
    await client.connect(transport);
    await expect(client.callTool({ name: "utf8" })).rejects.toThrow(/encoding|encoded data/i);
    expect(body?.locked).toBe(false);
    if (!truncated) expect(cancel).toHaveBeenCalledOnce();
  } finally { await client.close(); await transport.closed; }
});

it("preserves valid SSE UTF-8 characters fragmented into individual bytes", async () => {
  const transport = new HttpTransport({ url: "https://mcp.invalid/utf8", fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      resultType: "complete", ttlMs: 0, cacheScope: "private", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }
    } });
    const bytes = Buffer.from(`data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete", content: [{ type: "text", text: "é🚀" }] } })}\n\n`);
    return new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Buffer.from([byte]));
      controller.close();
    } }), { headers: { "Content-Type": "text/event-stream" } });
  } });
  const client = new McpClient({ clientInfo: { name: "utf8", version: "1" } });
  try {
    await client.connect(transport);
    await expect(client.callTool({ name: "utf8" })).resolves.toMatchObject({ content: [{ text: "é🚀" }] });
  } finally { await client.close(); await transport.closed; }
});
