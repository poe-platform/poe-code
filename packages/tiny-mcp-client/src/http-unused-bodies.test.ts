import { describe, expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./internal.js";

function unusedResponse(status: number, headers?: HeadersInit) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  return { response: new Response(body, { status, headers }), cancel };
}

describe("HTTP ignored response body ownership", () => {
  it.each([
    { status: 202, headers: { "Content-Type": "application/json" } },
    { status: 200, headers: undefined },
    { status: 200, headers: { "Content-Type": "text/plain" } }
  ])("cancels ignored POST bodies for %j", async ({ status, headers }) => {
    const { response, cancel } = unusedResponse(status, headers);
    let deliver!: () => void;
    const delivered = new Promise<void>((resolve) => { deliver = resolve; });
    const transport = new HttpTransport({ url: "https://example.test/mcp", fetch: async () => {
      deliver(); return response;
    } });
    const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
    try {
      layer.sendNotification("notifications/test");
      await delivered;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally { layer.dispose(); transport.dispose(); }
  });
});
