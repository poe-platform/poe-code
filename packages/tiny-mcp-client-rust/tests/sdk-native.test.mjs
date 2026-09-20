import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../../tiny-stdio-mcp-server-rust/dist/index.js";
test("own SDK test pairs connect the Rust client to an official SDK server", { timeout: 1000 }, async () => {
  const server = new Server({ name: "official", version: "1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{ name: "echo", inputSchema: { type: "object" } }] }));
  server.setRequestHandler(CallToolRequestSchema, request => ({ content: [{ type: "text", text: request.params.arguments?.message }] }));
  const pair = await native.createSdkTestPair(server, () => new native.McpClient({ clientInfo: { name: "client", version: "1" }, protocolVersion: "2025-03-26" }));
  try {
    assert.equal((await pair.client.listTools()).tools[0].name, "echo");
    assert.equal((await pair.client.callTool({ name: "echo", arguments: { message: "🦊\ud800" } })).content[0].text, "🦊\ud800");
    await pair.client.ping();
  } finally { await pair.cleanup(); }
});
test("own stream test pairs use the Rust server without runtime SDK dependencies", { timeout: 1000 }, async () => {
  const server = createServer({ name: "rust", version: "1" });
  server.tool("echo", "Echo", { type: "object" }, args => args.message);
  const pair = await native.createTestPair(server, () => new native.McpClient({ clientInfo: { name: "client", version: "1" } }));
  try { assert.equal((await pair.client.callTool({ name: "echo", arguments: { message: "hello" } })).content[0].text, "hello"); }
  finally { await pair.cleanup(); }
});

test("SDK and stream setup failures close created transports and await server cleanup", { timeout: 1000 }, async () => {
  const reason = new Error("client failed");
  let serverClosed = 0; let connection;
  const sdkServer = { async connect(transport) { connection = transport; transport.onclose = () => serverClosed++; await transport.start(); } };
  await assert.rejects(native.createSdkTestPair(sdkServer, () => ({ async connect() { throw reason; }, async close() {} })), error => error === reason);
  assert.equal(serverClosed, 1);
  await assert.rejects(connection.send({ jsonrpc: "2.0", method: "ping" }), { message: "Not connected" });
  let streamEnded = false;
  const streamServer = { async connect(transport) { for await (const _chunk of transport.readable) {} streamEnded = true; } };
  await assert.rejects(native.createTestPair(streamServer, () => ({ async connect() { throw reason; }, async close() {} })), error => error === reason);
  assert.equal(streamEnded, true);
});
test("SDK wire parsing rejects malformed objects while preserving raw UTF16 diagnostics", async () => {
  const { createRequire } = await import("node:module");
  const { parseSdkMessage } = createRequire(import.meta.url)("../dist/tiny-mcp-client-rust.node");
  for (const text of ["null", "[]", "{\ud800"]) assert.deepEqual(parseSdkMessage(text), { error: "Malformed JSON line: " + text });
  assert.deepEqual(parseSdkMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}'), { message: { jsonrpc: "2.0", id: 1, method: "ping" } });
});

test("test pair factory failures dispose transports and preserve the factory error", async () => {
  const reason = new Error("factory failed");
  let sdk; let closes = 0;
  try {
    await assert.rejects(native.createSdkTestPair({ async connect(transport) { sdk = transport; transport.onclose = () => closes++; await transport.start(); } }, () => { throw reason; }), error => error === reason);
    assert.equal(closes, 1);
  } finally { await sdk?.close(); }
  let streams;
  try {
    await assert.rejects(native.createTestPair({ async connect(transport) { streams = transport; } }, () => { throw reason; }), error => error === reason);
    assert.equal(streams.readable.writableEnded, true);
    assert.equal(streams.writable.writableEnded, true);
  } finally { streams?.readable.destroy(); streams?.writable.destroy(); }
});

test("test pair cleanup disposes transports even when client close rejects", async () => {
  const reason = new Error("close failed");
  let sdk; let closes = 0;
  const pair = await native.createSdkTestPair({ async connect(transport) { sdk = transport; transport.onclose = () => closes++; await transport.start(); } }, () => ({ async connect() {}, async close() { throw reason; } }));
  try {
    await assert.rejects(pair.cleanup(), error => error === reason);
    assert.equal(closes, 1);
  } finally { await sdk.close(); }
  let streams;
  const streamPair = await native.createTestPair({ async connect(transport) { streams = transport; } }, () => ({ async connect() {}, async close() { throw reason; } }));
  try {
    await assert.rejects(streamPair.cleanup(), error => error === reason);
    assert.equal(streams.readable.writableEnded, true);
    assert.equal(streams.writable.writableEnded, true);
  } finally { streams.readable.destroy(); streams.writable.destroy(); }
});

test("synchronous and asynchronous server startup failures close pairs without unhandled rejections", { timeout: 1000 }, async () => {
  for (const helper of [native.createSdkTestPair, native.createTestPair]) for (const synchronous of [true, false]) {
    const reason = new Error(`server failed ${synchronous}`);
    const server = { connect() { if (synchronous) throw reason; return Promise.reject(reason); } };
    await assert.rejects(helper(server, () => new native.McpClient({ clientInfo: { name: "client", version: "1" }, protocolVersion: "2025-03-26" })), error => error === reason);
  }
});
