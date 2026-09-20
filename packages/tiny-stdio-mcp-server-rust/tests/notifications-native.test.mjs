import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

async function scenario(create, options = {}) {
  const server = create({ name: "test", version: "0", ...options });
  server.resource({ uri: "memo://welcome", name: "welcome" }, () => ({ contents: [] }));
  server.resourceTemplate({ uriTemplate: "memo://{name}", name: "memo" }, () => ({ contents: [] }));
  const events = [];
  const results = [];
  const remove = server.onNotification((notification) => events.push(["global", notification]));
  const first = server.createMessageSession((notification) => events.push(["first", notification]));
  const second = server.createMessageSession((notification) =>
    events.push(["second", notification])
  );
  const closed = server.createMessageSession((notification) =>
    events.push(["closed", notification])
  );
  await server.notifyToolsChanged();
  await first.handleMessage("initialize");
  await server.notifyPromptsChanged();
  await first.handleMessage("notifications/initialized");
  await server.notifyToolsChanged();
  for (const session of [second, closed]) {
    await session.handleMessage("initialize");
    await session.handleMessage("notifications/initialized");
  }
  closed.close();
  for (const [method, uri] of [
    ["resources/subscribe", "relative"],
    ["resources/subscribe", "missing://welcome"],
    ["resources/subscribe", "memo://welcome"],
    ["resources/subscribe", "memo://welcome"],
    ["resources/subscribe", "memo://another"],
    ["resources/unsubscribe", "missing://welcome"]
  ])
    results.push(await first.handleMessage(method, { uri }));
  await second.handleMessage("resources/subscribe", { uri: "memo://another" });
  await server.notifyResourceUpdated("memo://welcome");
  await server.notifyResourceUpdated("memo://another");
  await first.handleMessage("resources/unsubscribe", { uri: "memo://welcome" });
  await server.notifyResourceUpdated("memo://welcome");
  await first.handleMessage("initialize");
  await server.notifyResourcesChanged();
  await server.notifyResourceUpdated("memo://another");
  await first.handleMessage("notifications/initialized");
  await server.notifyResourceUpdated("memo://another");
  for (const [method, uri] of [
    ["resources/subscribe", "missing://welcome"],
    ["resources/subscribe", "memo://welcome"],
    ["resources/unsubscribe", "memo://welcome"]
  ])
    results.push(await first.handleMessage(method, { uri, _meta: metadata }));
  remove();
  remove();
  await server.notifyPromptsChanged();
  first.close();
  second.close();
  await server.notifyToolsChanged();
  return { events, results };
}

test("notifications and readable-resource subscriptions preserve session isolation and lifecycle", async () => {
  for (const options of [
    {},
    { supportNotifications: false },
    { supportResourceSubscriptions: false },
    { supportNotifications: false, supportResourceSubscriptions: false }
  ])
    assert.deepEqual(
      await scenario(createServer, options),
      await scenario(referenceCreateServer, options)
    );
});

test("custom notification contexts honor readiness, cancellation, close and delivery failures", async () => {
  for (const create of [createServer, referenceCreateServer]) {
    const server = create({ name: "test", version: "0", supportNotifications: false });
    const contexts = [];
    server.method("capture", (_params, context) => {
      contexts.push(context);
      return {};
    });
    const events = [];
    const session = server.createMessageSession((notification) => events.push(notification));
    await session.handleMessage("initialize");
    await session.handleMessage("capture");
    await contexts[0].notify("notifications/test", { value: "before-ready" });
    assert.deepEqual(events, []);
    await session.handleMessage("notifications/initialized");
    await contexts[0].notify("notifications/test", { value: "ready" });
    assert.deepEqual(events, [
      { jsonrpc: "2.0", method: "notifications/test", params: { value: "ready" } }
    ]);
    session.close();
    await contexts[0].notify("notifications/test");
    assert.equal(events.length, 1);
    assert.equal(contexts[0].signal.aborted, true);

    const modern = server.createMessageSession((notification) => events.push(notification));
    await modern.handleMessage("capture", { _meta: metadata });
    assert.equal(contexts[1].signal.aborted, true);
    await contexts[1].notify("notifications/test");
    assert.equal(events.length, 1);
    server.method("send", async (_params, context) => {
      await context.notify("notifications/test");
      return {};
    });
    assert.equal((await modern.handleMessage("send", { _meta: metadata })).error, undefined);
    assert.equal(events.length, 2);
    modern.close();

    const failure = new Error("delivery failed");
    for (const asynchronous of [false, true]) {
      const failing = server.createMessageSession(() => {
        if (asynchronous) return Promise.reject(failure);
        throw failure;
      });
      await failing.handleMessage("initialize");
      await failing.handleMessage("notifications/initialized");
      await failing.handleMessage("capture");
      await assert.rejects(
        contexts.at(-1).notify("notifications/test"),
        (error) => error === failure
      );
      failing.close();
    }
    let rejectDelivery;
    const pending = new Promise((_resolve, reject) => {
      rejectDelivery = reject;
    });
    const inFlight = server.createMessageSession(() => pending);
    await inFlight.handleMessage("initialize");
    await inFlight.handleMessage("notifications/initialized");
    await inFlight.handleMessage("capture");
    const delivery = contexts.at(-1).notify("notifications/test");
    inFlight.close();
    rejectDelivery(failure);
    await assert.rejects(delivery, (error) => error === failure);
  }
});

test("broadcasts select resource subscribers after synchronous observer changes", async () => {
  async function changed(create) {
    const server = create({ name: "test", version: "0" });
    server.resource({ uri: "memo://welcome", name: "welcome" }, () => ({ contents: [] }));
    const events = [],
      mutations = [];
    const first = server.createMessageSession(() => events.push("first"));
    const second = server.createMessageSession(() => events.push("second"));
    for (const session of [first, second]) {
      await session.handleMessage("initialize");
      await session.handleMessage("notifications/initialized");
    }
    await second.handleMessage("resources/subscribe", { uri: "memo://welcome" });
    server.onNotification(() => {
      mutations.push(first.handleMessage("resources/subscribe", { uri: "memo://welcome" }));
      mutations.push(second.handleMessage("resources/unsubscribe", { uri: "memo://welcome" }));
    });
    await server.notifyResourceUpdated("memo://welcome");
    await Promise.all(mutations);
    first.close();
    second.close();
    return events;
  }
  const expected = await changed(referenceCreateServer);
  assert.deepEqual(expected, ["first"]);
  assert.deepEqual(await changed(createServer), expected);
});

test("request-scoped notifications stop after cancellation while pending delivery errors propagate", async () => {
  for (const create of [createServer, referenceCreateServer]) {
    const server = create({ name: "test", version: "0" });
    let started, release;
    const beginning = new Promise((resolve) => {
      started = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const events = [];
    server.method("wait", async (_params, context) => {
      await context.notify("notifications/test", { value: "started" });
      started(context);
      await pending;
      await context.notify("notifications/test", { value: "after-cancel" });
      return {};
    });
    const session = server.createMessageSession((notification) => events.push(notification));
    const request = session.handleMessage("wait", { _meta: metadata }, { requestId: "cancel" });
    const context = await beginning;
    await session.handleMessage("notifications/cancelled", { requestId: "cancel" });
    assert.equal(context.signal.aborted, true);
    assert.deepEqual(await request, { result: undefined });
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events.length, 1);
    session.close();
  }
});
