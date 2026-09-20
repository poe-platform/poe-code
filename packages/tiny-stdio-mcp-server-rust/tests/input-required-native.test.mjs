import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";

function params(capabilities = {}) {
  return {
    name: "retry",
    uri: "memo://retry",
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": capabilities
    }
  };
}

function register(server, handler) {
  server.registerTool({
    name: "retry", inputSchema: { type: "object" },
    outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] }
  }, handler);
  server.prompt({ name: "retry" }, handler);
  server.resource({ name: "retry", uri: "memo://retry" }, handler);
  server.method("custom/retry", handler);
  return server;
}

for (const method of ["tools/call", "prompts/get", "resources/read"]) {
  test(`${method} retries preserve opaque state and bypass complete result contracts`, async () => {
    const contexts = [];
    const server = register(createServer({ name: "retry", version: "1" }), (_argument, context) => {
      contexts.push(context);
      if (context.requestState === "\u0000opaque\ud800")
        return method === "tools/call" ? { value: "done" }
          : method === "prompts/get" ? { messages: [] } : { contents: [] };
      return { resultType: "input_required", requestState: "\u0000opaque\ud800" };
    });
    const first = await server.handleMessage(method, params());
    assert.deepEqual(first, { result: {
      resultType: "input_required", requestState: "\u0000opaque\ud800",
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "retry", version: "1" } }
    } });
    const second = await server.handleMessage(method, {
      ...params(), requestState: first.result.requestState,
      inputResponses: { login: { action: "accept" } }
    });
    assert.equal(second.result.resultType, "complete");
    assert.equal(contexts[1].requestState, first.result.requestState);
    assert.deepEqual(contexts[1].inputResponses, { login: { action: "accept" } });
    assert.ok(contexts[1].signal instanceof AbortSignal);
    if (method === "resources/read") assert.equal(second.result.ttlMs, 0);
  });
}

test("handler input requirements match reference capabilities and malformed result validation", async () => {
  const roots = { method: "roots/list" };
  const sampling = { method: "sampling/createMessage", params: { messages: [], maxTokens: 1 } };
  for (const method of ["tools/call", "prompts/get", "resources/read", "custom/retry"]) {
    for (const [value, capabilities] of [
      [{ resultType: "input_required", requestState: "opaque" }, {}],
      [{ resultType: "input_required", inputRequests: { roots } }, { roots: {} }],
      [{ resultType: "input_required", inputRequests: { roots, sampling } }, {}],
      [{ resultType: "input_required", inputRequests: { sampling } }, { sampling: {} }],
      [{ resultType: "input_required" }, {}],
      [{ resultType: "input_required", requestState: 1 }, {}],
      [{ resultType: "input_required", inputRequests: [] }, {}],
      [{ resultType: "input_required", inputRequests: { bad: { method: "unknown" } } }, {}],
      [{ resultType: "input_required", inputRequests: { sampling: { ...sampling, params: { ...sampling.params, tools: [] } } } }, { sampling: {} }]
    ]) {
      const native = register(createServer({ name: "retry", version: "1" }), () => value);
      const reference = register(referenceCreateServer({ name: "retry", version: "1" }), () => value);
      assert.deepEqual(await native.handleMessage(method, params(capabilities)),
        await reference.handleMessage(method, params(capabilities)), JSON.stringify({ method, value, capabilities }));
    }
  }
});

test("non-JSON input requests return RPC errors without executing accessors or hooks", async () => {
  let calls = 0;
  const cycle = { method: "roots/list" };
  cycle.extra = cycle;
  const accessor = Object.defineProperty({ method: "roots/list" }, "extra", {
    enumerable: true, get() { calls++; return "value"; }
  });
  for (const request of [cycle, accessor, ...[undefined, NaN, Infinity, 1n].map(extra => ({ method: "roots/list", extra }))]) {
    const server = register(createServer({ name: "retry", version: "1" }), () => ({
      resultType: "input_required", inputRequests: { roots: request }
    }));
    for (const method of ["tools/call", "prompts/get", "resources/read"])
      assert.deepEqual(await server.handleMessage(method, params({ roots: {} })), {
        error: { code: -32603, message: "Invalid MCP input_required result" }
      });
  }
  assert.equal(calls, 0);
});

