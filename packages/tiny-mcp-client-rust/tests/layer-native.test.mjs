import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import * as native from "../dist/index.js";
import * as reference from "tiny-mcp-client";
import { createServer as rustServer } from "../../tiny-stdio-mcp-server-rust/dist/index.js";
import { createServer as referenceServer } from "tiny-stdio-mcp-server";

function setup(factory, limit = 128, timeout = 30000) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames = [];
  output.on("data", (chunk) =>
    frames.push(
      ...String(chunk)
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    )
  );
  const layer = new factory.JsonRpcMessageLayer(input, output, timeout, undefined, limit);
  return {
    layer,
    input,
    output,
    frames,
    close() {
      layer.dispose();
      input.destroy();
      output.destroy();
    }
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("native message layer correlates out-of-order responses, retains errors and bounds exchanges", async () => {
  for (const factory of [native, reference]) {
    const state = setup(factory, 2);
    try {
      const first = state.layer.sendRequest("first", [1]);
      const second = state.layer.sendRequest("second", {});
      assert.throws(() => state.layer.sendRequest("overflow"), {
        message: "JSON-RPC request capacity exceeded"
      });
      assert.deepEqual(
        state.frames.map((frame) => frame.id),
        [1, 2]
      );
      state.input.write(
        '[{"jsonrpc":"2.0","id":"1","result":"wrong"},{"jsonrpc":"2.0","id":2,"result":"second"},{"jsonrpc":"2.0","id":1,"error":{"code":-32123,"message":"broken","data":{"detail":7}}}]\n'
      );
      const error = await first.catch((error) => error);
      assert.ok(error instanceof factory.McpError);
      assert.equal(error.code, -32123);
      assert.deepEqual(error.data, { detail: 7 });
      assert.equal(await second, "second");
      const third = state.layer.sendRequest("third", undefined, { timeoutMs: null });
      assert.equal(state.layer.cancelRequest(3, new Error("stop")), true);
      assert.equal(state.layer.cancelRequest(3, new Error("again")), false);
      await assert.rejects(third, { message: "stop" });
    } finally {
      state.close();
    }
  }
});

test("incoming cancellation keeps running callbacks and duplicate IDs bounded until settlement", async () => {
  for (const factory of [native, reference]) {
    const state = setup(factory, 1);
    const gate = deferred();
    let context;
    let calls = 0;
    state.layer.onRequest("work", (_params, ctx) => {
      calls++;
      context = ctx;
      return gate.promise;
    });
    try {
      state.input.write(
        '[{"jsonrpc":"2.0","id":1,"method":"work"},{"jsonrpc":"2.0","id":1,"method":"work"},{"jsonrpc":"2.0","id":2,"method":"work"}]\n'
      );
      await setImmediate();
      assert.equal(calls, 1);
      assert.equal(state.frames[0].error.code, -32600);
      assert.equal(state.frames[1].error.code, -32000);
      state.input.write(
        '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}\n'
      );
      await setImmediate();
      assert.equal(context.signal.aborted, true);
      gate.resolve("done");
      await setImmediate();
      assert.equal(
        state.frames.some((frame) => frame.id === 1 && "result" in frame),
        false
      );
      state.input.write('{"jsonrpc":"2.0","id":1,"method":"work"}\n');
      await setImmediate();
      assert.equal(calls, 2);
      assert.equal(state.frames.at(-1).result, "done");
    } finally {
      gate.resolve("done");
      state.close();
    }
  }
});

test("disposal aborts outgoing exchanges and active incoming callback signals without late writes", async () => {
  const state = setup(native);
  const gate = deferred();
  let signal;
  state.layer.onRequest("work", (_params, context) => {
    signal = context.signal;
    return gate.promise;
  });
  const pending = state.layer.sendRequest("outgoing").catch((error) => error);
  state.input.write('{"jsonrpc":"2.0","id":8,"method":"work"}\n');
  await setImmediate();
  const reason = new Error("closed by caller");
  state.layer.dispose(reason);
  assert.equal(await pending, reason);
  assert.equal(signal.aborted, true);
  assert.throws(
    () => state.layer.sendNotification("notify"),
    (error) => error === reason
  );
  gate.resolve("late");
  await setImmediate();
  assert.equal(state.frames.length, 1);
  state.close();
});

test("onRequestId runs before cancellation registration and callback failures release exchange capacity", async () => {
  for (const factory of [native, reference]) {
    const state = setup(factory, 1);
    try {
      const pending = state.layer.sendRequest(
        "ping",
        {},
        {
          onRequestId(id) {
            assert.equal(state.layer.cancelRequest(id, new Error("too early")), false);
          }
        }
      );
      state.input.write('{"jsonrpc":"2.0","id":1,"result":{}}\n');
      assert.deepEqual(await pending, {});
      const reason = new Error("hook failed");
      await assert.rejects(
        state.layer.sendRequest(
          "unused",
          {},
          {
            onRequestId() {
              throw reason;
            }
          }
        ),
        (error) => error === reason
      );
      const next = state.layer.sendRequest("next", {});
      state.input.write('{"jsonrpc":"2.0","id":3,"result":"recovered"}\n');
      assert.equal(await next, "recovered");
    } finally {
      state.close();
    }
  }
});

test("request timeout and caller cancellation clear timers, hooks and future capacity", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const factory of [native, reference]) {
    const state = setup(factory, 1, 10);
    try {
      let timedOut;
      const expired = state.layer.sendRequest(
        "slow",
        {},
        {
          onTimeout(id) {
            timedOut = id;
          }
        }
      );
      t.mock.timers.tick(10);
      await assert.rejects(expired, { message: 'JSON-RPC request "slow" timed out after 10ms' });
      assert.equal(timedOut, 1);
      const controller = new AbortController();
      const canceled = state.layer.sendRequest("cancel", {}, { signal: controller.signal });
      const reason = new Error("caller stop");
      controller.abort(reason);
      await assert.rejects(canceled, (error) => error === reason);
      state.input.write(
        '[{"jsonrpc":"2.0","id":1,"result":"late"},{"jsonrpc":"2.0","id":2,"result":"late"}]\n'
      );
      const next = state.layer.sendRequest("next", {}, { timeoutMs: null });
      state.input.write('{"jsonrpc":"2.0","id":3,"result":"ok"}\n');
      assert.equal(await next, "ok");
    } finally {
      state.close();
    }
  }
  t.mock.timers.reset();
});

