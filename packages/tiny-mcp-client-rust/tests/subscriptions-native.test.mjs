import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import * as reference from "tiny-mcp-client";
const settle = () => new Promise(resolve => setImmediate(resolve));
async function fixture(factory, options = {}, acknowledge = true) {
  const pair = reference.createInMemoryTransportPair();
  const peer = new reference.JsonRpcMessageLayer(pair.serverTransport.readable, pair.serverTransport.writable);
  const requests = [];
  const completions = new Map();
  const cancellations = [];
  const send = (method, id, params = {}) => peer.sendNotification(method, { ...params, _meta: { "io.modelcontextprotocol/subscriptionId": id } });
  peer.onRequest("server/discover", () => ({ resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {}, resources: {}, prompts: {} }, ttlMs: 0, cacheScope: "private" }));
  peer.onRequest("subscriptions/listen", (params, context) => {
    requests.push({ id: context.id, params });
    if (acknowledge) send("notifications/subscriptions/acknowledged", context.id, { notifications: params.notifications });
    return new Promise(resolve => completions.set(context.id, resolve));
  });
  peer.onNotification("notifications/cancelled", params => cancellations.push(params));
  const client = new factory.McpClient({ clientInfo: { name: "client", version: "1" }, ...options });
  await client.connect(pair.clientTransport);
  return { client, peer, requests, completions, cancellations, send, async close() {
    for (const [id, resolve] of completions) resolve({ resultType: "complete", _meta: { "io.modelcontextprotocol/subscriptionId": id } });
    await client.close(); peer.dispose(); pair.clientTransport.dispose();
  } };
}
test("modern auto subscriptions correlate notifications and cancellation removes admission", { timeout: 1000 }, async () => {
  for (const factory of [native, reference]) {
    let changes = 0;
    const f = await fixture(factory, { onToolsChanged: () => changes++ });
    try {
      assert.equal(f.requests.length, 1);
      assert.equal(f.requests[0].params.notifications.toolsListChanged, true);
      f.send("notifications/tools/list_changed", f.requests[0].id);
      f.send("notifications/tools/list_changed", "unrelated");
      await settle(); assert.equal(changes, 1);
      const listening = await f.client.listenNotifications({ toolsListChanged: true });
      listening.notifications.toolsListChanged = false;
      f.send("notifications/tools/list_changed", listening.id);
      await settle(); assert.equal(changes, 2);
      listening.cancel(); listening.cancel();
      f.send("notifications/tools/list_changed", listening.id);
      await listening.closed; await settle();
      assert.equal(changes, 2);
      assert.equal(f.cancellations.filter(item => item.requestId === listening.id).length, 1);
    } finally { await f.close(); }
  }
});
test("modern resource subscriptions coalesce, filter updates, reopen and cancel before acknowledgement", { timeout: 1000 }, async () => {
  for (const factory of [native, reference]) {
    const updates = [];
    const f = await fixture(factory, { onResourceUpdated: uri => updates.push(uri) });
    try {
      await Promise.all([f.client.subscribe("file:///a"), f.client.subscribe("file:///a")]);
      assert.equal(f.requests.length, 1);
      const id = f.requests[0].id;
      f.send("notifications/resources/updated", id, { uri: "file:///a" });
      f.send("notifications/resources/updated", id, { uri: "file:///b" });
      await settle(); assert.deepEqual(updates, ["file:///a"]);
      f.completions.get(id)({ resultType: "complete", _meta: { "io.modelcontextprotocol/subscriptionId": id } });
      await settle(); await f.client.subscribe("file:///a");
      assert.equal(f.requests.length, 2);
      await f.client.unsubscribe("file:///a");
      f.send("notifications/resources/updated", f.requests[1].id, { uri: "file:///a" });
      await settle(); assert.equal(updates.length, 1);
    } finally { await f.close(); }
    const pending = await fixture(factory, {}, false);
    try {
      const failed = pending.client.subscribe("file:///a").catch(error => error);
      await settle(); await pending.client.unsubscribe("file:///a");
      assert.equal((await failed).message, "Resource subscription canceled");
      const retry = pending.client.subscribe("file:///a");
      await settle();
      pending.send("notifications/subscriptions/acknowledged", pending.requests[1].id, { notifications: { resourceSubscriptions: ["file:///a"] } });
      await retry;
    } finally { await pending.close(); }
  }
});
test("filters reject before sending and expanded acknowledgements cancel their request", { timeout: 1000 }, async () => {
  for (const factory of [native, reference]) {
    const f = await fixture(factory, {}, false);
    try {
      for (const filter of [null, [], { toolsListChanged: 1 }, { resourceSubscriptions: [" file:///a"] }, { resourceSubscriptions: ["file:///a%zz"] }]) await assert.rejects(f.client.listenNotifications(filter));
      const controller = new AbortController(); controller.abort(new Error("pre-aborted"));
      await assert.rejects(f.client.listenNotifications({}, { signal: controller.signal }), { message: "pre-aborted" });
      assert.equal(f.requests.length, 0);
      const listening = f.client.listenNotifications({ toolsListChanged: true });
      const rejection = assert.rejects(listening, { message: "Subscription acknowledgement exceeds the requested filter" });
      await settle();
      f.send("notifications/subscriptions/acknowledged", f.requests[0].id, { notifications: { promptsListChanged: true } });
      await rejection; await settle();
      assert.equal(f.cancellations.length, 1);
    } finally { await f.close(); }
  }
});

