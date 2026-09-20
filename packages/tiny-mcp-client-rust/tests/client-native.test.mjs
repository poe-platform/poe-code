import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import * as reference from "tiny-mcp-client";
import { createServer as createRustServer } from "../../tiny-stdio-mcp-server-rust/dist/index.js";
import { createServer as createReferenceServer } from "tiny-stdio-mcp-server";

test("McpClient discovers or initializes both server implementations and invokes public tool/prompt/resource APIs", async () => {
  for (const factory of [native, reference])
    for (const serverFactory of [createRustServer, createReferenceServer])
      for (const protocolVersion of ["2025-03-26", "2026-07-28"]) {
        const pair = reference.createInMemoryTransportPair();
        const server = serverFactory({ name: "server", version: "1" });
        server.tool("echo", "Echo", { type: "object" }, (args) => args.message);
        server.prompt({ name: "review" }, () => ({
          messages: [{ role: "user", content: { type: "text", text: "review" } }]
        }));
        server.resource({ uri: "memo://welcome", name: "welcome" }, (uri) => ({
          contents: [{ uri, text: "hello" }]
        }));
        const connected = server.connect(pair.serverTransport);
        const client = new factory.McpClient({
          clientInfo: { name: "client", version: "1" },
          protocolVersion
        });
        try {
          assert.equal(client.state, "disconnected");
          const result = await client.connect(pair.clientTransport);
          assert.equal(result.protocolVersion, protocolVersion);
          assert.equal(client.state, "ready");
          assert.equal(client.serverInfo.name, "server");
          const capabilities = client.serverCapabilities;
          capabilities.tools.extra = true;
          assert.equal(client.serverCapabilities.tools.extra, undefined);
          assert.equal((await client.listTools()).tools[0].name, "echo");
          assert.deepEqual(
            (await client.callTool({ name: "echo", arguments: { message: "hello\ud800" } }))
              .content,
            [{ type: "text", text: "hello\ud800" }]
          );
          assert.equal((await client.listResources()).resources[0].uri, "memo://welcome");
          assert.equal(
            (await client.readResource({ uri: "memo://welcome" })).contents[0].text,
            "hello"
          );
          assert.equal((await client.listPrompts()).prompts[0].name, "review");
          assert.equal(
            (await client.getPrompt({ name: "review" })).messages[0].content.text,
            "review"
          );
          await assert.rejects(client.connect(pair.clientTransport), {
            message: "MCP client is already connected"
          });
        } finally {
          await client.close();
          pair.clientTransport.dispose();
          await connected;
        }
        assert.equal(client.state, "closed");
        assert.equal(client.serverInfo, null);
        assert.equal(client.serverCapabilities, null);
      }
});

test("client initialization failures dispose the transport and permit a new connection", async () => {
  const pair = reference.createInMemoryTransportPair();
  const server = new reference.JsonRpcMessageLayer(
    pair.serverTransport.readable,
    pair.serverTransport.writable
  );
  server.onRequest("initialize", () => ({
    protocolVersion: "unsupported\ud800",
    capabilities: {},
    serverInfo: { name: "server", version: "1" }
  }));
  const client = new native.McpClient({
    clientInfo: { name: "client", version: "1" },
    protocolVersion: "2025-03-26"
  });
  try {
    await assert.rejects(client.connect(pair.clientTransport), {
      code: -32600,
      message: "Unsupported protocol version: unsupported\ud800"
    });
    assert.equal(client.state, "disconnected");
    assert.match(
      (await pair.clientTransport.closed).reason.message,
      /Unsupported protocol version/
    );
  } finally {
    await client.close();
    server.dispose();
    pair.clientTransport.dispose();
  }
});

function legacyPeer(pair, capabilities = {}) {
  const peer = new reference.JsonRpcMessageLayer(pair.serverTransport.readable, pair.serverTransport.writable);
  peer.onRequest("initialize", () => ({ protocolVersion: "2025-03-26", capabilities, serverInfo: { name: "peer", version: "1" }, instructions: "help\ud800" }));
  return peer;
}