test("non-JSON incoming callback results return the existing internal-error diagnostics", async () => {
  for (const factory of [native, reference]) {
    const state = setup(factory);
    try {
      for (const [index, result] of [undefined, () => 7, NaN, { value: undefined }].entries()) {
        state.layer.onRequest("invalid", () => result);
        state.input.write(JSON.stringify({ jsonrpc: "2.0", id: index, method: "invalid" }) + "\n");
        await setImmediate();
        assert.deepEqual(state.frames.at(-1), {
          jsonrpc: "2.0",
          id: index,
          error: {
            code: -32603,
            message: "Response result must contain only JSON values"
          }
        });
      }
    } finally {
      state.close();
    }
  }
});

test("notification processing precedes later batch admission and observes protocol-mode changes", async () => {
  for (const factory of [native, reference]) {
    const state = setup(factory);
    let calls = 0;
    state.layer.onRequest("work", () => {
      calls++;
      return {};
    });
    state.layer.onNotification("switch", async () => {
      state.layer.requestMetadata = {};
    });
    try {
      state.input.write(
        '[{"jsonrpc":"2.0","method":"switch"},{"jsonrpc":"2.0","id":1,"method":"work"}]\n'
      );
      await setImmediate();
      assert.equal(calls, 0);
      assert.deepEqual(state.frames, [
        {
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32600, message: "Modern MCP servers cannot initiate JSON-RPC requests" }
        }
      ]);
    } finally {
      state.close();
    }
  }
});

test("native message layer initializes and invokes both Rust and TypeScript stdio servers", async () => {
  for (const factory of [rustServer, referenceServer]) {
    const requests = new PassThrough();
    const replies = new PassThrough();
    const server = factory({ name: "test", version: "1" });
    server.tool("echo", "Echo", { type: "object" }, (args) => args.message);
    const connected = server.connect({ readable: requests, writable: replies });
    const layer = new native.JsonRpcMessageLayer(replies, requests);
    try {
      const initialized = await layer.sendRequest("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "oracle", version: "1" }
      });
      assert.equal(initialized.serverInfo.name, "test");
      layer.sendNotification("notifications/initialized");
      assert.equal((await layer.sendRequest("tools/list")).tools[0].name, "echo");
      assert.deepEqual(
        (
          await layer.sendRequest("tools/call", {
            name: "echo",
            arguments: { message: "hello\ud800" }
          })
        ).content,
        [{ type: "text", text: "hello\ud800" }]
      );
    } finally {
      layer.dispose();
      requests.end();
      await connected;
      replies.destroy();
    }
  }
});
