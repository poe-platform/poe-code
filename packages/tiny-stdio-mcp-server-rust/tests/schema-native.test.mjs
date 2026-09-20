import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

test("Rust input validation matches reference errors and prevents invalid handler calls", async () => {
  const schemas = [
    {
      type: "object",
      properties: { count: { type: "integer", minimum: 1 } },
      required: ["count"],
      additionalProperties: false
    },
    {
      type: "object",
      patternProperties: { "^\\p{Letter}+$": { type: "integer" } },
      additionalProperties: false
    },
    {
      type: "object",
      $defs: { name: { type: "string", pattern: "^a+$" } },
      properties: { name: { $ref: "#/$defs/name" } },
      required: ["name"]
    },
    {
      type: "object",
      anyOf: [
        { required: ["a"], properties: { a: true } },
        { required: ["b"], properties: { b: true } }
      ],
      unevaluatedProperties: false
    }
  ];
  for (const modern of [false, true]) {
    for (const inputSchema of schemas) {
      let nativeCalls = 0,
        referenceCalls = 0;
      const native = createServer({ name: "test", version: "0" }),
        reference = referenceCreateServer({ name: "test", version: "0" });
      native.registerTool({ name: "check", inputSchema }, () => {
        nativeCalls++;
        return "accepted";
      });
      reference.registerTool({ name: "check", inputSchema }, () => {
        referenceCalls++;
        return "accepted";
      });
      await native.handleMessage("initialize");
      await reference.handleMessage("initialize");
      for (const arguments_ of [
        {},
        { count: 0 },
        { count: 1 },
        { count: "bad" },
        { name: "aaa" },
        { name: "bad" },
        { a: 1 },
        { a: 1, other: 2 },
        { π: 1 }
      ]) {
        const params = {
          name: "check",
          arguments: arguments_,
          ...(modern ? { _meta: metadata } : {})
        };
        assert.deepEqual(
          await native.handleMessage("tools/call", params),
          await reference.handleMessage("tools/call", params),
          JSON.stringify({ inputSchema, arguments_ })
        );
        assert.equal(nativeCalls, referenceCalls);
      }
    }
  }
});

test("tool argument validation can be disabled without changing caller arguments", async () => {
  const native = createServer({ name: "test", version: "0", validateToolArguments: false });
  let received;
  native.tool("check", "Check", { type: "object", required: ["value"] }, (value) => {
    received = value;
    return "accepted";
  });
  await native.handleMessage("initialize");
  assert.deepEqual(
    await native.handleMessage("tools/call", { name: "check", arguments: { other: 1 } }),
    { result: { content: [{ type: "text", text: "accepted" }] } }
  );
  assert.deepEqual(received, { other: 1 });
});

test("schema compilation is snapshotted and invalid replacements preserve existing registrations", async () => {
  const native = createServer({ name: "test", version: "0" });
  const schema = { type: "object", properties: { value: { type: "integer" } } };
  native.tool("check", "Check", schema, () => "old");
  schema.properties.value.type = "string";
  assert.throws(() =>
    native.tool(
      "check",
      "Check",
      { type: "object", properties: { value: { pattern: "[" } } },
      () => "new"
    )
  );
  await native.handleMessage("initialize");
  assert.deepEqual(
    await native.handleMessage("tools/call", { name: "check", arguments: { value: 1 } }),
    { result: { content: [{ type: "text", text: "old" }] } }
  );
  assert.equal(
    (await native.handleMessage("tools/call", { name: "check", arguments: { value: "bad" } })).error
      .code,
    -32602
  );
});

test("output normalization and validation match reference across legacy and modern schemas", async () => {
  for (const modern of [false, true]) {
    for (const outputSchema of [
      {
        type: "object",
        properties: { value: { type: "integer", minimum: 1 } },
        required: ["value"],
        additionalProperties: false
      },
      { type: "string", pattern: "^a+$" },
      { type: "array", items: { type: "integer" } },
      {}
    ]) {
      for (const result of [
        { value: 1 },
        { value: 0 },
        {},
        "aaa",
        "bad",
        1,
        null,
        undefined,
        [1, 2],
        [1, "bad"],
        { content: [], structuredContent: { value: 1 } },
        { content: [{ type: "text", text: "custom" }], structuredContent: { value: 0 } },
        { content: [], structuredContent: "aaa" },
        { content: [{ type: "text", text: "failure" }], isError: true },
        { content: [] },
        { content: [{ type: "text" }] }
      ]) {
        const native = createServer({ name: "test", version: "0" }),
          reference = referenceCreateServer({ name: "test", version: "0" });
        for (const server of [native, reference]) {
          server.registerTool(
            { name: "check", inputSchema: { type: "object" }, outputSchema },
            () => result
          );
          await server.handleMessage("initialize");
        }
        const params = { name: "check", ...(modern ? { _meta: metadata } : {}) };
        assert.deepEqual(
          await native.handleMessage("tools/call", params),
          await reference.handleMessage("tools/call", params),
          JSON.stringify({ modern, outputSchema, result })
        );
      }
    }
  }
});

test("in-flight calls retain their output contract after tool replacement or removal", async () => {
  for (const remove of [false, true]) {
    let release;
    const native = createServer({ name: "test", version: "0" });
    native.registerTool(
      {
        name: "check",
        inputSchema: { type: "object" },
        outputSchema: { type: "object", required: ["original"] }
      },
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    await native.handleMessage("initialize");
    const pending = native.handleMessage("tools/call", { name: "check" });
    await Promise.resolve();
    native.removeTool("check");
    if (!remove) native.tool("check", "Replacement", { type: "object" }, () => "replacement");
    release({});
    const result = await pending;
    assert.equal(result.error.code, -32603);
    assert.match(result.error.message, /original/);
  }
});
