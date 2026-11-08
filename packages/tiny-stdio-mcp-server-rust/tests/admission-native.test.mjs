import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { getEventListeners } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};
const params = (id) => ({ name: "held", arguments: { id }, _meta: meta });

test("tool capacity and FIFO waiting are shared across sessions and queue overflow matches reference", async () => {
  for (const factory of [createServer, referenceCreateServer]) {
    const server = factory({
      name: "test",
      version: "1",
      maxConcurrentToolCalls: 2,
      maxQueuedToolCalls: 2
    });
    const sessions = [server.createMessageSession(), server.createMessageSession()];
    const gate = deferred();
    const started = [];
    server.tool("held", "Held", { type: "object" }, async ({ id }) => {
      started.push(id);
      await gate.promise;
      return id;
    });
    const calls = Array.from({ length: 5 }, (_, id) =>
      sessions[id % 2].handleMessage("tools/call", params(id))
    );
    try {
      await setImmediate();
      assert.deepEqual(started, [0, 1]);
      assert.deepEqual(await calls[4], {
        error: { code: -32000, message: "Too many queued tool calls" }
      });
      gate.resolve();
      await Promise.all(calls);
      assert.deepEqual(started, [0, 1, 2, 3]);
    } finally {
      gate.resolve();
      await Promise.all(calls);
      sessions.forEach((session) => session.close());
    }
  }
});

test("default capacity starts four handlers and queued cancellation never runs a handler", async () => {
  const server = createServer({ name: "test", version: "1" });
  const gate = deferred();
  const started = [];
  server.tool("held", "Held", { type: "object" }, async ({ id }) => {
    started.push(id);
    await gate.promise;
    return id;
  });
  const controllers = Array.from({ length: 6 }, () => new AbortController());
  const calls = controllers.map((controller, id) =>
    server.handleMessage("tools/call", params(id), { requestId: id, signal: controller.signal })
  );
  try {
    await setImmediate();
    assert.deepEqual(started, [0, 1, 2, 3]);
    controllers[4].abort();
    await calls[4];
    gate.resolve();
    await Promise.all(calls);
    assert.deepEqual(started, [0, 1, 2, 3, 5]);
  } finally {
    gate.resolve();
    controllers.forEach((controller) => controller.abort());
    await Promise.all(calls);
  }
});

test("admission options reject invalid capacities and timeouts like TypeScript", () => {
  for (const [name, values] of [
    ["maxConcurrentToolCalls", [0, -1, 1.5, NaN, Infinity, 9007199254740992]],
    ["maxQueuedToolCalls", [-1, 1.5, NaN, Infinity, 9007199254740992]],
    ["toolCallTimeoutMs", [0, -1, 1.5, NaN, Infinity]]
  ])
    for (const value of values) {
      let message;
      try {
        referenceCreateServer({ name: "test", version: "1", [name]: value });
      } catch (error) {
        message = error.message;
      }
      assert.ok(message);
      assert.throws(() => createServer({ name: "test", version: "1", [name]: value }), { message });
    }
});

test("timeouts abort handlers, retain active work and expire queued calls without starting them", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const server = createServer({
    name: "test",
    version: "1",
    maxConcurrentToolCalls: 1,
    maxQueuedToolCalls: 1,
    toolCallTimeoutMs: 10
  });
  const gate = deferred();
  const signals = [];
  server.tool("held", "Held", { type: "object" }, async (_args, context) => {
    signals.push(context.signal);
    await gate.promise;
    return "done";
  });
  const first = server.handleMessage("tools/call", params(1), { requestId: 1 });
  try {
    await setImmediate();
    t.mock.timers.tick(10);
    assert.deepEqual(await first, {
      error: { code: -32603, message: "Tool call timed out: held" }
    });
    assert.equal(signals[0].aborted, true);
    const second = server.handleMessage("tools/call", params(2), { requestId: 2 });
    await setImmediate();
    t.mock.timers.tick(10);
    assert.deepEqual(await second, {
      error: { code: -32603, message: "Tool call timed out: held" }
    });
    assert.equal(signals.length, 1);
    assert.equal(
      (await server.handleMessage("tools/call", params(1), { requestId: 1 })).error.code,
      -32600
    );
    gate.resolve();
    await setImmediate();
    assert.equal(
      (await server.handleMessage("tools/call", params(1), { requestId: 1 })).result.resultType,
      "complete"
    );
    assert.equal(signals.length, 2);
  } finally {
    gate.resolve();
    await first;
    t.mock.timers.reset();
  }
});

test("session close aborts running tools, removes queued work and permits other sessions to continue", async () => {
  const server = createServer({
    name: "test",
    version: "1",
    maxConcurrentToolCalls: 1,
    maxQueuedToolCalls: 2
  });
  const session = server.createMessageSession();
  const gate = deferred();
  const started = [];
  const signals = [];
  server.tool("held", "Held", { type: "object" }, async ({ id }, context) => {
    started.push(id);
    signals.push(context.signal);
    await gate.promise;
    return id;
  });
  const calls = [
    session.handleMessage("tools/call", params(1), { requestId: 1 }),
    session.handleMessage("tools/call", params(2), { requestId: 2 })
  ];
  try {
    await setImmediate();
    session.close();
    assert.deepEqual(await Promise.all(calls), [{ result: undefined }, { result: undefined }]);
    assert.equal(signals[0].aborted, true);
    const third = server.handleMessage("tools/call", params(3));
    await setImmediate();
    assert.deepEqual(started, [1]);
    gate.resolve();
    assert.equal((await third).result.resultType, "complete");
    assert.deepEqual(started, [1, 3]);
  } finally {
    gate.resolve();
    session.close();
    await Promise.all(calls);
  }
});

test("successful and failed tools release capacity and caller listeners across repeated cycles", async () => {
  const server = createServer({
    name: "test",
    version: "1",
    maxConcurrentToolCalls: 1,
    maxQueuedToolCalls: 0
  });
  server.tool("held", "Held", { type: "object" }, ({ id }) => {
    if (id % 2) throw false;
    return id;
  });
  const controller = new AbortController();
  for (let id = 0; id < 128; id++) {
    const response = await server.handleMessage("tools/call", params(id), {
      requestId: id,
      signal: controller.signal
    });
    assert.equal(response.error, undefined);
    assert.equal(response.result.isError === true, Boolean(id % 2));
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

test("official SDK requests share tool admission with direct sessions", async () => {
  const server = createServer({
    name: "test",
    version: "1",
    maxConcurrentToolCalls: 1,
    maxQueuedToolCalls: 1
  });
  const gate = deferred();
  const started = [];
  server.tool("held", "Held", { type: "object" }, async ({ id }) => {
    started.push(id);
    await gate.promise;
    return id;
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const connected = server.connectSDK(serverTransport);
  const client = new Client({ name: "oracle", version: "1" });
  let sdkCall;
  let direct;
  try {
    await client.connect(clientTransport);
    sdkCall = client.callTool({ name: "held", arguments: { id: 1 } });
    await setImmediate();
    direct = server.handleMessage("tools/call", params(2));
    await setImmediate();
    assert.deepEqual(started, [1]);
    assert.equal((await server.handleMessage("tools/call", params(3))).error.code, -32000);
    gate.resolve();
    await Promise.all([sdkCall, direct]);
    assert.deepEqual(started, [1, 2]);
  } finally {
    gate.resolve();
    await Promise.all([sdkCall, direct]);
    await client.close();
    await connected;
  }
});
