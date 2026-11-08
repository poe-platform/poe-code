import { assertHttpJsonBudget } from "./http-json-budget.js";
import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./internal.js";

it.each([
  { contentType: "application/json", status: 200, modern: false },
  { contentType: "text/event-stream", status: 200, modern: false },
  { contentType: "application/json", status: 200, modern: true },
  { contentType: "text/event-stream", status: 200, modern: true },
  { contentType: "application/json", status: 400, modern: true }
])("rejects compact object amplification before parsing ($contentType/$status/$modern)", async ({ contentType, status, modern }) => {
  const payload = '{"jsonrpc":"2.0","id":1,"result":[' + '{},'.repeat(120_000) + '{}]}';
  const parse = vi.spyOn(JSON, "parse");
  const transport = new HttpTransport({ url: "https://mcp.invalid/budget", fetch: async () =>
    new Response(contentType === "application/json" ? payload : `event: message\ndata: ${payload}\n\n`, { status, headers: { "Content-Type": contentType } }) });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 1000, transport.closed.then(event => event.reason));
  try {
    await expect(layer.sendRequest("tools/call", modern ? { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } : {})).rejects.toThrow("JSON structural budget");
    expect(parse.mock.calls.some(([text]) => text === payload)).toBe(false);
  } finally { parse.mockRestore(); layer.dispose(); transport.dispose(); await transport.closed; }
});

it.each([
  '"' + 'x'.repeat(2 * 1024 * 1024 + 1) + '"',
  '"' + '\\u0061'.repeat(2 * 1024 * 1024 + 1) + '"',
  '['.repeat(65) + '0' + ']'.repeat(65),
  '[' + 'null,'.repeat(100_000) + 'null]',
  '{' + '"a":{},'.repeat(40_000) + '"a":{}}'
])("bounds strings, depth, scalars and duplicate properties before parse %#", (payload) => {
  expect(() => assertHttpJsonBudget(payload)).toThrow("JSON structural budget");
});

it.each(['{"a":[1,true,false,null,-1.5e2,"\\uD83D\\uDE00", "\\"\\\\\\/\\b\\f\\n\\r\\t"]}', '['.repeat(64) + '0' + ']'.repeat(64)])("admits ordinary JSON and the depth boundary %#", (payload) => {
  expect(() => assertHttpJsonBudget(payload)).not.toThrow();
  expect(() => JSON.parse(payload)).not.toThrow();
});

it.each(['[}', '{', '"unterminated', '"\\u00x0"', '"\\z"', '"\n"'])("rejects malformed lexical structure %#", (payload) => {
  expect(() => assertHttpJsonBudget(payload)).toThrow(SyntaxError);
});
