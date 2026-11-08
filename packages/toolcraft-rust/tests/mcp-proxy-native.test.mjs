import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/mcp-proxy.js";
import * as reference from "../../toolcraft/dist/mcp-proxy.js";
import { McpClient } from "tiny-mcp-client-rust";

test("refresh selectors and explicit cache paths retain Unicode and empty-name behavior", () => {
  for (const value of [undefined, "", "  ", "1", "true", "false", "TRUE", "a,a, b", ",,", "\uFEFFa,\u00a0b\u2029", "\ud800,😀"])
    assert.deepEqual(native.parseRefreshEnv(value), reference.parseRefreshEnv(value));
  for (const name of ["group", "a.b", " a ", "😀", "\ud800"])
    assert.equal(native.resolveCachePath(name, "/fixture"), reference.resolveCachePath(name, "/fixture"));
  for (const name of ["", ".", "..", "a/b", "a\\b"])
    assert.throws(() => native.resolveCachePath(name, "/fixture"), error => {
      try { reference.resolveCachePath(name, "/fixture"); }
      catch (expected) { return error.name === expected.name && error.message === expected.message; }
      return false;
    });
});

test("proxy discovery preserves getter traversal, cross-bundle config symbols and iterator closing", () => {
  const run = (lib, thrown) => {
    const reads = [];
    const child = { kind: "group", children: [], [Symbol("toolcraft.group.config")]: { get mcp() { reads.push("mcp"); if (thrown) throw thrown; return {}; } } };
    const children = { *[Symbol.iterator]() { try { reads.push("iterate"); yield child; } finally { reads.push("closed"); } } };
    const root = { get children() { reads.push("children"); return children; }, [Symbol("toolcraft.group.config")]: { get mcp() { reads.push("root.mcp"); return undefined; } } };
    try { return { result: lib.hasMcpProxyGroups(root), reads }; }
    catch (error) { assert.equal(error, thrown); return { reads }; }
  };
  for (const failure of [undefined, Symbol("error"), { failure: true }]) assert.deepEqual(run(native, failure), run(reference, failure));
  const marker = Symbol("toolcraft.group.config");
  assert.equal(native.hasMcpProxyGroups(Object.assign(Object.create({ [marker]: { mcp: {} } }), { children: [] })), false);
});

test("dialUpstream uses the native HTTP client through initialization, tools and close", { timeout: 1000 }, async () => {
  const previous = globalThis.fetch;
  const requests = [];
  let finishDelete;
  const deleted = new Promise(resolve => { finishDelete = resolve; });
  globalThis.fetch = async (_url, init) => {
    if (init.method === "GET") return new Response(null, { status: 405 });
    if (init.method === "DELETE") { requests.push({ method: "DELETE" }); finishDelete(); return new Response(null, { status: 204 }); }
    const request = JSON.parse(init.body);
    requests.push(request);
    if (request.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Legacy fixture" } });
    if (request.id === undefined) return new Response(null, { status: 202 });
    const result = request.method === "initialize"
      ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
      : request.method === "tools/list" ? { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] }
        : { content: [{ type: "text", text: request.params.arguments.value }] };
    return Response.json({ jsonrpc: "2.0", id: request.id, result }, { headers: { "mcp-session-id": "fixture-session" } });
  };
  let client;
  try {
    client = await native.dialUpstream("demo", { transport: "http", url: "https://mcp.invalid/api", headers: { "x-example": "test" } });
    assert.ok(client instanceof McpClient);
    assert.equal(client.state, "ready");
    assert.equal((await client.listTools({})).tools[0].name, "echo");
    assert.equal((await client.callTool({ name: "echo", arguments: { value: "native roundtrip" } })).content[0].text, "native roundtrip");
    await client.close();
    await deleted;
    assert.deepEqual(requests.find(request => request.method === "initialize").params.clientInfo, { name: "toolcraft-demo", version: "0.0.1" });
    assert.ok(requests.some(request => request.method === "notifications/initialized"));
    assert.ok(requests.some(request => request.method === "DELETE"));
  } finally { await client?.close(); globalThis.fetch = previous; }
});
