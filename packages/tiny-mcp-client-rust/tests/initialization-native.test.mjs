import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpTransport, McpClient, HttpTransportError } from "../dist/index.js";

function fixture(notification) {
  const methods = [];
  const transport = new HttpTransport({
    url: "https://resource.example/mcp",
    fetch: async (_url, init) => {
      if (init.method !== "POST") return new Response(null, { status: 405 });
      const message = JSON.parse(init.body);
      methods.push(message.method);
      if (message.method === "notifications/initialized") return notification(init);
      return Response.json({ jsonrpc: "2.0", id: message.id, result: {
        protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fixture", version: "1" }
      } });
    }
  });
  const client = new McpClient({ clientInfo: { name: "native", version: "1" }, protocolVersion: "2025-03-26" });
  return { client, transport, methods };
}

test("legacy HTTP connection waits for completion and classifies notification rejection", async () => {
  for (const status of [202, 403]) {
    const f = fixture(async () => new Response(null, { status }));
    try {
      if (status === 202) await f.client.connect(f.transport);
      else await assert.rejects(f.client.connect(f.transport), error => {
        assert.ok(error instanceof HttpTransportError);
        assert.equal(error.status, 403);
        assert.equal(error.method, "POST");
        assert.equal(error.rpcMethod, "notifications/initialized");
        return true;
      });
      assert.deepEqual(f.methods, ["initialize", "notifications/initialized"]);
    } finally {
      await f.client.close(); f.transport.dispose(); await f.transport.closed;
    }
  }
});

test("completion cancellation preserves arbitrary causes even when injected fetch ignores abort", async () => {
  for (const reason of [null, false, 0, "", { cancelled: true }]) {
    let enter;
    const entered = new Promise(resolve => { enter = resolve; });
    const f = fixture(() => { enter(); return new Promise(() => {}); });
    const controller = new AbortController();
    const observed = f.client.connect(f.transport, { signal: controller.signal }).catch(error => error);
    try {
      await entered;
      assert.equal(f.client.state, "initializing");
      controller.abort(reason);
      assert.equal(await observed, reason);
      assert.equal(f.client.state, "disconnected");
    } finally {
      controller.abort(reason); await f.client.close(); f.transport.dispose(); await f.transport.closed;
    }
  }
});
