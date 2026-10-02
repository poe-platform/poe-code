import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource } from "safe-bash-contracts";
import { createLlmService } from "./service.js";
import { createOpenAiProvider } from "./openai.js";
import { chatJson as serializeOpenAiChatRequest } from "./chat-json.js";
import type { LlmInputSource } from "./types.js";

function source(value: string | Uint8Array, dispose = async () => {}): LlmInputSource { return { bytes: toByteSource(value), dispose }; }

test("OpenAI streamed history preserves attachments without current attachments", async () => {
  const request = { model: "fixture", prompt: source("now"), attachments: [], messages: [{ role: "user" as const, content: source("before"), attachments: [{ mimeType: "image/png", source: source(new Uint8Array([1, 2, 3])) }] }], options: {}, signal: new AbortController().signal };
  const decoder = new TextDecoder(); let text = "";
  for await (const chunk of serializeOpenAiChatRequest(request, Infinity)) text += decoder.decode(chunk, { stream: true });
  assert.deepEqual(JSON.parse(text + decoder.decode()).messages, [{ role: "user", content: [{ type: "text", text: "before" }, { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }] }, { role: "user", content: "now" }]);
});

test("shared source history admits MIME types and owns every attachment lease", async () => {
  let calls = 0;
  const closed: string[] = [];
  const input = (name: string) => source(name, async () => { closed.push(name); });
  const service = createLlmService({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture", capabilities: ["messages"], attachmentTypes: ["image/png"] }], complete() { return assert.fail("buffered route"); }, async *completeSources() { calls++; yield "ok"; } }] });
  const request = { prompt: input("prompt"), messages: [{ role: "user" as const, content: input("message"), attachments: [{ mimeType: "text/plain", source: input("attachment") }] }], attachments: [], options: {}, signal: new AbortController().signal };
  await assert.rejects(async () => { for await (const ignored of service.streamSources!(request)) void ignored; }, /does not accept text\/plain/);
  assert.equal(calls, 0);
  assert.deepEqual(closed.sort(), ["attachment", "message", "prompt"]);
});

test("shared source history disposes attachments after successful completion", async () => {
  let disposed = 0;
  const attachment = source("bytes", async () => { disposed++; });
  const service = createLlmService({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture", capabilities: ["messages"], attachmentTypes: ["image/png"] }], complete() { return assert.fail("buffered route"); }, async *completeSources() { yield "ok"; } }] });
  const request = { prompt: source("now"), messages: [{ role: "user" as const, content: source("before"), attachments: [{ mimeType: "image/png", source: attachment }] }], attachments: [], options: {}, signal: new AbortController().signal };
  for await (const ignored of service.streamSources!(request)) void ignored;
  assert.equal(disposed, 1);
});

test("OpenAI buffered history serializes attachments into message content", async () => {
  let received: unknown;
  const provider = createOpenAiProvider({ apiKey: "synthetic", models: [{ id: "fixture", endpoint: "chat" }], async transport(request) {
    let body = ""; const decoder = new TextDecoder(); for await (const chunk of request.body!) body += decoder.decode(chunk, { stream: true });
    received = JSON.parse(body + decoder.decode()).messages;
    return { status: 200, statusText: "OK", headers: [], async dispose() {}, body: toByteSource('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n') };
  } });
  const request = { model: "fixture", prompt: "now", messages: [{ role: "user" as const, content: "before", attachments: [{ mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) }] }], attachments: [], options: {}, signal: new AbortController().signal };
  for await (const ignored of provider.complete(request)) void ignored;
  assert.deepEqual(received, [{ role: "user", content: [{ type: "text", text: "before" }, { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }] }, { role: "user", content: "now" }]);
});

test("cancelling a pending historical attachment read releases every lease", async () => {
  const controller = new AbortController();
  let opened!: () => void;
  const reading = new Promise<void>(resolve => { opened = resolve; });
  let disposed = 0;
  const attachment: LlmInputSource = { bytes: { [Symbol.asyncIterator]() { return { next() { opened(); return new Promise<IteratorResult<Uint8Array>>(() => {}); }, async return() { return { done: true as const, value: undefined }; } }; } }, async dispose() { disposed++; } };
  const service = createLlmService({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture", capabilities: ["messages"], attachmentTypes: ["image/png"] }], complete() { return assert.fail("buffered route"); }, async *completeSources(request) { for await (const chunk of request.messages![0]!.attachments![0]!.source.bytes) yield String(chunk.length); } }] });
  const request = { prompt: source("now"), messages: [{ role: "user" as const, content: source("before"), attachments: [{ mimeType: "image/png", source: attachment }] }], attachments: [], options: {}, signal: controller.signal };
  const result = (async () => { for await (const ignored of service.streamSources!(request)) void ignored; })();
  await reading;
  controller.abort(new Error("cancel history"));
  await assert.rejects(result, /cancel history/);
  assert.equal(disposed, 1);
});

test("buffered history MIME checks reject before invoking an injected provider", () => {
  const service = createLlmService({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture", capabilities: ["messages"], attachmentTypes: ["image/png"] }], complete() { return assert.fail("invalid attachment reached provider"); } }] });
  const request = { prompt: "now", messages: [{ role: "user" as const, content: "before", attachments: [{ mimeType: "text/plain", bytes: new Uint8Array([1]) }] }], attachments: [], options: {}, signal: new AbortController().signal };
  assert.throws(() => service.complete(request), /does not accept text\/plain/);
});
