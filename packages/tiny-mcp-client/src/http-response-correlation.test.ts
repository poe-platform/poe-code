import { describe, expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./internal.js";

const params = {
  _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {}
  }
};

describe("modern HTTP message provenance", () => {
  it("never completes a sibling request with the originating POST's response", async () => {
    let peerId!: number | string;
    const transport = new HttpTransport({
      url: "https://example.test/mcp",
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        if (request.method === "peer")
          return await new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
              once: true
            });
          });
        return Response.json({
          jsonrpc: "2.0",
          id: peerId,
          result: { resultType: "complete", poisoned: true }
        });
      }
    });
    const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
    let ownValue: unknown;
    let peerValue: unknown;
    try {
      const peer = layer
        .sendRequest("peer", params, {
          onRequestId: (id) => {
            peerId = id;
          }
        })
        .catch((error) => error).then((value) => { peerValue = value; return value; });
      const own = layer.sendRequest("own", params).catch((error) => error).then((value) => { ownValue = value; return value; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(ownValue).toBeInstanceOf(Error);
      expect(peerValue).toBeInstanceOf(Error);
      await Promise.all([own, peer]);
    } finally {
      layer.dispose();
      transport.dispose();
    }
  });
  it("rejects server-initiated requests on modern SSE before invoking callbacks", async () => {
    const callback = vi.fn(() => ({}));
    const methods: Array<string | undefined> = [];
    const transport = new HttpTransport({
      url: "https://example.test/mcp",
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        methods.push(request.method);
        if (request.method !== "own") return new Response(null, { status: 202 });
        const data = [
          { jsonrpc: "2.0", id: "server", method: "server/request" },
          { jsonrpc: "2.0", id: request.id, result: { resultType: "complete" } }
        ];
        return new Response(
          data.map((message) => `data: ${JSON.stringify(message)}\n\n`).join(""),
          { headers: { "Content-Type": "text/event-stream" } }
        );
      }
    });
    const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
    layer.onRequest("server/request", callback);
    try {
      expect(await layer.sendRequest("own", params).catch((error) => error)).toBeInstanceOf(Error);
      expect(callback).not.toHaveBeenCalled();
      expect(methods).toEqual(["own"]);
    } finally {
      layer.dispose();
      transport.dispose();
    }
  });
  it("rejects subscription notifications tagged for another stream", async () => {
    const notified = vi.fn();
    const transport = new HttpTransport({
      url: "https://example.test/mcp",
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        const data = [
          {
            jsonrpc: "2.0",
            method: "notifications/subscriptions/acknowledged",
            params: {
              _meta: { "io.modelcontextprotocol/subscriptionId": "another" },
              notifications: {}
            }
          },
          {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              resultType: "complete",
              _meta: { "io.modelcontextprotocol/subscriptionId": request.id }
            }
          }
        ];
        return new Response(
          data.map((message) => `data: ${JSON.stringify(message)}\n\n`).join(""),
          { headers: { "Content-Type": "text/event-stream" } }
        );
      }
    });
    const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
    layer.onNotification("notifications/subscriptions/acknowledged", notified);
    try {
      expect(
        await layer.sendRequest("subscriptions/listen", params).catch((error) => error)
      ).toBeInstanceOf(Error);
      expect(notified).not.toHaveBeenCalled();
    } finally {
      layer.dispose();
      transport.dispose();
    }
  });
  it.each(["empty-json", "empty-sse", "partial-sse"])("rejects %s immediately when no final response arrives", async (kind) => {
    const transport = new HttpTransport({ url: "https://example.test/mcp", fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const body = kind === "partial-sse" ? `data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete" } })}` : "";
      return new Response(body, { headers: { "Content-Type": kind === "empty-json" ? "application/json" : "text/event-stream" } });
    } });
    const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
    let observed: unknown;
    const pending = layer.sendRequest("own", params).catch((error) => error).then((value) => { observed = value; return value; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(observed).toBeInstanceOf(Error);
      await pending;
    } finally { layer.dispose(); transport.dispose(); }
  });

});
