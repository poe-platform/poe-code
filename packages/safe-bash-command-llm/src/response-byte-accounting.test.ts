import assert from "node:assert/strict";
import test from "node:test";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { createLlmService, type LlmStreamEvent } from "./service.js";

function fixture(text: string) {
  let disposed = 0;
  const source = { bytes: { async *[Symbol.asyncIterator]() { yield Uint8Array.of(97); } }, async dispose() { disposed++; } };
  const service = createLlmService({ defaultModel: "fixture", providers: [{
    name: "fixture", models: [{ id: "fixture" }], async *complete() { yield text; },
    async *completeSources() { yield text; },
  }] });
  return { service, source, disposed: () => disposed };
}

test("source response byte accounting avoids whole-chunk UTF-8 allocation", async () => {
  const text = "x".repeat(1024 * 1024 + 7);
  const value = fixture(text);
  const Encoder = globalThis.TextEncoder;
  let largestEncoding = 0;
  class TrackingEncoder extends Encoder {
    override encode(input = "") {
      largestEncoding = Math.max(largestEncoding, input.length);
      return super.encode(input);
    }
  }
  globalThis.TextEncoder = TrackingEncoder;
  try {
    const events: LlmStreamEvent[] = [];
    for await (const event of value.service.streamSources!({ prompt: value.source, attachments: [], options: {}, signal: new AbortController().signal, maxOutputBytes: text.length })) events.push(event);
    assert.deepEqual(events[0], { type: "text", text });
    assert.equal(value.disposed(), 1);
  } finally { globalThis.TextEncoder = Encoder; }
  assert.ok(largestEncoding <= 16384, `Encoded a whole ${largestEncoding}-character chunk`);
});

test("response limits count multibyte text, surrogate pairs and lone surrogates exactly", async () => {
  for (const text of ["é🐈\ud800", "\udc00a\ud800", "a".repeat(65535) + "🐈é"]) {
    const byteLength = new TextEncoder().encode(text).byteLength;
    for (const limit of [byteLength, byteLength - 1]) {
      const value = fixture(text);
      const events: LlmStreamEvent[] = [];
      const drain = async (): Promise<void> => {
        for await (const event of value.service.streamSources!({ prompt: value.source, attachments: [], options: {}, signal: new AbortController().signal, maxOutputBytes: limit })) events.push(event);
      };
      if (limit === byteLength) { await drain(); assert.deepEqual(events[0], { type: "text", text }); }
      else { await assert.rejects(drain(), /output byte limit/); assert.deepEqual(events, []); }
      assert.equal(value.disposed(), 1);
    }
  }
});


test("cancellation during a large response scan emits no text and releases source ownership", async () => {
  const value = fixture("x".repeat(1024 * 1024));
  const controller = new AbortController();
  const reason = new Error("cancel byte accounting");
  let checkpoints = 0;
  registerYieldCheckpoint(controller.signal, () => { checkpoints++; controller.abort(reason); });
  const events: LlmStreamEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of value.service.streamSources!({ prompt: value.source, attachments: [], options: {}, signal: controller.signal })) events.push(event);
  }, error => error === reason);
  assert.deepEqual(events, []);
  assert.equal(checkpoints, 1);
  assert.equal(value.disposed(), 1);
});

test("known output-limit violations stop before scanning the rest of a large chunk", async () => {
  const value = fixture("x".repeat(1024 * 1024));
  const controller = new AbortController();
  let checkpoints = 0;
  registerYieldCheckpoint(controller.signal, () => { checkpoints++; });
  await assert.rejects(async () => {
    for await (const event of value.service.streamSources!({ prompt: value.source, attachments: [], options: {}, signal: controller.signal, maxOutputBytes: 1 })) void event;
  }, /output byte limit/);
  assert.equal(checkpoints, 0);
  assert.equal(value.disposed(), 1);
});
