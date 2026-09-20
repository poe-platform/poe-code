import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const { NativeHttpResponseMessages } = createRequire(import.meta.url)("../dist/tiny-mcp-client-rust.node");
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const { HttpResponseMessages: Reference } = await tsImport("../../tiny-mcp-client/src/http-message-validation.ts", import.meta.url);
function outcome(parser, line, allow) { try { return { value: parser.validate(line, allow), completed: parser.completed }; } catch (error) { return { error: error.message, completed: parser.completed }; } }
function compare(request, lines) {
  const actual = new NativeHttpResponseMessages(request); const expected = new Reference(request);
  for (const [line, allow = true] of lines) assert.deepEqual(outcome(actual, line, allow), outcome(expected, line, allow), line);
}
const notification = (method, id, extra = {}) => JSON.stringify({ jsonrpc: "2.0", method, params: { ...extra, ...(id === undefined ? {} : { _meta: { "io.modelcontextprotocol/subscriptionId": id } }) } });
const response = (id, extra = {}) => JSON.stringify({ jsonrpc: "2.0", id, result: extra });
test("HTTP correlation matches response IDs, completion state and error-ID normalization", () => {
  for (const id of [1, 0, 0.5, "request\ud800"]) {
    const request = { jsonrpc: "2.0", id, method: "ping" };
    for (const line of [response(id), response("unrelated"), '{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"bad"}}', '{ "jsonrpc":"2.0", "error":{"code":-32600,"message":"bad\\ud800","data":1e400}}', '{"jsonrpc":"2.0","id":null,"result":{}}', '{"2":"two","1":"one","jsonrpc":"2.0","error":{"code":-32600,"message":"bad","data":{"4294967295":"last","2":"two","01":"not-index","1":"one"}}}', '{"jsonrpc":"2.0","id":null,"method":"ping","error":{"code":-32600,"message":"bad"}}', '{"jsonrpc":"2.0","error":{"code":"bad","message":"bad"}}', "[]", "null", "{", '{"jsonrpc":"2.0","id":1,"method":"callback"}']) compare(request, [[line, false], [response(id)]]);
  }
});
test("HTTP subscription streams require matching acknowledgement, notification and completion", () => {
  const request = { jsonrpc: "2.0", id: "stream", method: "subscriptions/listen" };
  const ack = notification("notifications/subscriptions/acknowledged", "stream");
  const changed = notification("notifications/tools/list_changed", "stream");
  compare(request, [[changed], [ack], [ack], [notification("notifications/resources/updated", "unrelated", { uri: "file:///a" })], [notification("notifications/progress", "stream", { progressToken: 1 })], [changed], [response("stream", { _meta: { "io.modelcontextprotocol/subscriptionId": "wrong" } })], [response("stream", { _meta: { "io.modelcontextprotocol/subscriptionId": "stream" } })], [changed]]);
  compare(request, [[response("stream", { _meta: { "io.modelcontextprotocol/subscriptionId": "stream" } })], [ack]]);
});
test("HTTP progress tokens correlate strictly and subscription messages cannot enter ordinary streams", () => {
  for (const token of [1, "p\ud800", null, false, { name: "p" }, ["p"]]) {
    const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { _meta: { progressToken: token } } };
    compare(request, [[notification("notifications/progress", undefined, { progressToken: token })], [notification("notifications/progress", undefined, { progressToken: "wrong" })], [notification("notifications/tools/list_changed")], [notification("notifications/message", 1, { level: "info", data: "log" })], [notification("notifications/message", undefined, { level: "info", data: "log" }), false], [notification("notifications/message", undefined, { level: "info", data: "log" })], [response(1)]]);
  }
});
