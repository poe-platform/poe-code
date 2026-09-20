import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";
import { PassThrough, Writable } from "node:stream";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};
const turn = () => new Promise((resolve) => setImmediate(resolve));

test(
  "modern subscription notifications cross the official SDK InMemoryTransport adapter",
  { timeout: 3000 },
  async () => {
    const server = createServer({ name: "test", version: "0" });
    const [client, transport] = InMemoryTransport.createLinkedPair();
    const events = [];
    let acknowledge;
    const acknowledged = new Promise((resolve) => {
      acknowledge = resolve;
    });
    client.onmessage = (message) => {
      events.push(message);
      if (message.method === "notifications/subscriptions/acknowledged") acknowledge();
    };
    const connected = server.connectSDK(transport);
    try {
      await client.start();
      await client.send({
        jsonrpc: "2.0",
        id: "sdk-listen",
        method: "subscriptions/listen",
        params: { _meta: metadata, notifications: { resourceSubscriptions: ["memo://item"] } }
      });
      await acknowledged;
      await turn();
      await server.notifyResourceUpdated("memo://ignored");
      await server.notifyResourceUpdated("memo://item");
      assert.equal(events.length, 2);
      assert.deepEqual(events[1].params, {
        uri: "memo://item",
        _meta: { "io.modelcontextprotocol/subscriptionId": "sdk-listen" }
      });
    } finally {
      await client.close();
      await connected;
    }
  }
);

async function selected(create, options = {}) {
  const server = create({ name: "test", version: "0", ...options });
  const events = [],
    global = [];
  server.onNotification((notification) => global.push(notification));
  const session = server.createMessageSession((notification) => events.push(notification));
  const uris = ["memo://selected", "memo://selected"];
  const first = session.handleMessage(
    "subscriptions/listen",
    {
      _meta: metadata,
      notifications: { toolsListChanged: true, resourceSubscriptions: uris, ignored: true }
    },
    { requestId: 1 }
  );
  const second = session.handleMessage(
    "subscriptions/listen",
    {
      _meta: metadata,
      notifications: { promptsListChanged: true, resourcesListChanged: true }
    },
    { requestId: "1" }
  );
  await turn();
  assert.equal(
    events.filter((entry) => entry.method === "notifications/subscriptions/acknowledged").length,
    2
  );
  uris.push("memo://other");
  await server.notifyToolsChanged();
  await server.notifyPromptsChanged();
  await server.notifyResourcesChanged();
  await server.notifyResourceUpdated("memo://other");
  await server.notifyResourceUpdated("memo://selected");
  await session.handleMessage("notifications/cancelled", { requestId: 1 });
  await first;
  await server.notifyToolsChanged();
  await server.notifyPromptsChanged();
  session.close();
  await second;
  await server.notifyToolsChanged();
  return { events, global };
}

test("modern listens acknowledge the supported filter and isolate IDs, snapshots and cancellation", async () => {
  for (const options of [
    {},
    { supportNotifications: false },
    { supportResourceSubscriptions: false },
    { supportNotifications: false, supportResourceSubscriptions: false }
  ])
    assert.deepEqual(
      await selected(createServer, options),
      await selected(referenceCreateServer, options)
    );
});

test("modern listen filters and request IDs reject invalid admission before acknowledgment", async () => {
  const native = createServer({ name: "test", version: "0" }),
    reference = referenceCreateServer({ name: "test", version: "0" });
  const events = [];
  const first = native.createMessageSession((notification) => events.push(notification));
  const second = reference.createMessageSession(() => {});
  for (const notifications of [
    undefined,
    null,
    [],
    1,
    { toolsListChanged: "yes" },
    { promptsListChanged: 1 },
    { resourcesListChanged: null },
    { resourceSubscriptions: [123] },
    { resourceSubscriptions: ["relative"] },
    { resourceSubscriptions: ["file:///bad%zz"] },
    { resourceSubscriptions: ["memo://" + "x".repeat(8192)] },
    { resourceSubscriptions: Array(1025).fill("memo://item") }
  ]) {
    const params = { _meta: metadata, ...(notifications === undefined ? {} : { notifications }) };
    assert.deepEqual(
      await first.handleMessage("subscriptions/listen", params, { requestId: 4 }),
      await second.handleMessage("subscriptions/listen", params, { requestId: 4 })
    );
  }
  for (const context of [
    undefined,
    { requestId: 1.5 },
    { requestId: Number.MAX_SAFE_INTEGER + 1 }
  ]) {
    const params = { _meta: metadata, notifications: {} };
    assert.deepEqual(
      await first.handleMessage("subscriptions/listen", params, context),
      await second.handleMessage("subscriptions/listen", params, context)
    );
  }
  assert.deepEqual(events, []);
  first.close();
  second.close();
});

