import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/index.js";
import * as reference from "../../poe-acp-client/dist/index.js";
test("packet parser matches original dialect and diagnostic classes", () => {
  const fixtures = [
    "{bad",
    "null",
    "[]",
    "1",
    ...["null", "1", "-1", "1.5", "9007199254740992", '""', '"a"', "true", "{}"].flatMap((id) => [
      `{"jsonrpc":"2.0","id":${id},"method":"echo","params":3}`,
      `{"jsonrpc":"2.0","id":${id},"result":null}`,
      `{"jsonrpc":"2.0","id":${id},"error":{"code":-32602,"message":"bad","data":{"a":1}}}`
    ])
  ];
  const normalized = (parsed) =>
    parsed.type === "invalid"
      ? {
          ...parsed,
          error: { code: parsed.error.code, message: parsed.error.message, data: parsed.error.data }
        }
      : parsed;
  for (const fixture of fixtures) {
    const parsed = own.parseJsonRpcMessage(fixture);
    if (parsed.type === "invalid") assert.ok(parsed.error instanceof own.AcpError);
    assert.deepEqual(
      normalized(parsed),
      normalized(reference.parseJsonRpcMessage(fixture)),
      fixture
    );
  }
});
test("complete session update validation compares malformed field combinations", () => {
  const variants = [
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "audio", data: "x", mimeType: "audio/mpeg" }
    },
    {
      sessionUpdate: "tool_call",
      toolCallId: "t",
      title: "Run",
      kind: "execute",
      status: "pending"
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "t",
      kind: null,
      status: null,
      content: null,
      locations: null
    },
    { sessionUpdate: "plan", entries: [{ content: "x", priority: "high", status: "pending" }] },
    { sessionUpdate: "usage_update", used: 1, size: 2, cost: { amount: 0.2, currency: "USD" } },
    { sessionUpdate: "current_mode_update", currentModeId: "auto" },
    {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "x", description: "Use", input: { hint: "args" } }]
    },
    { sessionUpdate: "session_info_update", title: "hello", updatedAt: "2026-09-21" },
    {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          type: "select",
          id: "model",
          name: "Model",
          currentValue: "a",
          options: [{ value: "a", name: "A" }]
        }
      ]
    }
  ];
  let comparisons = 0;
  for (const update of variants) {
    const sources = [
      update,
      ...Object.keys(update).flatMap((key) =>
        [undefined, null, false, 1, "bad", [], {}].map((value) => ({ ...update, [key]: value }))
      )
    ];
    for (const value of sources) {
      const source = JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "s", update: value }
      });
      assert.deepEqual(
        own.parseSessionUpdate(source),
        reference.parseSessionUpdate(source),
        source
      );
      comparisons++;
    }
  }
  assert.ok(comparisons > 200);
});
test("a notification can register a handler for the next frame in the same chunk", async () => {
  const { PassThrough } = await import("node:stream");
  const replies = [];
  for (const implementation of [reference, own]) {
    const input = new PassThrough(),
      output = new PassThrough(),
      layer = new implementation.JsonRpcMessageLayer({ input, output });
    const reply = new Promise((resolve) =>
      output.once("data", (chunk) => resolve(JSON.parse(String(chunk))))
    );
    layer.onNotification("register", () => layer.onRequest("echo", () => "ready"));
    input.write(
      '{"jsonrpc":"2.0","method":"register"}\n{"jsonrpc":"2.0","id":1,"method":"echo"}\n'
    );
    replies.push(await reply);
    layer.dispose();
    input.end();
    output.end();
  }
  assert.deepEqual(replies[1], replies[0]);
  assert.equal(replies[0].result, "ready");
});
test("a rejected termination signal does not invent a process exit signal", async () => {
  const { PassThrough } = await import("node:stream"),
    { EventEmitter } = await import("node:events");
  const signals = [];
  for (const implementation of [reference, own]) {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: () => false
    });
    const transport = new implementation.AcpTransport({ command: "fixture", spawn: () => child });
    transport.dispose();
    signals.push((await transport.closed).signal);
    child.stdout.end();
    child.stderr.end();
  }
  assert.equal(signals[0], null);
  assert.deepEqual(signals[1], signals[0]);
});
test("prompt updates preserve opaque raw payload and notification identity", async () => {
  for (const implementation of [reference, own]) {
    const notifications = new Map();
    let finish;
    const transport = {
      onRequest() {},
      onNotification(method, handler) {
        notifications.set(method, handler);
      },
      sendNotification() {},
      sendRequest(method) {
        return method === "initialize"
          ? Promise.resolve({ protocolVersion: 1 })
          : new Promise((resolve) => {
              finish = resolve;
            });
      }
    };
    const client = new implementation.AcpClient({ transport });
    await client.initialize();
    const turn = client.prompt("s", []),
      raw = {};
    raw.self = raw;
    const params = {
      sessionId: "s",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t",
        title: "Opaque",
        rawInput: raw,
        extension: raw,
        _meta: { cycle: raw }
      }
    };
    notifications.get("session/update")(params);
    finish({ stopReason: "completed" });
    await turn.response;
    const result = await turn[Symbol.asyncIterator]().next();
    assert.equal(result.value.params, params);
    assert.equal(result.value.params.update.rawInput, raw);
    await client.dispose();
  }
});
test("notification validation never invokes structural accessors or serialization hooks", async () => {
  const notifications = new Map();
  let finish,
    reads = 0;
  const transport = {
    onRequest() {},
    onNotification(method, handler) {
      notifications.set(method, handler);
    },
    sendNotification() {},
    sendRequest(method) {
      return method === "initialize"
        ? Promise.resolve({ protocolVersion: 1 })
        : new Promise((resolve) => {
            finish = resolve;
          });
    }
  };
  const client = new own.AcpClient({ transport });
  await client.initialize();
  const turn = client.prompt("s", []);
  const accessor = {
    sessionId: "s",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        get text() {
          reads++;
          return "unsafe";
        }
      }
    }
  };
  assert.throws(() => notifications.get("session/update")(accessor), /data properties/);
  assert.equal(reads, 0);
  const hooked = {
    sessionId: "s",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "safe" },
      toJSON() {
        reads++;
        throw Error("hook");
      }
    }
  };
  notifications.get("session/update")(hooked);
  assert.equal(reads, 0);
  finish({ stopReason: "completed" });
  await turn.response;
  const iterator = turn[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.params, hooked);
  assert.equal((await iterator.next()).done, true);
  await client.dispose();
});
