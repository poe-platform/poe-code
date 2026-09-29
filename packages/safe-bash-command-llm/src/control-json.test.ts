import assert from "node:assert/strict";
import test from "node:test";
import { chatJson } from "./chat-json.js";

test("provider control strings and nested schema serialize in bounded chunks", async () => {
  const prompt = { bytes: { async *[Symbol.asyncIterator]() {} }, async dispose() {} };
  const long = "x".repeat(2 * 1024 * 1024) + "\ud800" + "🙂";
  const request = { model: "fixture", prompt, attachments: [], options: { stop: long }, schema: { type: "object", properties: { field: { description: long } } }, signal: new AbortController().signal };
  let chunks = 0, decoded = "";
  const decoder = new TextDecoder();
  for await (const chunk of chatJson(request, Infinity)) {
    chunks++;
    assert.ok(chunk.byteLength <= 16_384, `provider control chunk is ${chunk.byteLength} bytes`);
    decoded += decoder.decode(chunk, { stream: true });
  }
  const body = JSON.parse(decoded + decoder.decode());
  assert.equal(body.stop, long);
  assert.deepEqual(body.response_format.json_schema.schema, request.schema);
  assert.ok(chunks > 100);
});

test("incremental JSON retains native omission, escaping, arrays and stable transformations", async () => {
  const value = { date: new Date(0), transformed: { toJSON(key: string) { return key; } }, omitted: undefined, array: [undefined, null, true, -0, NaN, Infinity], description: "🙂".repeat(2048) + "\udc00", escaped: "\u0000\n\\\"" };
  let encoded = "";
  const decoder = new TextDecoder();
  const prompt = { bytes: { async *[Symbol.asyncIterator]() {} }, async dispose() {} };
  const request = { model: "fixture", prompt, attachments: [], options: value, signal: new AbortController().signal };
  for await (const chunk of chatJson(request, Infinity)) {
    assert.ok(chunk.byteLength <= 6144);
    encoded += decoder.decode(chunk, { stream: true });
  }
  const { model: ignoredModel, messages: ignoredMessages, stream: ignoredStream, ...controls } = JSON.parse(encoded + decoder.decode());
  assert.deepEqual(controls, JSON.parse(JSON.stringify(value)));
});

test("invalid controls reject before any prompt read and cancellation closes control encoding", async () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  const prompt = { bytes: { [Symbol.asyncIterator](): AsyncIterator<Uint8Array> { return assert.fail("invalid controls read prompt"); } }, async dispose() {} };
  const request = { model: "fixture", prompt, attachments: [], options: {}, signal: new AbortController().signal };
  assert.throws(() => chatJson({ ...request, schema: cyclic }, Infinity), /circular/);
  assert.throws(() => chatJson({ ...request, schema: { value: 1n } }, Infinity), /BigInt/);
  assert.throws(() => chatJson({ ...request, schema: { value: Object(1n) } }, Infinity), /BigInt/);
  const controller = new AbortController();
  const body = chatJson({ ...request, options: { stop: "x".repeat(8192) }, signal: controller.signal }, Infinity)[Symbol.asyncIterator]();
  assert.equal((await body.next()).done, false);
  controller.abort(new Error("control encoding cancelled"));
  await assert.rejects(body.next(), /control encoding cancelled/);
});