test("wire retries pass input results back into the handler", async () => {
  const server = register(createServer({ name: "retry", version: "1" }), (_argument, context) =>
    context.inputResponses?.roots ? { value: context.inputResponses.roots.roots[0].uri } : {
      resultType: "input_required", requestState: "state",
      inputRequests: { roots: { method: "roots/list" } }
    });
  const session = server.createMessageSession();
  const first = JSON.parse(await session.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1,
    method: "tools/call", params: params({ roots: {} }) })));
  assert.equal(first.result.resultType, "input_required");
  const second = JSON.parse(await session.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 2,
    method: "tools/call", params: { ...params({ roots: {} }), requestState: first.result.requestState,
      inputResponses: { roots: { roots: [{ uri: "file:///workspace" }] } } } })));
  assert.deepEqual(second.result.structuredContent, { value: "file:///workspace" });
  session.close();
});

test("concurrent input requirements retain admission capabilities despite handler mutations", async () => {
  const releases = [];
  const server = register(createServer({ name: "retry", version: "1" }), async (_argument, context) => {
    context.clientCapabilities.roots = {};
    await new Promise(resolve => releases.push(resolve));
    return { resultType: "input_required", inputRequests: { roots: { method: "roots/list" } } };
  });
  const session = server.createMessageSession();
  const supported = params({ roots: {} });
  const first = session.handleMessage("tools/call", supported, { requestId: "first" });
  const second = session.handleMessage("tools/call", params(), { requestId: "second" });
  await Promise.resolve();
  delete supported._meta["io.modelcontextprotocol/clientCapabilities"].roots;
  releases[1]();
  assert.equal((await second).error.code, -32021);
  releases[0]();
  assert.equal((await first).result.resultType, "input_required");
  session.close();
});

test("canceled input callbacks retain capacity until settled and do not contaminate a reused ID", async () => {
  let release;
  const server = register(createServer({ name: "retry", version: "1", maxActiveRequests: 1 }),
    async () => {
      await new Promise(resolve => { release = resolve; });
      return { resultType: "input_required", inputRequests: { roots: { method: "roots/list" } } };
    });
  const session = server.createMessageSession();
  const pending = session.handleMessage("tools/call", params({ roots: {} }), { requestId: "same" });
  await Promise.resolve();
  await session.handleMessage("notifications/cancelled", { requestId: "same" });
  assert.deepEqual(await pending, { result: undefined });
  assert.ok((await session.handleMessage("tools/call", params(), { requestId: "other" })).error);
  release();
  // Allow the handler completion and its finally cleanup to settle.
  await new Promise(resolve => setImmediate(resolve));
  const next = session.handleMessage("tools/call", params(), { requestId: "same" });
  await Promise.resolve();
  release();
  assert.equal((await next).error.code, -32021);
  session.close();
});

test("stdio and SDK transports deliver input requirements and retry results", async () => {
  function server() {
    return register(createServer({ name: "retry", version: "1" }), (_argument, context) =>
      context.requestState === "state" ? { value: "done" } : {
        resultType: "input_required", requestState: "state"
      });
  }
  const messages = [1, 2].map(id => ({ jsonrpc: "2.0", id, method: "tools/call",
    params: { ...params(), ...(id === 2 ? { requestState: "state", inputResponses: {} } : {}) } }));
  const readable = new PassThrough(), writable = new PassThrough();
  let output = "";
  writable.on("data", chunk => { output += chunk; });
  const connected = server().connect({ readable, writable });
  readable.end(messages.map(message => JSON.stringify(message) + "\n").join(""));
  await connected;
  const streamReplies = output.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(streamReplies[0].result.resultType, "input_required");
  assert.deepEqual(streamReplies[1].result.structuredContent, { value: "done" });
  const [client, transport] = InMemoryTransport.createLinkedPair();
  const sdkReplies = [];
  const waiters = [];
  client.onmessage = message => { sdkReplies.push(message); waiters.shift()?.(); };
  const sdkConnected = server().connectSDK(transport);
  await client.start();
  for (const message of messages) {
    const replied = new Promise(resolve => waiters.push(resolve));
    await client.send(message);
    await replied;
  }
  assert.deepEqual(sdkReplies, streamReplies);
  await client.close();
  await sdkConnected;
});