test("pending acknowledgments do not deliver events and retain capacity through cancellation", async () => {
  for (const create of [createServer, referenceCreateServer]) {
    const server = create({ name: "test", version: "0", maxActiveRequests: 1 });
    let begin, release;
    const starting = new Promise((resolve) => {
      begin = resolve;
    });
    const acknowledgment = new Promise((resolve) => {
      release = resolve;
    });
    const events = [];
    const observers = [];
    server.onNotification((notification) => observers.push(notification));
    const session = server.createMessageSession((notification) => {
      events.push(notification);
      if (notification.method === "notifications/subscriptions/acknowledged") {
        begin();
        return acknowledgment;
      }
    });
    const listening = session.handleMessage(
      "subscriptions/listen",
      { _meta: metadata, notifications: { toolsListChanged: true } },
      { requestId: "held" }
    );
    await starting;
    await server.notifyToolsChanged();
    assert.equal(events.length, 1);
    const duplicate = await session.handleMessage(
      "tools/list",
      { _meta: metadata },
      { requestId: "other" }
    );
    assert.equal(duplicate.error.code, -32000);
    await session.handleMessage("notifications/cancelled", { requestId: "held" });
    assert.deepEqual(await listening, { result: undefined });
    await server.notifyToolsChanged();
    assert.equal(observers.length, 1);
    assert.equal(
      (await session.handleMessage("tools/list", { _meta: metadata }, { requestId: "other" })).error
        .code,
      -32000
    );
    release();
    await turn();
    assert.equal(
      (await session.handleMessage("tools/list", { _meta: metadata }, { requestId: "other" }))
        .error,
      undefined
    );
    await server.notifyToolsChanged();
    assert.equal(events.length, 1);
    session.close();
  }
});

test("acknowledgment and broadcast delivery errors preserve identity and clean up failed listens", async () => {
  for (const create of [createServer, referenceCreateServer]) {
    const server = create({ name: "test", version: "0", maxActiveRequests: 1 });
    const failure = new Error("delivery failed");
    const failing = server.createMessageSession(() => {
      throw failure;
    });
    await assert.rejects(
      failing.handleMessage(
        "subscriptions/listen",
        { _meta: metadata, notifications: {} },
        { requestId: 1 }
      ),
      (error) => error === failure
    );
    assert.equal(
      (await failing.handleMessage("tools/list", { _meta: metadata }, { requestId: 2 })).error,
      undefined
    );
    failing.close();
    const session = server.createMessageSession((notification) => {
      if (notification.method !== "notifications/subscriptions/acknowledged")
        return Promise.reject(failure);
    });
    const listening = session.handleMessage(
      "subscriptions/listen",
      { _meta: metadata, notifications: { toolsListChanged: true } },
      { requestId: 3 }
    );
    await turn();
    await assert.rejects(server.notifyToolsChanged(), (error) => error === failure);
    session.close();
    await listening;
  }
});

test(
  "stdio delivers modern acknowledgments and tagged events, then ends long-lived requests on EOF",
  { timeout: 3000 },
  async () => {
    for (const create of [createServer, referenceCreateServer]) {
      const readable = new PassThrough();
      const events = [];
      let ready;
      const acknowledged = new Promise((resolve) => {
        ready = resolve;
      });
      const writable = new Writable({
        write(chunk, _encoding, callback) {
          const message = JSON.parse(chunk.toString());
          events.push(message);
          if (message.method === "notifications/subscriptions/acknowledged") ready();
          callback();
        }
      });
      const server = create({ name: "test", version: "0" });
      const connected = server.connect({ readable, writable });
      readable.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "listen",
          method: "subscriptions/listen",
          params: { _meta: metadata, notifications: { toolsListChanged: true } }
        }) + "\n"
      );
      await acknowledged;
      await turn();
      await server.notifyToolsChanged();
      readable.end();
      await connected;
      assert.equal(events.length, 2);
      assert.equal(events[1].method, "notifications/tools/list_changed");
      assert.equal(events[1].params._meta["io.modelcontextprotocol/subscriptionId"], "listen");
      assert.equal(
        events.some((message) => message.id !== undefined),
        false
      );
      assert.equal(readable.listenerCount("data"), 0);
      assert.equal(writable.listenerCount("drain"), 0);
    }
  }
);
