import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import { defineSchema as referenceDefineSchema, createServer as referenceCreateServer } from "tiny-stdio-mcp-server";

test("schema definitions preserve arbitrary keywords and own special property names", () => {
  assert.equal(typeof native.defineSchema, "function");
  for (const definition of [
    {},
    { name: { type: "string", description: "Name", minLength: 1 }, count: { type: "integer", optional: true, minimum: 0 } },
    { list: { type: "array", items: { type: "string" }, optional: false }, nested: { type: "object", properties: { value: { type: "number" } } } },
    Object.fromEntries(["__proto__", "constructor", "toString", "\ud800", "1", "0"].map(name => [name, { type: "string" }]))
  ]) {
    assert.deepEqual(native.defineSchema(definition), referenceDefineSchema(definition));
    for (const property of Object.values(native.defineSchema(definition).properties))
      assert.equal(Object.hasOwn(property, "optional"), false);
  }
});

test("shorthand tool output schemas validate and normalize just as registered tools", async () => {
  for (const value of [{ value: "ok" }, { value: 1 }]) {
    const rust = native.createServer({ name: "test", version: "1" });
    const reference = referenceCreateServer({ name: "test", version: "1" });
    const input = referenceDefineSchema({});
    const output = referenceDefineSchema({ value: { type: "string" } });
    for (const server of [rust, reference]) server.tool("typed", "Typed", input, () => value, output);
    for (const modern of [false, true]) {
      if (!modern) for (const server of [rust, reference]) await server.handleMessage("initialize");
      const params = { name: "typed", ...(modern ? { _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      } } : {}) };
      assert.deepEqual(await rust.handleMessage("tools/call", params), await reference.handleMessage("tools/call", params));
    }
  }
});

test("shorthand registration rejects duplicates and preserves whitespace-only names", async () => {
  for (const name of ["typed", " ", "\t\n"]) {
    const rust = native.createServer({ name: "test", version: "1" });
    const reference = referenceCreateServer({ name: "test", version: "1" });
    for (const server of [rust, reference]) server.tool(name, "Name", { type: "object" }, () => "first");
    for (const server of [rust, reference])
      assert.throws(() => server.tool(name, "Duplicate", { type: "object" }, () => "second"),
        { message: `Tool already registered: ${name}` });
    const params = { name, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}
    } };
    assert.deepEqual(await rust.handleMessage("tools/call", params), await reference.handleMessage("tools/call", params));
  }
});
