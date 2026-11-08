import { expect, it, vi } from "vitest";
import { HttpTransport, McpClient } from "./internal.js";

it.each([404, 405, 503])("preserves HTTP status %s on failed POST setup", async status => {
  const fetch = vi.fn(async () => new Response("setup failed", { status }));
  const transport = new HttpTransport({ url: "https://example.test/mcp", fetch });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-03-26" });
  try {
    await expect(client.connect(transport)).rejects.toMatchObject({ status, method: "POST" });
  } finally { await client.close(); }
});

it("preserves GET status on legacy SSE setup failure", async () => {
  const fetch = vi.fn(async () => new Response("forbidden", { status: 403 }));
  const transport = new HttpTransport({ url: "https://example.test/sse", mode: "sse", fetch });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-03-26" });
  try {
    await expect(client.connect(transport)).rejects.toMatchObject({ status: 403, method: "GET" });
  } finally { await client.close(); }
});