test("discovery fallback, terminal negotiation errors and callback-derived capabilities match the reference", async () => {
  for (const factory of [native, reference]) {
    for (const code of [-32601, -32020, -32021, -32022]) {
      const pair = reference.createInMemoryTransportPair();
      const peer = legacyPeer(pair);
      let initialized = 0;
      peer.onRequest("server/discover", () => { throw new reference.McpError(code, "discovery denied"); });
      peer.onRequest("initialize", (params) => {
        initialized++;
        assert.deepEqual(params.capabilities, { roots: { listChanged: true }, sampling: {}, elicitation: {} });
        return { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "peer", version: "1" } };
      });
      const client = new factory.McpClient({ clientInfo: { name: "client", version: "1" }, capabilities: { roots: { listChanged: true } }, onRootsList: () => [], onSamplingRequest: () => ({}), onElicitationRequest: () => ({ action: "decline" }) });
      try {
        if (code === -32601) {
          assert.equal((await client.connect(pair.clientTransport)).protocolVersion, "2025-03-26");
          assert.equal(initialized, 1);
          assert.deepEqual(await peer.sendRequest("roots/list"), { roots: [] });
          assert.deepEqual(await peer.sendRequest("elicitation/create", { message: "okay?", requestedSchema: { type: "object", properties: {} } }), { action: "decline" });
        } else {
          await assert.rejects(client.connect(pair.clientTransport), { code, message: "discovery denied" });
          assert.equal(initialized, 0);
          assert.equal(client.state, "disconnected");
        }
      } finally { await client.close(); peer.dispose(); pair.clientTransport.dispose(); }
    }
  }
});

test("invalid advertised capabilities fail before any network request", { timeout: 1000 }, async () => {
  for (const factory of [native, reference]) {
    const pair = reference.createInMemoryTransportPair();
    let writes = 0;
    pair.serverTransport.readable.on("data", () => writes++);
    const client = new factory.McpClient({ clientInfo: { name: "client", version: "1" }, capabilities: { sampling: "invalid" } });
    try {
      await assert.rejects(client.connect(pair.clientTransport), { code: -32602, message: "Invalid client capabilities" });
      assert.equal(writes, 0);
      assert.equal(client.state, "disconnected");
    } finally { await client.close(); pair.clientTransport.dispose(); }
  }
});

test("closed clients reconnect and stale transport closure cannot close their new connection", { timeout: 1000 }, async () => {
  for (const factory of [native, reference]) {
    const first = reference.createInMemoryTransportPair();
    const second = reference.createInMemoryTransportPair();
    const peer1 = legacyPeer(first);
    const peer2 = legacyPeer(second);
    peer2.onRequest("ping", () => ({}));
    let finishClosed;
    const delayed = { ...first.clientTransport, closed: new Promise(resolve => { finishClosed = resolve; }) };
    const client = new factory.McpClient({ clientInfo: { name: "client", version: "1" }, protocolVersion: "2025-03-26" });
    try {
      await client.connect(delayed);
      assert.equal(client.instructions, "help\ud800");
      await client.close();
      await client.connect(second.clientTransport);
      finishClosed({ reason: new Error("old transport") });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(client.state, "ready");
      await client.ping();
    } finally { await client.close(); peer1.dispose(); peer2.dispose(); first.clientTransport.dispose(); second.clientTransport.dispose(); }
  }
});

test("progress callbacks are scoped to active tool calls and canceled tools send one cancellation", { timeout: 1000 }, async () => {
  for (const factory of [native, reference]) {
    const pair = reference.createInMemoryTransportPair();
    const peer = legacyPeer(pair, { tools: {} });
    const seen = [];
    let release;
    let invoked;
    const invocation = new Promise(resolve => { invoked = resolve; });
    const work = new Promise(resolve => { release = resolve; });
    peer.onRequest("tools/call", async (params) => {
      peer.sendNotification("notifications/progress", { progressToken: "other", progress: 1 });
      peer.sendNotification("notifications/progress", { progressToken: params._meta.progressToken, progress: 2, total: 3, message: "working" });
      invoked();
      await work;
      return { content: [] };
    });
    let canceled = 0;
    peer.onNotification("notifications/cancelled", () => { canceled++; });
    const client = new factory.McpClient({ clientInfo: { name: "client", version: "1" }, protocolVersion: "2025-03-26", onProgress: params => seen.push(params) });
    try {
      await client.connect(pair.clientTransport);
      const controller = new AbortController();
      const pending = client.callTool({ name: "work" }, { signal: controller.signal, progressToken: "active" });
      await invocation;
      await new Promise(resolve => setImmediate(resolve));
      controller.abort(new Error("stop"));
      await assert.rejects(pending, { message: "stop" });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(canceled, 1);
      assert.deepEqual(seen, [{ progressToken: "active", progress: 2, total: 3, message: "working" }]);
      peer.sendNotification("notifications/progress", { progressToken: "active", progress: 3 });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(seen.length, 1);
    } finally { release(); await client.close(); peer.dispose(); pair.clientTransport.dispose(); }
  }
});
