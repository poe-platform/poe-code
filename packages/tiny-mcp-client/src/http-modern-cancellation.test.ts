import { describe, expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./internal.js";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("modern HTTP originating-request cancellation", () => {
  it.each(["headers", "json", "sse", "error"])(
    "disconnects only the originating request during %s",
    async (phase) => {
      const methods: string[] = [];
      const signals = new Map<string, AbortSignal>();
      const canceled = vi.fn();
      const transport = new HttpTransport({
        url: "https://example.test/mcp",
        fetch: async (_url, init) => {
          const request = JSON.parse(String(init?.body));
          methods.push(request.method);
          signals.set(request.method, init!.signal as AbortSignal);
          if (request.method === "notifications/cancelled")
            return new Response(null, { status: 202 });
          if (request.method === "slow") {
            if (phase === "headers")
              return await new Promise<Response>((_resolve, reject) => {
                init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
                  once: true
                });
              });
            const body = new ReadableStream<Uint8Array>({ cancel: canceled });
            return new Response(body, {
              status: phase === "error" ? 400 : 200,
              headers: {
                "Content-Type": phase === "sse" ? "text/event-stream" : "application/json"
              }
            });
          }
          return Response.json({
            jsonrpc: "2.0",
            id: request.id,
            result: { resultType: "complete" }
          });
        }
      });
      const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
      let id!: string | number;
      try {
        const slow = layer
          .sendRequest(
            "slow",
            { _meta: metadata },
            {
              onRequestId: (value) => {
                id = value;
              }
            }
          )
          .catch((error) => error);
        await settle();
        await settle();
        layer.sendNotification("notifications/cancelled", { requestId: id });
        layer.cancelRequest(id, new Error("stop"));
        await slow;
        await settle();
        expect(signals.get("slow")?.aborted).toBe(true);
        if (phase !== "headers") expect(canceled).toHaveBeenCalledTimes(1);
        expect(await layer.sendRequest("good", { _meta: metadata })).toMatchObject({
          resultType: "complete"
        });
        expect(methods).toEqual(["slow", "good"]);
        expect(signals.get("good")?.aborted).toBe(false);
      } finally {
        layer.dispose();
        transport.dispose();
      }
    }
  );
  it("discards late response bodies from a canceled noncooperative fetch", async () => {
    let release!: (response: Response) => void;
    const late = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const canceled = vi.fn();
    const methods: string[] = [];
    const transport = new HttpTransport({
      url: "https://example.test/mcp",
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        methods.push(request.method);
        if (request.method === "slow") return await late;
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: { resultType: "complete" }
        });
      }
    });
    const layer = new JsonRpcMessageLayer(transport.readable, transport.writable);
    let id!: string | number;
    try {
      const slow = layer
        .sendRequest(
          "slow",
          { _meta: metadata },
          {
            onRequestId: (value) => {
              id = value;
            }
          }
        )
        .catch((error) => error);
      await settle();
      layer.sendNotification("notifications/cancelled", { requestId: id });
      layer.cancelRequest(id, new Error("stop"));
      await slow;
      await settle();
      expect(await layer.sendRequest("good", { _meta: metadata })).toMatchObject({
        resultType: "complete"
      });
      release(
        new Response(new ReadableStream<Uint8Array>({ cancel: canceled }), {
          headers: { "Content-Type": "application/json" }
        })
      );
      await settle();
      expect(canceled).toHaveBeenCalledTimes(1);
      expect(methods).toEqual(["slow", "good"]);
    } finally {
      layer.dispose();
      transport.dispose();
    }
  });
});
