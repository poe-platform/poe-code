import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJsonRpcMessage, McpError } from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const { parseJsonRpcMessage: reference } = await tsImport(
  "../../tiny-mcp-client/src/internal.ts",
  import.meta.url
);

function comparable(parsed) {
  if (parsed.type !== "invalid") return parsed;
  return {
    type: parsed.type,
    id: parsed.id,
    error: { code: parsed.error.code, message: parsed.error.message, data: parsed.error.data }
  };
}

test("native client parsing matches requests, notifications, responses and malformed envelopes", () => {
  for (const line of [
    "",
    "{",
    "[]",
    "null",
    "false",
    "123",
    ...[
      {},
      { jsonrpc: "1.0", id: 1 },
      ...[undefined, null, true, {}, [], 0, -0.5, 1e21, "\ud800"].flatMap((id) => [
        { jsonrpc: "2.0", id, method: "ping", params: [1] },
        { jsonrpc: "2.0", id, result: { value: "\udfff" }, extra: true },
        { jsonrpc: "2.0", id, result: null, error: {} },
        { jsonrpc: "2.0", id, error: { code: -32000, message: "broken", data: null } }
      ]),
      ...[null, false, 1.5, 9007199254740992, "1"].map((code) => ({
        jsonrpc: "2.0",
        id: 1,
        error: { code, message: "oops" }
      })),
      { jsonrpc: "2.0", method: "notify", params: 7 },
      { jsonrpc: "2.0", method: 7, id: "valid" },
      { jsonrpc: "2.0", id: 7, result: 1e-7 }
    ].map((value) => JSON.stringify(value))
  ]) {
    const actual = parseJsonRpcMessage(line);
    assert.deepEqual(comparable(actual), comparable(reference(line)), line);
    if (actual.type === "invalid") assert.ok(actual.error instanceof McpError);
  }
});

test("client parser retains duplicate-field, overflow and escaped UTF16 JSON semantics", () => {
  for (const line of [
    '{"jsonrpc":"1.0","jsonrpc":"2.0","id":1,"result":true}',
    '{"jsonrpc":"2.0","id":1e999,"result":-1e999}',
    '{"jsonrpc":"2.0","id":1,"error":{"code":1e999,"message":"oops"}}',
    '{"jsonrpc":"2.0","id":"\\ud800","method":"","params":{"__proto__":7,"\\udfff":true}}',
    '\ufeff{"jsonrpc":"2.0","id":1,"result":null}'
  ])
    assert.deepEqual(comparable(parseJsonRpcMessage(line)), comparable(reference(line)), line);
});
