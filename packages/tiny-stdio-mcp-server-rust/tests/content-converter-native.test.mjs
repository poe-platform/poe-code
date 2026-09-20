import assert from "node:assert/strict";
import { test } from "node:test";
import * as rust from "../dist/index.js";
import * as reference from "tiny-stdio-mcp-server";

test("public content conversion matches primitives, nested arrays and incomplete content shapes", () => {
  assert.equal(typeof rust.toContentBlocks, "function");
  for (const value of [
    undefined,
    null,
    "\ud800",
    -0,
    NaN,
    Infinity,
    -Infinity,
    1e21,
    true,
    false,
    [],
    [undefined, [1, ["hello", null]], false],
    { value: 1 },
    { content: [{ type: "text", text: "explicit result is ordinary data here" }] },
    { type: "image", data: "not base64", mimeType: "image/unknown" },
    { type: "audio", data: "YR==", mimeType: "audio/wav" },
    { type: "resource_link", uri: "relative", name: "link" },
    { type: "resource", resource: { uri: "relative", text: "hello" } },
    { type: "text" },
    { type: "image", data: 1, mimeType: "image/png" }
  ])
    assert.deepEqual(rust.toContentBlocks(value), reference.toContentBlocks(value));
});

test("public converter retains content identity and own-descriptor fallback for content classes", () => {
  const block = { type: "text", text: "hello" };
  assert.equal(rust.toContentBlocks(block)[0], block);
  assert.equal(rust.toContentBlocks([1, [block]])[1], block);
  class Content {
    type = "text";
    text = "hello";
  }
  const custom = new Content();
  const converted = rust.toContentBlocks(custom)[0];
  assert.equal(Object.getPrototypeOf(converted), null);
  assert.deepEqual(converted, reference.toContentBlocks(custom)[0]);
  const nil = Object.assign(Object.create(null), block);
  assert.equal(rust.toContentBlocks(nil)[0], nil);
});

test("public converter rejects cyclic/sparse/accessor arrays and non-JSON leaves without running hooks", () => {
  let calls = 0;
  const cycle = [];
  cycle.push(cycle);
  const sparse = new Array(1);
  const accessor = Object.defineProperty([], "0", {
    get() {
      calls++;
      return 1;
    }
  });
  const objectCycle = {};
  objectCycle.value = objectCycle;
  for (const value of [
    cycle,
    sparse,
    accessor,
    objectCycle,
    1n,
    Symbol("value"),
    () => {},
    new Date(0),
    { bad: undefined },
    { bad: NaN },
    {
      toJSON() {
        calls++;
        return {};
      }
    },
    Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        calls++;
        return 1;
      }
    })
  ]) {
    let expected;
    try {
      reference.toContentBlocks(value);
    } catch (error) {
      expected = error;
    }
    assert.ok(expected instanceof TypeError);
    assert.throws(() => rust.toContentBlocks(value), {
      name: expected.name,
      message: expected.message
    });
  }
  const shared = [1];
  assert.deepEqual(
    rust.toContentBlocks([shared, shared]),
    reference.toContentBlocks([shared, shared])
  );
  assert.equal(calls, 0);
});

test("public converter handles branded helpers and preserves conversion before protocol validation", () => {
  const actual = rust.toContentBlocks([
    rust.Image.fromBase64("YR==", "image/png"),
    [rust.Audio.fromBytes(Uint8Array.from([98]), "wav"), rust.File.fromText("hello")]
  ]);
  const expected = reference.toContentBlocks([
    reference.Image.fromBase64("YR==", "image/png"),
    [reference.Audio.fromBytes(Uint8Array.from([98]), "wav"), reference.File.fromText("hello")]
  ]);
  assert.deepEqual(actual, expected);
});

test("converter preserves first-error order across invalid leaves and array structure", () => {
  const cycle = [];
  cycle.push(cycle);
  for (const value of [
    [1n, cycle],
    [{ bad: undefined }, new Array(1)],
    [...new Array(40).fill(1), { bad: NaN }, cycle],
    [cycle, 1n],
    [new Array(1), { bad: undefined }]
  ]) {
    let expected;
    try {
      reference.toContentBlocks(value);
    } catch (error) {
      expected = error;
    }
    assert.throws(() => rust.toContentBlocks(value), {
      name: expected.name,
      message: expected.message
    });
  }
});

test("tool handlers accept content classes and send matching wire values", async () => {
  class Text {
    type = "text";
    text = "class content";
  }
  for (const nested of [false, true]) {
    const servers = [
      rust.createServer({ name: "test", version: "1" }),
      reference.createServer({ name: "test", version: "1" })
    ];
    for (const server of servers)
      server.tool("content", "Content", { type: "object" }, () =>
        nested ? [1, [new Text()]] : new Text()
      );
    for (const modern of [false, true]) {
      if (!modern) for (const server of servers) await server.handleMessage("initialize");
      const params = {
        name: "content",
        ...(modern
          ? {
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {}
              }
            }
          : {})
      };
      // Engine replies are copied JSON values; prototype identity belongs to
      // the standalone public converter, not a serialized MCP reply.
      assert.equal(
        JSON.stringify(await servers[0].handleMessage("tools/call", params)),
        JSON.stringify(await servers[1].handleMessage("tools/call", params))
      );
    }
  }
});

test("native text construction defines own fields without invoking prototype setters", () => {
  let calls = 0;
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "text");
  let converted;
  Object.defineProperty(Object.prototype, "text", { configurable: true, set() { calls++; } });
  try { converted = rust.toContentBlocks(["hello", 1, true, null, { value: 1 }]); }
  finally {
    if (previous) Object.defineProperty(Object.prototype, "text", previous);
    else delete Object.prototype.text;
  }
  assert.equal(calls, 0);
  assert.deepEqual(converted.map(block => block.text), ["hello", "1", "true", "null", '{"value":1}']);
});
