import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough, Writable } from "node:stream";
import { createServer } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createInterface } from "node:readline";

test("official MCP SDK client initializes and uses tools, prompts and resources over native stdio", async () => {
  const readable = new PassThrough();
  const writable = new PassThrough();
  const server = createServer({ name: "sdk", version: "1" });
  server.tool("echo", "Echo", { type: "object" }, (args) => args.message);
  server.prompt({ name: "review", arguments: [{ name: "code", required: true }] }, (args) => ({
    messages: [{ role: "user", content: { type: "text", text: args.code } }]
  }));
  server.resource({ uri: "memo://welcome", name: "welcome" }, (uri) => ({
    contents: [{ uri, text: "hello" }]
  }));
  server.resourceTemplate({ uriTemplate: "memo://{name}", name: "memo" }, (uri) => ({
    contents: [{ uri, text: uri }]
  }));
  const connected = server.connect({ readable, writable });
  const transport = {
    async start() {
      this.reader = createInterface({ input: writable });
      this.reader.on("line", (line) => this.onmessage?.(JSON.parse(line)));
    },
    async send(message) {
      readable.write(`${JSON.stringify(message)}\n`);
    },
    async close() {
      readable.end();
      this.reader.close();
      this.onclose?.();
    }
  };
  const client = new Client({ name: "oracle", version: "1" });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools[0].name, "echo");
  assert.deepEqual(
    (await client.callTool({ name: "echo", arguments: { message: "\ud800🦀" } })).content,
    [{ type: "text", text: "\ud800🦀" }]
  );
  assert.equal((await client.listPrompts()).prompts[0].name, "review");
  assert.deepEqual(
    (await client.getPrompt({ name: "review", arguments: { code: "main.rs" } })).messages,
    [{ role: "user", content: { type: "text", text: "main.rs" } }]
  );
  assert.equal((await client.listResources()).resources[0].uri, "memo://welcome");
  assert.equal(
    (await client.listResourceTemplates()).resourceTemplates[0].uriTemplate,
    "memo://{name}"
  );
  assert.equal((await client.readResource({ uri: "memo://welcome" })).contents[0].text, "hello");
  assert.equal(
    (await client.readResource({ uri: "memo://other" })).contents[0].text,
    "memo://other"
  );
  await client.close();
  await connected;
});

async function exchange(create, source) {
  const readable = new PassThrough();
  const frames = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      frames.push(chunk.toString());
      callback();
    }
  });
  const server = create({ name: "wire", version: "1" });
  server.tool("echo", "Echo", { type: "object" }, (args) => args.message);
  const connected = server.connect({ readable, writable });
  readable.end(source);
  await connected;
  assert.equal(readable.listenerCount("data"), 0);
  assert.equal(writable.listenerCount("drain"), 0);
  return frames.map((frame) => JSON.parse(frame));
}

test("native stdio exchanges agree with the existing server for wire requests and notifications", async () => {
  const source = [
    '{"jsonrpc":"2.0","method":"initialize"}',
    '{"jsonrpc":"2.0","id":0,"method":"ping"}',
    '{"jsonrpc":"2.0","id":"init","method":"initialize"}',
    '{"jsonrpc":"2.0","id":null,"method":"tools/list"}',
    '{"jsonrpc":"2.0","id":"call","method":"tools/call","params":{"name":"echo","arguments":{"message":"\\ud800🦀"}}}',
    '{"jsonrpc":"2.0","id":1,"method":"notifications/initialized"}',
    "",
    '{"jsonrpc":"2.0","id":42,"method":"ping","params":null}'
  ].join("\r\n");
  // JSON-RPC responses can arrive in any order.
  const byResponse = (a, b) =>
    JSON.stringify([a.id, a.error?.code ?? null]).localeCompare(
      JSON.stringify([b.id, b.error?.code ?? null])
    );
  assert.deepEqual(
    (await exchange(createServer, source)).sort(byResponse),
    (await exchange(referenceCreateServer, source)).sort(byResponse)
  );
});

test("native stdio rejects invalid or truncated UTF8 without executing a callback", async () => {
  for (const bytes of [[0xff], [0xed, 0xa0], [0xf0, 0x9f]]) {
    const readable = new PassThrough();
    const writable = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    });
    const server = createServer({ name: "test", version: "0" });
    let calls = 0;
    server.tool("echo", "Echo", { type: "object" }, () => {
      calls++;
    });
    const connected = server.connect({ readable, writable });
    readable.end(Buffer.from(bytes));
    await assert.rejects(connected, /Invalid UTF-8/);
    assert.equal(calls, 0);
    assert.equal(readable.listenerCount("data"), 0);
    assert.equal(readable.isPaused(), true);
  }
});

test("native output waits for callback and drain before connection completion", async () => {
  const readable = new PassThrough();
  const writable = new PassThrough({ highWaterMark: 1 });
  const server = createServer({ name: "test", version: "0" });
  let finished = false;
  const connected = server.connect({ readable, writable }).then(() => {
    finished = true;
  });
  readable.end('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  const chunks = [];
  writable.on("data", (chunk) => chunks.push(chunk));
  await connected;
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {
    jsonrpc: "2.0",
    id: 1,
    result: {}
  });
  assert.equal(writable.listenerCount("drain"), 0);
});

test("an admitted ping is written before failure on a later oversized line", async () => {
  const line = '{"jsonrpc":"2.0","id":1,"method":"ping"}';
  const readable = new PassThrough();
  const frames = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      frames.push(chunk.toString());
      callback();
    }
  });
  const server = createServer({
    name: "test",
    version: "0",
    maxStdioLineBytes: Buffer.byteLength(line)
  });
  const connected = server.connect({ readable, writable });
  readable.write(`${line}\n${"x".repeat(Buffer.byteLength(line) + 1)}\n`);
  await assert.rejects(connected, /Stdio input line byte limit exceeded/);
  assert.equal(frames.length, 1);
  assert.equal(JSON.parse(frames[0]).id, 1);
});

test("stdio capacities reject unsafe, fractional, and nonfinite values at construction", () => {
  for (const name of ["maxStdioLineBytes", "maxPendingStdioMessages", "maxStdioOutputBytes"]) {
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => createServer({ name: "test", version: "0", [name]: value }),
        new RegExp(`${name} must be a safe integer`)
      );
    }
  }
});

test("input failure preserves falsey reasons and observes an already submitted write's late error", async () => {
  const readable = new PassThrough();
  let callback, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const writable = new Writable({
    write(_chunk, _encoding, complete) {
      callback = complete;
      started();
    }
  });
  const server = createServer({ name: "test", version: "0" });
  const connected = server.connect({ readable, writable }).then(
    () => "resolved",
    (error) => error
  );
  readable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  await ready;
  readable.emit("error", false);
  assert.equal(await connected, false);
  assert.equal(writable.listenerCount("error"), 1);
  callback(new Error("late write"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writable.listenerCount("error"), 0);
  assert.equal(readable.listenerCount("data"), 0);
});

test("output capacity is enforced before submitting an oversized response", async () => {
  const readable = new PassThrough();
  let writes = 0;
  const writable = new Writable({
    write(_chunk, _encoding, callback) {
      writes++;
      callback();
    }
  });
  const server = createServer({ name: "test", version: "0", maxStdioOutputBytes: 10 });
  const connected = server.connect({ readable, writable });
  readable.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  await assert.rejects(connected, /Stdio output byte limit exceeded/);
  assert.equal(writes, 0);
});
