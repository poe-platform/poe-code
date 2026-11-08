import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { HttpTransport, McpClient, type CallToolOptions } from "./index.js";

const url = "https://resource.invalid/mcp";
function fixture(mutate: () => void) {
  const progress = vi.fn(), opened = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
  const calls: unknown[] = []; let posts = 0;
  const transport = new HttpTransport({ url, oauth: { provider: {
    authorizeRequest(input) { if (input.headers.get("Content-Type") !== null && ++posts === 3) mutate(); },
    handleUnauthorized: () => ({ action: "fail" })
  } }, fetch: async (_url, init) => {
    if (init?.method === "GET") return new Response(new ReadableStream({ start: controller => opened.resolve(controller) }), { headers: { "Content-Type": "text/event-stream" } });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const request = JSON.parse(String(init?.body));
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (request.method === "tools/call") {
      calls.push(request.params);
      if (request.params._meta?.progressToken !== undefined) {
        (await opened.promise).enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: request.params._meta.progressToken, progress: 0.5 } })}\n\n`));
        await setImmediate();
      }
    }
    return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "initialize"
      ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "original", version: "1" } }
      : { content: [{ type: "text", text: "complete" }], structuredContent: { exact: "005930", enabled: false, retries: 0 } }
    }, { headers: { "Mcp-Session-Id": "original-session" } });
  } });
  const client = new McpClient({ protocolVersion: "2025-03-26", clientInfo: { name: "ownership-test", version: "1" }, onProgress: progress });
  return { transport, client, progress, opened, calls };
}

it("retains the original call signal when OAuth replaces it before dispatch", async () => {
  const original = new AbortController(), replacement = AbortSignal.abort(new Error("replacement cancellation"));
  const options: CallToolOptions = { signal: original.signal };
  const f = fixture(() => { options.signal = replacement; });
  try {
    await f.client.connect(f.transport); await f.opened.promise;
    expect(await f.client.callTool({ name: "find", arguments: { query: "005930" } }, options)).toEqual({
      content: [{ type: "text", text: "complete" }], structuredContent: { exact: "005930", enabled: false, retries: 0 }
    });
    expect(original.signal.aborted).toBe(false);
    expect(f.calls).toEqual([{ name: "find", arguments: { query: "005930" } }]);
  } finally { await f.client.close(); f.transport.dispose(); await f.transport.closed; }
});

it.each(["replacement", undefined])("retires the selected progress token after a host changes it to %s", async replacement => {
  const options: CallToolOptions = { progressToken: "original" };
  const f = fixture(() => { options.progressToken = replacement; });
  try {
    await f.client.connect(f.transport); const stream = await f.opened.promise;
    await f.client.callTool({ name: "find", arguments: { query: "005930" } }, options);
    expect(f.calls).toEqual([{ name: "find", arguments: { query: "005930" }, _meta: { progressToken: "original" } }]);
    expect(f.progress).toHaveBeenCalledExactlyOnceWith({ progressToken: "original", progress: 0.5 });
    stream.enqueue(new TextEncoder().encode('data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"original","progress":1}}\n\n'));
    await setImmediate();
    expect(f.progress).toHaveBeenCalledOnce();
  } finally { await f.client.close(); f.transport.dispose(); await f.transport.closed; }
});
