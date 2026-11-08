import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { HttpTransport, JsonRpcMessageLayer } from "../dist/index.js";
const { assertHttpJsonBudget } = createRequire(import.meta.url)("../dist/tiny-mcp-client-rust.node");
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const { assertHttpJsonBudget: referenceBudget } = await tsImport("../../tiny-mcp-client/src/http-json-budget.ts", import.meta.url);
const { HttpTransport: ReferenceTransport, JsonRpcMessageLayer: ReferenceLayer } = await tsImport("../../tiny-mcp-client/src/internal.ts", import.meta.url);

test("native HTTP admission rejects structural amplification before JSON graph allocation", () => {
  const payloads = [
    () => '[' + '{},'.repeat(120_000) + '{}]',
    () => '[' + 'null,'.repeat(100_000) + 'null]',
    () => '{' + '"a":{},'.repeat(40_000) + '"a":{}}',
    () => '"' + 'x'.repeat(2 * 1024 * 1024 + 1) + '"',
    () => '"' + '\\u0061'.repeat(2 * 1024 * 1024 + 1) + '"',
    () => '['.repeat(65) + '0' + ']'.repeat(65),
    () => '[' + '[],'.repeat(65_535) + '[]]',
  ];
  for (const makePayload of payloads) {
    const payload = makePayload();
    assert.throws(() => referenceBudget(payload), { constructor: Error, message: /JSON structural budget/ });
    assert.throws(() => assertHttpJsonBudget(payload), { constructor: Error, message: /JSON structural budget/ });
  }
});

test("native HTTP admission preserves UTF-16, allocation and depth boundaries", () => {
  const payloads = [
    () => '{"a":[1,true,false,null,-1.5e2,"\\uD83D\\uDE00", "\\"\\\\\\/\\b\\f\\n\\r\\t"]}',
    () => '"' + 'x'.repeat(2 * 1024 * 1024) + '"',
    () => '"' + '😀'.repeat(1024 * 1024) + '"',
    () => '"' + '\\u0061'.repeat(2 * 1024 * 1024) + '"',
    () => '"\ud800\\udfff"',
    () => '['.repeat(64) + '0' + ']'.repeat(64),
    () => '[' + '[],'.repeat(65_534) + '[]]',
    // The later JSON parser, not this allocation scan, owns scalar grammar.
    () => '[1 2]',
  ];
  for (const makePayload of payloads) {
    const payload = makePayload();
    referenceBudget(payload);
    assertHttpJsonBudget(payload);
  }
});

test("native HTTP admission rejects malformed strings and container nesting", () => {
  for (const payload of ['[}', '{', '"unterminated', '"\\u00x0"', '"\\z"', '"\n"', '"\\', ']', '"\\u']) {
    let expected;
    try { referenceBudget(payload); } catch (error) { expected = error; }
    assert.ok(expected instanceof SyntaxError);
    assert.throws(() => assertHttpJsonBudget(payload), { constructor: SyntaxError, message: expected.message });
  }
});

test("HTTP JSON admission preserves syntax and budget error classes through request failure", async () => {
  const responses = [
    ["application/json", 200, false], ["text/event-stream", 200, false],
    ["application/json", 200, true], ["text/event-stream", 200, true],
    ["application/json", 400, true],
  ];
  for (const [Transport, Layer] of [[ReferenceTransport, ReferenceLayer], [HttpTransport, JsonRpcMessageLayer]]) {
    for (const [contentType, status, modern] of responses) {
      for (const [result, ErrorType] of [['[}', SyntaxError], ['['.repeat(65) + '0' + ']'.repeat(65), Error]]) {
        const payload = '{"jsonrpc":"2.0","id":1,"result":' + result + '}';
        const transport = new Transport({ url: "https://mcp.invalid/budget", fetch: async () => new Response(
          contentType === "application/json" ? payload : `event: message\ndata: ${payload}\n\n`,
          { status, headers: { "Content-Type": contentType } }
        ) });
        const layer = new Layer(transport.readable, transport.writable, 1000, transport.closed.then(event => event.reason));
        try {
          await assert.rejects(layer.sendRequest("tools/call", modern ? { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } : {}), { constructor: ErrorType });
          assert.equal((await transport.closed).reason.constructor, ErrorType);
        } finally { layer.dispose(); transport.dispose(); await transport.closed; }
      }
    }
  }
});
