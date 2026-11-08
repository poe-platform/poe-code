import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { parseJson, parseJsonUtf8, canonicalizeJson, parseMessage, parseMessageUtf8 } from "../dist/index.js";

test("native values agree with JSON.parse without a JS stringify/parse bridge", () => {
  for (const source of [
    "null",
    "true",
    "false",
    "-0",
    "1e400",
    "123.5",
    '"🦀"',
    '{"nested":[{},[],null,false,42,"text"]}',
    '{"a":1,"a":2,"b":3}',
    '"\\ud800"',
    '"\\udfff"',
    '"\ud800"',
    '"\\\\\ud800"',
    '{"\ud800":"\udfff","\\ud800":2}'
  ]) {
    assert.deepEqual(parseJson(source), JSON.parse(source), source);
    if (!source.includes("\ud800") && !source.includes("\udfff")) {
      assert.deepEqual(parseJsonUtf8(Buffer.from(source)), JSON.parse(source), source);
    }
  }
});

test("native conversion defines safe own properties with full UTF-16 keys", () => {
  const source = '{"__proto__":{"polluted":true},"constructor":1,"\\u0000":2,"\\ud800":3}';
  const value = parseJson(source);
  assert.deepEqual(value, JSON.parse(source));
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.prototype.polluted, undefined);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.configurable, true);
    assert.equal(descriptor.enumerable, true);
  }
});

test("native parser rejects invalid syntax and strict UTF-8 failures", () => {
  for (const source of ["", "[1,]", "00", '"\\x"', '"\\\ud800"', "\ud800", "true false"]) {
    assert.throws(() => parseJson(source));
  }
  for (const bytes of [[0xff], [34, 0xed, 0xa0, 0x80, 34], [34, 0xc0, 0xaf, 34]]) {
    assert.throws(() => parseJsonUtf8(Buffer.from(bytes)), { code: "InvalidUtf8" });
  }
});

test("resource limits are enforced by the actual addon", () => {
  assert.deepEqual(parseJson("[1]", { maxBytes: 3, maxDepth: 1, maxNodes: 2 }), [1]);
  assert.throws(() => parseJson("[1]", { maxBytes: 2 }), { code: "ByteLimit" });
  assert.throws(() => parseJson("[[]]", { maxDepth: 1 }), { code: "DepthLimit" });
  assert.throws(() => parseJson("[1]", { maxNodes: 1 }), { code: "NodeLimit" });
  assert.equal(parseJson("0", { maxDepth: 513 }), 0);
  assert.throws(() => parseJson("0", { maxNodes: 0 }), { code: "NodeLimit" });
  assert.equal(parseJson('"\ud800"', { maxBytes: 5 }), "\ud800");
});

test("native serializer preserves JSON values and escapes unpaired surrogates", () => {
  for (const source of ['"\ud800"', '{"x":[1e400,-0,"🦀",true]}', '{"__proto__":1}']) {
    const result = canonicalizeJson(source);
    assert.deepEqual(JSON.parse(result), JSON.parse(JSON.stringify(JSON.parse(source))));
    assert.equal(result.includes("\ud800"), false);
  }
});

test("numeric limits cannot silently wrap or truncate at the Node-API boundary", () => {
  for (const name of ["maxBytes", "maxDepth", "maxNodes"]) {
    for (const value of [-1, 1.5, NaN, -Infinity, 2 ** 32, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => parseJson("0", { [name]: value }), { code: "InvalidLimits" });
    }
  }
});

test("addon loads and releases independently in worker environments", async () => {
  const moduleUrl = new URL("../dist/index.js", import.meta.url).href;
  await Promise.all(
    Array.from(
      { length: 4 },
      () =>
        new Promise((resolve, reject) => {
          const worker = new Worker(
            `
      const { parentPort } = require("node:worker_threads");
      import(${JSON.stringify(moduleUrl)}).then(({ parseJson }) => {
        for (let i = 0; i < 200; i++) {
          const value = parseJson('{"__proto__":1,"x":"\\\\ud800"}');
          if (value.x.charCodeAt(0) !== 0xd800 || !Object.hasOwn(value, "__proto__")) throw new Error("Bad conversion");
        }
        parentPort.postMessage("done");
      });
    `,
            { eval: true }
          );
          let received = false;
          worker.on("message", (message) => {
            received = message === "done";
          });
          worker.on("error", reject);
          worker.on("exit", (code) => {
            if (code === 0 && received) resolve();
            else reject(new Error(`Worker failed: ${code}, received=${received}`));
          });
        })
    )
  );
});

test("all native JSON entry points accept omitted and infinite budgets", () => {
  const source = '['.repeat(600) + '0' + ']'.repeat(600);
  const message = '{"jsonrpc":"2.0","id":1,"method":"test","params":{"deep":' + source + '}}';
  for (const limits of [undefined, { maxBytes: Infinity, maxDepth: Infinity, maxNodes: Infinity }]) {
    assert.equal(canonicalizeJson(source, limits), source);
    for (const value of [parseJson(source, limits), parseJsonUtf8(Buffer.from(source), limits)]) {
      let leaf = value;
      for (let i = 0; i < 600; i++) leaf = leaf[0];
      assert.equal(leaf, 0);
    }
    assert.equal(parseMessage(message, limits).success, true);
    assert.equal(parseMessageUtf8(Buffer.from(message), limits).success, true);
  }
  assert.throws(() => parseJson(source, { maxDepth: 599, maxBytes: Infinity }), { code: "DepthLimit" });
});


test("infinite budgets preserve finite limits at every native entry point", () => {
  const unlimited = { maxBytes: Infinity, maxDepth: Infinity, maxNodes: Infinity };
  for (const [name, maximum, code] of [["maxBytes", 2, "ByteLimit"], ["maxDepth", 0, "DepthLimit"], ["maxNodes", 1, "NodeLimit"]]) {
    for (const parse of [parseJson, canonicalizeJson, (input, limits) => parseJsonUtf8(Buffer.from(input), limits)]) {
      assert.throws(() => parse("[0]", { ...unlimited, [name]: maximum }), { code });
    }
  }
  for (const name of ["maxBytes", "maxDepth", "maxNodes"]) {
    assert.equal(parseJson("0", { [name]: Infinity }), 0);
  }
  for (const parse of [parseMessage, (input, limits) => parseMessageUtf8(Buffer.from(input), limits)]) {
    const result = parse('{"jsonrpc":"2.0","method":"ping"}', { ...unlimited, maxNodes: 1 });
    assert.equal(result.success, false);
    assert.equal(result.error.code, -32700);
  }
});
