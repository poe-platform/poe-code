import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

test(
  "SDK transport adapter serves the official client through its InMemoryTransport",
  { timeout: 3000 },
  async () => {
    const server = createServer({ name: "sdk", version: "0" });
    server.tool("echo", "Echo", { type: "object" }, (args) => args.message);
    server.prompt({ name: "review" }, () => ({ messages: [] }));
    server.resourceTemplate({ uriTemplate: "memo://{name}", name: "memo" }, (uri) => ({
      contents: [{ uri, text: uri }]
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const connected = server.connectSDK(serverTransport);
    const client = new Client({ name: "oracle", version: "0" });
    try {
      await client.connect(clientTransport);
      assert.equal((await client.listTools()).tools[0].name, "echo");
      assert.deepEqual(
        (await client.callTool({ name: "echo", arguments: { message: "\ud800🦀" } })).content,
        [{ type: "text", text: "\ud800🦀" }]
      );
      assert.deepEqual((await client.getPrompt({ name: "review" })).messages, []);
      assert.equal(
        (await client.readResource({ uri: "memo://welcome" })).contents[0].text,
        "memo://welcome"
      );
      const updated = new Promise((resolve) =>
        client.setNotificationHandler(ResourceUpdatedNotificationSchema, resolve)
      );
      await client.subscribeResource({ uri: "memo://welcome" });
      await server.notifyResourceUpdated("memo://welcome");
      assert.deepEqual((await updated).params, { uri: "memo://welcome" });
    } finally {
      await client.close();
      await connected;
    }
  }
);

async function messages(create) {
  const sent = [];
  const transport = {
    async start() {},
    async close() {},
    async send(message) {
      sent.push(message);
    }
  };
  const server = create({ name: "test", version: "0" });
  let calls = 0;
  server.tool("echo", "Echo", { type: "object" }, () => {
    calls++;
    return "echo";
  });
  server.method("notify", async (_params, context) => {
    await context.notify("notifications/test", { value: "\ud800" });
    return {};
  });
  const connected = server.connectSDK(transport);
  try {
    for (const message of [
      { jsonrpc: "2.0", id: 10, result: {} },
      { jsonrpc: "2.0", id: 11, error: { code: -32603, message: "ignored" } },
      { jsonrpc: "2.0", method: "initialize" },
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", id: 2, method: "initialize" },
      { jsonrpc: "2.0", id: 3, method: "notifications/initialized" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 4, method: "notify" },
      { jsonrpc: "2.0", id: null, method: "tools/list", params: { _meta: metadata } },
      { jsonrpc: "2.0", id: 1.5, method: "tools/list", params: { _meta: metadata } },
      {
        jsonrpc: "2.0",
        id: Number.MAX_SAFE_INTEGER + 1,
        method: "tools/list",
        params: { _meta: metadata }
      },
      { jsonrpc: "2.0", method: "tools/call", params: { name: "echo", _meta: metadata } },
      {
        jsonrpc: "2.0",
        id: "\ud800",
        method: "tools/call",
        params: { name: "echo", _meta: metadata }
      },
      { jsonrpc: "2.0", id: null, method: "tools/call", params: { name: "echo" } },
      { jsonrpc: "2.0", id: "", method: "ping", params: undefined },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/list",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": "future" } }
      }
    ])
      await transport.onmessage(message);
    return { sent, calls };
  } finally {
    transport.onclose();
    await connected;
  }
}

test("SDK adapter envelopes, IDs, notifications and protocol selection match TypeScript", async () => {
  assert.deepEqual(await messages(createServer), await messages(referenceCreateServer));
});

test("SDK adapter closes failed startups and active requests without suppressing delivery errors", async () => {
  for (const create of [createServer, referenceCreateServer]) {
    const startup = new Error("startup failed");
    const server = create({ name: "test", version: "0" });
    let observations = 0;
    server.onNotification(() => observations++);
    const failed = {
      async start() {
        await this.onmessage({ jsonrpc: "2.0", id: 1, method: "initialize" });
        await this.onmessage({ jsonrpc: "2.0", method: "notifications/initialized" });
        throw startup;
      },
      async close() {},
      async send() {}
    };
    await assert.rejects(server.connectSDK(failed), (error) => error === startup);
    await server.notifyToolsChanged();
    assert.equal(observations, 0);
    let capture, release;
    const started = new Promise((resolve) => {
      capture = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    server.method("pending", async (_params, context) => {
      capture(context);
      await pending;
      return {};
    });
    const sent = [];
    const transport = {
      async start() {},
      async close() {},
      async send(message) {
        sent.push(message);
      }
    };
    const connected = server.connectSDK(transport);
    const request = transport.onmessage({
      jsonrpc: "2.0",
      id: 2,
      method: "pending",
      params: { _meta: metadata }
    });
    const context = await started;
    transport.onclose();
    await connected;
    assert.equal(context.signal.aborted, true);
    await request;
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sent, []);

    const deliveryFailure = new Error("send failed");
    const recovering = {
      async start() {},
      async close() {},
      async send() {
        throw deliveryFailure;
      }
    };
    const recovery = server.connectSDK(recovering);
    await assert.rejects(
      recovering.onmessage({ jsonrpc: "2.0", id: 3, method: "ping" }),
      (error) => error === deliveryFailure
    );
    recovering.send = async (message) => {
      sent.push(message);
    };
    await recovering.onmessage({ jsonrpc: "2.0", id: 4, method: "ping" });
    assert.deepEqual(sent, [{ jsonrpc: "2.0", id: 4, result: {} }]);
    recovering.onclose();
    await recovery;
  }
});

test("SDK cancellation retains global admission capacity until the callback settles", async () => {
  for (const create of [createServer, referenceCreateServer]) {
    const server = create({ name: "test", version: "0", maxActiveRequests: 1 });
    let started, release;
    const beginning = new Promise((resolve) => {
      started = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    server.method("pending", async (_params, context) => {
      started(context);
      await pending;
      return {};
    });
    const firstMessages = [],
      secondMessages = [];
    const transport = (messages) => ({
      async start() {},
      async close() {},
      async send(message) {
        messages.push(message);
      }
    });
    const first = transport(firstMessages),
      second = transport(secondMessages);
    const connections = [server.connectSDK(first), server.connectSDK(second)];
    const operation = first.onmessage({
      jsonrpc: "2.0",
      id: "same",
      method: "pending",
      params: { _meta: metadata }
    });
    const context = await beginning;
    await second.onmessage({
      jsonrpc: "2.0",
      id: "same",
      method: "tools/list",
      params: { _meta: metadata }
    });
    assert.equal(secondMessages.at(-1).error.code, -32000);
    await first.onmessage({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "same" }
    });
    await operation;
    assert.equal(context.signal.aborted, true);
    assert.deepEqual(firstMessages, []);
    await second.onmessage({
      jsonrpc: "2.0",
      id: "same",
      method: "tools/list",
      params: { _meta: metadata }
    });
    assert.equal(secondMessages.at(-1).error.code, -32000);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    await second.onmessage({
      jsonrpc: "2.0",
      id: "same",
      method: "tools/list",
      params: { _meta: metadata }
    });
    assert.deepEqual(secondMessages.at(-1).result.tools, []);
    first.onclose();
    second.onclose();
    await Promise.all(connections);
  }
});
