import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { createServer } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";

test("native admission keeps duplicate IDs and cancelled operations active until settlement", async () => {
  const server = createServer({ name: "test", version: "0", maxActiveRequests: 1 });
  let release;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  server.tool("wait", "Wait", { type: "object" }, () => {
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const session = server.createMessageSession();
  await session.handleMessage("initialize");
  const operation = session.handleMessage("tools/call", { name: "wait" }, { requestId: "one" });
  await ready;
  assert.deepEqual(await session.handleMessage("ping"), {
    error: { code: -32000, message: "Too many active requests" }
  });
  assert.deepEqual(await session.handleMessage("notifications/cancelled", { requestId: "one" }), {
    result: undefined
  });
  assert.deepEqual(await operation, { result: undefined });
  assert.deepEqual(await session.handleMessage("ping"), {
    error: { code: -32000, message: "Too many active requests" }
  });
  release("late");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await session.handleMessage("ping"), { result: {} });
  session.close();
});

test("native admission rejects duplicate IDs within one session and isolates other sessions", async () => {
  const server = createServer({ name: "test", version: "0" });
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  server.tool("wait", "Wait", { type: "object" }, () => {
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const session = server.createMessageSession();
  await session.handleMessage("initialize");
  const operation = session.handleMessage("tools/call", { name: "wait" }, { requestId: 1 });
  await ready;
  assert.deepEqual(await session.handleMessage("ping", undefined, { requestId: 1 }), {
    error: { code: -32600, message: "Request ID is already active" }
  });
  const other = server.createMessageSession();
  assert.deepEqual(await other.handleMessage("ping", undefined, { requestId: 1 }), { result: {} });
  release("done");
  await operation;
  assert.deepEqual(await session.handleMessage("ping", undefined, { requestId: 1 }), {
    result: {}
  });
  session.close();
  other.close();
});

test("modern requests validate context IDs and abort their context signal after completion", async () => {
  const server = createServer({ name: "test", version: "0" });
  let signal;
  let calls = 0;
  server.tool("echo", "Echo", { type: "object" }, (_args, context) => {
    calls++;
    signal = context.signal;
    return "done";
  });
  const params = {
    name: "echo",
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  };
  assert.deepEqual(await server.handleMessage("tools/call", params, { requestId: 0.5 }), {
    error: { code: -32600, message: "Invalid Request ID" }
  });
  assert.equal(calls, 0);
  assert.equal(
    (await server.handleMessage("tools/call", params, { requestId: "one" })).error,
    undefined
  );
  assert.equal(signal.aborted, true);
});

test("proxy descriptor traps can reenter native state and close the converting session", async () => {
  const { NativeServer } = createRequire(import.meta.url)(
    "../dist/tiny-stdio-mcp-server-rust.node"
  );
  const native = new NativeServer({ name: "test", version: "0" });
  const session = native.createSession();
  let closed = false;
  const params = new Proxy(
    { value: 1 },
    {
      getOwnPropertyDescriptor(target, key) {
        if (!closed) {
          closed = true;
          assert.equal(native.closeSession(session), true);
          const other = native.createSession();
          assert.equal(native.dispatch(other, "ping", undefined).type, "reply");
          native.closeSession(other);
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    }
  );
  assert.equal(native.dispatch(session, "ping", params).type, "none");
  assert.equal(native.sessionCount, 0);
});

test("native conversion preserves component JSON budgets inside request envelopes", async () => {
  let metadata = null;
  for (let i = 0; i < 64; i++) metadata = { value: metadata };
  const server = createServer({ name: "test", version: "0" });
  assert.deepEqual(await server.handleMessage("ping", { _meta: metadata }), { result: {} });
  server.tool("count", "Count", { type: "object" }, (args) => args.values.length);
  await server.handleMessage("initialize");
  assert.deepEqual(
    await server.handleMessage("tools/call", {
      name: "count",
      arguments: { values: new Array(9998).fill(null) }
    }),
    { result: { content: [{ type: "text", text: "9998" }] } }
  );
});

test("native conversion preserves null prototypes, shared references, and UTF16 keys", async () => {
  const server = createServer({ name: "test", version: "0" });
  const shared = Object.create(null);
  shared["\ud800\u0000"] = "\udfff";
  shared.__proto__ = "data";
  server.tool("echo", "Echo", { type: "object" }, (args) => {
    assert.deepEqual(args.a, args.b);
    assert.equal(Object.hasOwn(args.a, "__proto__"), true);
    assert.equal(args.a["\ud800\u0000"], "\udfff");
    return "ok";
  });
  await server.handleMessage("initialize");
  assert.equal(
    (
      await server.handleMessage("tools/call", {
        name: "echo",
        arguments: { a: shared, b: shared }
      })
    ).error,
    undefined
  );
});

test("tool returns preserve undefined array entries and nonfinite primitive text", async () => {
  for (const result of [["one", undefined, ["two", undefined]], Infinity, -Infinity, NaN]) {
    const native = createServer({ name: "test", version: "0" });
    const reference = referenceCreateServer({ name: "test", version: "0" });
    for (const server of [native, reference]) {
      server.tool("return", "Return", { type: "object" }, () => result);
      await server.handleMessage("initialize");
    }
    assert.deepEqual(
      await native.handleMessage("tools/call", { name: "return" }),
      await reference.handleMessage("tools/call", { name: "return" })
    );
  }
});

test("invalid tool return objects do not execute getters or serialization hooks", async () => {
  let effects = 0;
  for (const result of [
    {
      get value() {
        effects++;
        return 1;
      }
    },
    {
      value: 1,
      toJSON() {
        effects++;
        return { value: 1 };
      }
    },
    { value: NaN },
    new Date(0),
    new Array(2)
  ]) {
    const server = createServer({ name: "test", version: "0" });
    server.tool("return", "Return", { type: "object" }, () => result);
    await server.handleMessage("initialize");
    const response = await server.handleMessage("tools/call", { name: "return" });
    assert.equal(response.error?.code, -32603);
    assert.equal(effects, 0);
  }
});

test("both native addons load and release independently in worker environments", async () => {
  const serverUrl = new URL("../dist/index.js", import.meta.url).href;
  const protocolUrl = new URL("../../mcp-protocol-rust/dist/index.js", import.meta.url).href;
  await Promise.all(
    Array.from(
      { length: 3 },
      () =>
        new Promise((resolve, reject) => {
          const worker = new Worker(
            `
      const { parentPort } = require("node:worker_threads");
      (async () => {
        const { createServer } = await import(${JSON.stringify(serverUrl)});
        const { parseMessage } = await import(${JSON.stringify(protocolUrl)});
        const server = createServer({ name: "worker", version: "0" });
        const session = server.createMessageSession();
        for (let i = 0; i < 50; i++) {
          await session.handleMessage("ping");
          parseMessage('{"jsonrpc":"2.0","method":"ping"}');
        }
        session.close();
        parentPort.postMessage("done");
      })();
    `,
            { eval: true }
          );
          let received = false;
          worker.on("message", (value) => {
            received = value === "done";
          });
          worker.on("error", reject);
          worker.on("exit", (code) => {
            if (code === 0 && received) resolve();
            else reject(new Error(`Worker failed: ${code}`));
          });
        })
    )
  );
});

test("modern callback context preserves capabilities and resumable input", async () => {
  const server = createServer({ name: "test", version: "0" });
  const capabilities = { sampling: { tools: {} }, elicitation: { form: {} } };
  server.tool("echo", "Echo", { type: "object" }, (_args, context) => {
    assert.deepEqual(context.clientCapabilities, capabilities);
    assert.equal(context.requestState, "resume-one");
    assert.deepEqual(context.inputResponses, { form: { answer: 42 } });
    return "done";
  });
  const session = server.createMessageSession();
  const result = await session.handleMessage("tools/call", {
    name: "echo",
    requestState: "resume-one",
    inputResponses: { form: { answer: 42 } },
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": capabilities
    }
  });
  assert.equal(result.error, undefined);
  session.close();
});

test("actual native engine initializes a session and runs an async JavaScript echo", async () => {
  const server = createServer({ name: "native-echo", version: "1.0" });
  let calls = 0;
  server.tool("echo", "Echo", { type: "object" }, async (args, context) => {
    assert.equal(context.signal.aborted, false);
    assert.deepEqual(context.clientCapabilities, {});
    calls++;
    await Promise.resolve();
    return args.message;
  });
  const session = server.createMessageSession();
  const initialized = await session.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  assert.deepEqual(initialized.result.serverInfo, { name: "native-echo", version: "1.0" });
  assert.deepEqual(
    await session.handleMessage("tools/call", { name: "echo", arguments: { message: "\ud800🦀" } }),
    {
      result: { content: [{ type: "text", text: "\ud800🦀" }] }
    }
  );
  assert.equal(calls, 1);
  session.close();
});

test("session close removes the native session exactly once", () => {
  const { NativeServer } = createRequire(import.meta.url)(
    "../dist/tiny-stdio-mcp-server-rust.node"
  );
  const native = new NativeServer({ name: "test", version: "0" });
  for (let i = 0; i < 20; i++) {
    const id = native.createSession();
    assert.equal(native.sessionCount, 1);
    assert.equal(native.closeSession(id), true);
    assert.equal(native.closeSession(id), false);
    assert.equal(native.sessionCount, 0);
  }
});

test("native lifecycle and tool descriptors agree with the existing server", async () => {
  const options = {
    name: "test",
    version: "1.0",
    supportNotifications: false,
    supportResourceSubscriptions: false
  };
  const native = createServer(options);
  const reference = referenceCreateServer(options);
  const callback = async (args) => args.message;
  for (const server of [native, reference]) {
    server.tool("echo", "Echo", { type: "object" }, callback);
  }
  const a = native.createMessageSession(),
    b = reference.createMessageSession();
  for (const [method, params] of [
    ["tools/list"],
    ["ping"],
    ["notifications/initialized"],
    ["initialize", { protocolVersion: "2025-03-26" }],
    ["tools/list"],
    ["notifications/initialized"],
    ["tools/call", { name: "echo", arguments: { message: "hello" } }],
    ["tools/call", { name: "missing" }],
    ["future/method"]
  ]) {
    assert.deepEqual(
      await a.handleMessage(method, params),
      await b.handleMessage(method, params),
      method
    );
  }
  a.close();
  b.close();
  assert.deepEqual(await a.handleMessage("ping"), await b.handleMessage("ping"));
});

test("cancellation returns without waiting for an ignored signal and observes late rejection", async () => {
  const server = createServer({ name: "test", version: "0" });
  let reject;
  let started;
  let signal;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  server.tool("wait", "Wait", { type: "object" }, (_args, context) => {
    signal = context.signal;
    started();
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  const session = server.createMessageSession();
  await session.handleMessage("initialize");
  const parent = new AbortController();
  const operation = session.handleMessage(
    "tools/call",
    { name: "wait" },
    { signal: parent.signal, requestId: "one" }
  );
  await ready;
  parent.abort(new Error("stop"));
  assert.equal(signal.aborted, true);
  assert.deepEqual(await operation, { result: undefined });
  reject(new Error("late"));
  await Promise.resolve();
  await Promise.resolve();
  session.close();
});

test("closing a session aborts its callback and leaves another session usable", async () => {
  const server = createServer({ name: "test", version: "0" });
  let release, started, signal;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  server.tool("wait", "Wait", { type: "object" }, (_args, context) => {
    signal = context.signal;
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const session = server.createMessageSession();
  await session.handleMessage("initialize");
  const operation = session.handleMessage("tools/call", { name: "wait" }, { requestId: 1 });
  await ready;
  session.close();
  session.close();
  assert.equal(signal.aborted, true);
  assert.deepEqual(await operation, { result: undefined });
  release("late");
  await Promise.resolve();
  const other = server.createMessageSession();
  assert.deepEqual(await other.handleMessage("ping"), { result: {} });
  other.close();
});