test("subscription completion IDs and premature completion are rejected", { timeout: 1000 }, async () => {
  for (const factory of [native, reference]) {
    for (const acknowledge of [true, false]) {
      const f = await fixture(factory, {}, acknowledge);
      try {
        const pending = f.client.listenNotifications({ promptsListChanged: true });
        if (acknowledge) {
          const listening = await pending;
          const rejection = assert.rejects(listening.closed, { message: "Invalid subscription completion ID" });
          f.completions.get(listening.id)({ resultType: "complete", _meta: { "io.modelcontextprotocol/subscriptionId": "wrong" } });
          await rejection;
        } else {
          const rejection = assert.rejects(pending, { message: "Subscription completed before acknowledgement" });
          await settle(); const id = f.requests[0].id;
          f.completions.get(id)({ resultType: "complete", _meta: { "io.modelcontextprotocol/subscriptionId": id } });
          await rejection;
        }
      } finally { await f.close(); }
    }
  }
});
test("acknowledgement timeout cancels, subscription capacity recovers, and callbacks stop after abort", { timeout: 1000 }, async () => {
  for (const factory of [native, reference]) {
    const timeout = await fixture(factory, { requestTimeoutMs: 15 }, false);
    try {
      await assert.rejects(timeout.client.listenNotifications({ toolsListChanged: true }), { message: "MCP subscription acknowledgement timed out" });
      await settle(); assert.equal(timeout.cancellations.length, 1);
    } finally { await timeout.close(); }
    let changes = 0;
    const f = await fixture(factory, { onToolsChanged: () => changes++ });
    try {
      const streams = [];
      for (let i = 0; i < 63; i++) streams.push(await f.client.listenNotifications({ toolsListChanged: true }));
      await assert.rejects(f.client.listenNotifications({}), { message: "Too many MCP subscriptions" });
      streams.pop().cancel();
      const controller = new AbortController();
      const replacement = await f.client.listenNotifications({ toolsListChanged: true }, { signal: controller.signal });
      controller.abort(new Error("stop"));
      f.send("notifications/tools/list_changed", replacement.id);
      await replacement.closed; await settle(); assert.equal(changes, 0);
      await f.client.listenNotifications({});
    } finally { await f.close(); }
  }
});
test("an aborted coalesced resource caller does not cancel another caller's subscription", { timeout: 1000 }, async () => {
  for (const factory of [native, reference]) {
    const f = await fixture(factory, {}, false);
    try {
      const first = f.client.subscribe("file:///a");
      const controller = new AbortController();
      const second = f.client.subscribe("file:///a", { signal: controller.signal });
      const rejected = assert.rejects(second, { message: "stop waiting" });
      await settle(); controller.abort(new Error("stop waiting")); await rejected;
      assert.equal(f.cancellations.length, 0);
      assert.equal(f.requests.length, 1);
      f.send("notifications/subscriptions/acknowledged", f.requests[0].id, { notifications: { resourceSubscriptions: ["file:///a"] } });
      await first;
    } finally { await f.close(); }
  }
});

test("client notification APIs interoperate with Rust and TypeScript servers in both protocols", { timeout: 2000 }, async () => {
  const { createServer: rustServer } = await import("../../tiny-stdio-mcp-server-rust/dist/index.js");
  const { createServer: tsServer } = await import("tiny-stdio-mcp-server");
  for (const factory of [native, reference]) for (const createServer of [rustServer, tsServer]) for (const protocolVersion of ["2025-03-26", "2026-07-28"]) {
    const pair = reference.createInMemoryTransportPair();
    const server = createServer({ name: "server", version: "1", supportNotifications: true, supportResourceSubscriptions: true });
    server.tool("echo", "Echo", { type: "object" }, () => "hello");
    server.resource({ uri: "file:///selected", name: "selected" }, uri => ({ contents: [{ uri, text: "hello" }] }));
    const connected = server.connect(pair.serverTransport);
    const events = [];
    const client = new factory.McpClient({ clientInfo: { name: "client", version: "1" }, protocolVersion, onToolsChanged: () => events.push("tools"), onPromptsChanged: () => events.push("prompts"), onResourcesChanged: () => events.push("resources"), onResourceUpdated: uri => events.push(uri) });
    try {
      await client.connect(pair.clientTransport);
      await client.subscribe("file:///selected");
      await server.notifyToolsChanged(); await server.notifyPromptsChanged(); await server.notifyResourcesChanged();
      await server.notifyResourceUpdated("file:///selected"); await server.notifyResourceUpdated("file:///other");
      await settle(); assert.deepEqual(events, ["tools", "prompts", "resources", "file:///selected"]);
      await client.unsubscribe("file:///selected");
      await server.notifyResourceUpdated("file:///selected"); await settle();
      assert.equal(events.length, 4);
      if (protocolVersion === "2025-03-26") await assert.rejects(client.listenNotifications({}), { message: "Notification streams require modern MCP" });
    } finally { await client.close(); pair.clientTransport.dispose(); await connected; }
  }
});

test("native filter conversion rejects accessors, cycles and serialization hooks without executing them", { timeout: 1000 }, async () => {
  const f = await fixture(native);
  let calls = 0;
  const accessor = Object.defineProperty({}, "toolsListChanged", { enumerable: true, get() { calls++; return true; } });
  const cyclic = {}; cyclic.resourceSubscriptions = cyclic;
  const hook = { toolsListChanged: true, toJSON() { calls++; return {}; } };
  try {
    for (const filter of [accessor, cyclic, hook]) await assert.rejects(f.client.listenNotifications(filter));
    assert.equal(calls, 0); assert.equal(f.requests.length, 0);
    const stream = await f.client.listenNotifications({ resourceSubscriptions: ["file:///b", "file:///a", "file:///b"], toolsListChanged: false, promptsListChanged: true });
    assert.deepEqual(stream.notifications, { promptsListChanged: true, resourceSubscriptions: ["file:///b", "file:///a"] });
    stream.cancel(); await stream.closed;
  } finally { await f.close(); }
});
