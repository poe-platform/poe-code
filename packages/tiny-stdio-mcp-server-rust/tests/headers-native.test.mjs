import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";
import {
  getParameterHeaders,
  createParameterHeaders
} from "../../tiny-stdio-mcp-server/dist/headers.js";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};
const inputSchema = {
  type: "object",
  properties: {
    tenant: { type: "object", properties: { id: { type: "string", "x-mcp-header": "Tenant" } } },
    count: { type: "integer", "x-mcp-header": "Count" },
    enabled: { type: "boolean", "x-mcp-header": "Enabled" }
  }
};

test("MCP parameter headers reject mismatches before handlers and match encoded primitive values", async () => {
  for (const modern of [false, true]) {
    const servers = [
      createServer({ name: "test", version: "1", validateToolArguments: false }),
      referenceCreateServer({ name: "test", version: "1", validateToolArguments: false })
    ];
    const calls = [0, 0];
    for (let index = 0; index < servers.length; index++) {
      servers[index].tool("headers", "Headers", inputSchema, () => {
        calls[index]++;
        return "ok";
      });
      if (!modern) await servers[index].handleMessage("initialize");
    }
    for (const [args, headers] of [
      [{}, {}],
      [{}, { "mcp-param-tenant": "extra" }],
      [{ tenant: { id: "hello" } }, {}],
      [{ tenant: { id: "hello" } }, { "mcp-param-tenant": "hello" }],
      [{ tenant: { id: "hello" } }, { "mcp-param-tenant": ["hello"] }],
      [{ tenant: { id: "世界" } }, { "mcp-param-tenant": "=?base64?5LiW55WM?=" }],
      [{ tenant: { id: "a" } }, { "mcp-param-tenant": "=?base64?YR==?=" }],
      [
        { count: -7, enabled: false },
        { "mcp-param-count": "-7", "mcp-param-enabled": "false" }
      ],
      [{ count: -0 }, { "mcp-param-count": "0" }],
      [{ count: 1.5 }, { "mcp-param-count": "1.5" }],
      [{ count: 9007199254740992 }, { "mcp-param-count": "9007199254740992" }],
      [{ tenant: { id: "\ud800" } }, { "mcp-param-tenant": "bad" }],
      [{}, { "mcp-param-tenant": undefined, unrelated: undefined }]
    ]) {
      const params = { name: "headers", arguments: args, ...(modern ? { _meta: metadata } : {}) };
      const context = { requestId: "call", parameterHeaders: headers };
      assert.deepEqual(
        await servers[0].handleMessage("tools/call", params, context),
        await servers[1].handleMessage("tools/call", params, context)
      );
      assert.equal(calls[0], calls[1]);
    }
  }
});

test("header annotations reject invalid names/types/locations and case-insensitive duplicates at registration", () => {
  const property = { type: "string", "x-mcp-header": "Value" };
  for (const schema of [
    ...["", "white space", "\nInjected", "世界"].map((name) => ({
      type: "object",
      properties: { value: { ...property, "x-mcp-header": name } }
    })),
    ...["number", "object", "array", ["string", "null"]].map((type) => ({
      type: "object",
      properties: { value: { ...property, type } }
    })),
    { type: "object", "x-mcp-header": "Root" },
    { type: "object", properties: { a: property, b: { ...property, "x-mcp-header": "value" } } },
    ...["oneOf", "allOf", "anyOf", "prefixItems"].map((keyword) => ({
      type: "object",
      [keyword]: [{ properties: { value: property } }]
    })),
    ...["$defs", "definitions", "patternProperties", "dependentSchemas"].map((keyword) => ({
      type: "object",
      [keyword]: { value: property }
    })),
    ...[
      "items",
      "additionalProperties",
      "not",
      "contains",
      "if",
      "then",
      "else",
      "propertyNames",
      "unevaluatedProperties",
      "unevaluatedItems",
      "contentSchema"
    ].map((keyword) => ({ type: "object", [keyword]: property }))
  ]) {
    const reference = referenceCreateServer({ name: "test", version: "1" });
    const native = createServer({ name: "test", version: "1" });
    let message;
    try {
      reference.tool("invalid", "Invalid", schema, () => "ok");
    } catch (error) {
      message = error.message;
    }
    assert.ok(message);
    assert.throws(() => native.tool("invalid", "Invalid", schema, () => "ok"), { message });
  }
});

test("registered header paths are snapshotted and omitted request context skips mirror checks", async () => {
  const schema = structuredClone(inputSchema);
  const server = createServer({ name: "test", version: "1" });
  server.tool("headers", "Headers", schema, () => "ok");
  schema.properties.count["x-mcp-header"] = "Changed";
  const args = { tenant: { id: "hello" }, count: 7, enabled: true };
  const values = createParameterHeaders(getParameterHeaders(inputSchema), args);
  const headers = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name.toLowerCase(), value])
  );
  const params = { name: "headers", arguments: args, _meta: metadata };
  assert.equal(
    (await server.handleMessage("tools/call", params, { parameterHeaders: headers })).result
      .resultType,
    "complete"
  );
  assert.equal((await server.handleMessage("tools/call", params)).result.resultType, "complete");
  assert.equal(
    (await server.handleMessage("tools/call", params, { parameterHeaders: {} })).error.code,
    -32020
  );
});

test("header descriptors avoid getters and permit proxy reentrancy before request admission", async () => {
  const server = createServer({ name: "test", version: "1" });
  let calls = 0;
  let getters = 0;
  server.tool("headers", "Headers", inputSchema, () => {
    calls++;
    return "ok";
  });
  const params = { name: "headers", arguments: { count: 7 }, _meta: metadata };
  const accessor = Object.defineProperty({}, "mcp-param-count", {
    get() {
      getters++;
      return "7";
    }
  });
  assert.equal(
    (await server.handleMessage("tools/call", params, { parameterHeaders: accessor })).error.code,
    -32020
  );
  assert.equal(getters, 0);
  assert.equal(calls, 0);
  let descriptors = 0;
  const headers = new Proxy(
    { "mcp-param-count": "7" },
    {
      getOwnPropertyDescriptor(target, key) {
        descriptors++;
        server.createMessageSession().close();
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    }
  );
  assert.equal(
    (await server.handleMessage("tools/call", params, { parameterHeaders: headers })).result
      .resultType,
    "complete"
  );
  assert.ok(descriptors > 0);
  assert.equal(calls, 1);
});
