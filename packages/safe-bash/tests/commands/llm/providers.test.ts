import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAiProvider, createElevenLabsProvider } from "../../../src/commands/llm/providers/index.js";
import type { LlmRequest, LlmProvider } from "../../../src/commands/llm/types.js";
import type { HttpRequest, HttpTransport } from "../../../src/commands/network/types.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
function fixture(replies: (string | Uint8Array | readonly Uint8Array[])[], status = 200) {
  const requests: { request: HttpRequest; bytes: Uint8Array }[] = [];
  let disposed = 0;
  const transport: HttpTransport = async request => {
    const chunks: Uint8Array[] = [];
    if (request.body) for await (const chunk of request.body) chunks.push(new Uint8Array(chunk));
    const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
    let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    requests.push({ request, bytes });
    const reply = replies.shift(); assert.notEqual(reply, undefined);
    const parts = typeof reply === "string" ? [encode(reply)] : reply instanceof Uint8Array ? [reply] : reply!;
    return { status, statusText: "fixture", headers: [], body: (async function* () { yield* parts; })(), async dispose() { disposed++; } };
  };
  return { transport, requests, get disposed() { return disposed; } };
}
function request(model: string, extra: Partial<LlmRequest> = {}): LlmRequest {
  return { model, prompt: "hello", options: {}, attachments: [], signal: new AbortController().signal, ...extra };
}
async function collect(provider: LlmProvider, input: LlmRequest) {
  const chunks: (string | Uint8Array)[] = [];
  for await (const chunk of provider.complete(input)) chunks.push(chunk);
  return chunks;
}

test("OpenAI chat streams fragmented SSE and sends system, image, numeric options", async () => {
  const data = encode('data: {"choices":[{"delta":{"content":"hé"}}]}\r\n\r\ndata: [DONE]\n\n');
  const f = fixture([[...data].map(byte => Uint8Array.of(byte))]);
  const provider = createOpenAiProvider({ transport: f.transport, apiKey: "secret", baseUrl: "https://fixture.test/v1", models: [{ id: "custom", endpoint: "chat", attachmentTypes: ["image/*"] }] });
  assert.deepEqual(await collect(provider, request("custom", { system: "system", options: { temperature: "0.5" }, attachments: [{ mimeType: "image/png", bytes: Uint8Array.of(0, 255) }] })), ["hé"]);
  const sent = f.requests[0]!;
  assert.equal(sent.request.url, "https://fixture.test/v1/chat/completions");
  const body = JSON.parse(new TextDecoder().decode(sent.bytes));
  assert.equal(body.temperature, 0.5); assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [{ role: "system", content: "system" }, { role: "user", content: [{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "data:image/png;base64,AP8=" } }] }]);
  assert.equal(f.disposed, 1);
});

test("OpenAI image generation decodes exact bytes and editing uploads multipart images", async () => {
  const f = fixture(['{"data":[{"b64_json":"AP8="}]}', '{"data":[{"b64_json":"AQI="}]}']);
  const provider = createOpenAiProvider({ transport: f.transport, apiKey: "secret", models: [{ id: "paint", endpoint: "images", outputType: "image/png" }] });
  assert.deepEqual(await collect(provider, request("paint", { options: { size: "1024x1024" } })), [Uint8Array.of(0, 255)]);
  assert.deepEqual(await collect(provider, request("paint", { attachments: [{ mimeType: "image/png", bytes: Uint8Array.of(0, 255) }] })), [Uint8Array.of(1, 2)]);
  assert.equal(f.requests[1]!.request.url, "https://api.openai.com/v1/images/edits");
  const multipart = new TextDecoder().decode(f.requests[1]!.bytes);
  assert.ok(multipart.includes('name="image[]"')); assert.ok(multipart.includes("Content-Type: image/png"));
  assert.equal(f.disposed, 2);
});

test("OpenAI video creates with input reference, polls then streams content", async () => {
  const f = fixture(['{"id":"video_1","status":"queued"}', '{"id":"video_1","status":"completed"}', Uint8Array.of(0, 1, 255)]);
  const provider = createOpenAiProvider({ transport: f.transport, apiKey: "secret", models: [{ id: "video", endpoint: "videos", outputType: "video/mp4" }], limits: { pollIntervalMs: 0 } });
  assert.deepEqual(await collect(provider, request("video", { options: { seconds: "8" }, attachments: [{ mimeType: "image/jpeg", bytes: Uint8Array.of(255, 216) }] })), [Uint8Array.of(0, 1, 255)]);
  assert.deepEqual(f.requests.map(x => [x.request.method, new URL(x.request.url).pathname]), [["POST", "/v1/videos"], ["GET", "/v1/videos/video_1"], ["GET", "/v1/videos/video_1/content"]]);
  assert.ok(new TextDecoder().decode(f.requests[0]!.bytes).includes('name="input_reference"'));
  assert.equal(f.disposed, 3);
});

test("ElevenLabs TTS uses voice selection, query format and typed voice settings", async () => {
  const f = fixture([Uint8Array.of(0, 255)]);
  const provider = createElevenLabsProvider({ transport: f.transport, apiKey: "secret", models: [{ id: "speech", endpoint: "tts", outputType: "audio/mpeg", defaultVoiceId: "default" }] });
  assert.deepEqual(await collect(provider, request("speech", { options: { voice_id: "chosen", stability: "0.5", use_speaker_boost: "false" } })), [Uint8Array.of(0, 255)]);
  assert.equal(f.requests[0]!.request.url, "https://api.elevenlabs.io/v1/text-to-speech/chosen?output_format=mp3_44100_128");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(f.requests[0]!.bytes)), { text: "hello", model_id: "speech", voice_settings: { stability: 0.5, use_speaker_boost: false } });
  assert.equal(f.disposed, 1);
});

test("ElevenLabs music sends numeric duration and boolean instrumental", async () => {
  const f = fixture([Uint8Array.of(1, 2)]);
  const provider = createElevenLabsProvider({ transport: f.transport, apiKey: "secret", models: [{ id: "score", endpoint: "music", outputType: "audio/mpeg" }] });
  await collect(provider, request("score", { options: { music_length_ms: "30000", force_instrumental: "true" } }));
  assert.equal(f.requests[0]!.request.url, "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(f.requests[0]!.bytes)), { prompt: "hello", model_id: "score", music_length_ms: 30000, force_instrumental: true });
});

test("providers refuse missing voice, invalid numeric options and attachments before transport", async () => {
  const f = fixture([]);
  const provider = createElevenLabsProvider({ transport: f.transport, apiKey: "secret", models: [{ id: "speech", endpoint: "tts", outputType: "audio/mpeg" }, { id: "score", endpoint: "music", outputType: "audio/mpeg" }] });
  await assert.rejects(collect(provider, request("speech")), /voice_id/);
  await assert.rejects(collect(provider, request("score", { options: { music_length_ms: "oops" } })), /music_length_ms/);
  await assert.rejects(collect(provider, request("score", { attachments: [{ mimeType: "image/png", bytes: Uint8Array.of(1) }] })), /attachments/);
  assert.equal(f.requests.length, 0);
});

test("HTTP errors are disposed without following redirects or exposing secrets", async () => {
  const f = fixture(["secret from upstream"], 302);
  const provider = createOpenAiProvider({ transport: f.transport, apiKey: "secret", models: [{ id: "chat", endpoint: "chat" }] });
  await assert.rejects(collect(provider, request("chat")), error => error instanceof Error && error.message.includes("302") && !error.message.includes("secret"));
  assert.equal(f.requests.length, 1); assert.equal(f.disposed, 1);
});

test("SSE truncation, malformed base64 and bounded response buffers fail closed", async () => {
  for (const [reply, endpoint] of [['data: {"choices":[]}\n\n', "chat"], ['{"data":[{"b64_json":"!!!"}]}', "images"]] as const) {
    const f = fixture([reply]); const provider = createOpenAiProvider({ transport: f.transport, apiKey: "k", models: [{ id: "x", endpoint, ...(endpoint === "images" ? { outputType: "image/png" } : {}) }] });
    await assert.rejects(collect(provider, request("x"))); assert.equal(f.disposed, 1);
  }
  const f = fixture(['{"data":[]}']); const provider = createOpenAiProvider({ transport: f.transport, apiKey: "k", models: [{ id: "x", endpoint: "images", outputType: "image/png" }], limits: { maxResponseBytes: 4 } });
  await assert.rejects(collect(provider, request("x")), /limit/); assert.equal(f.disposed, 1);
});

test("early iterator return disposes streaming output and cancellation preserves false reason", async () => {
  const f = fixture([[Uint8Array.of(1), Uint8Array.of(2)]]);
  const provider = createElevenLabsProvider({ transport: f.transport, apiKey: "k", models: [{ id: "x", endpoint: "music", outputType: "audio/mpeg" }] });
  const iterator = provider.complete(request("x"))[Symbol.asyncIterator](); await iterator.next(); await iterator.return?.(); assert.equal(f.disposed, 1);
  const abort = new AbortController(); abort.abort(false);
  await assert.rejects(collect(provider, request("x", { signal: abort.signal })), reason => reason === false);
});

test("video polling is bounded and failure stops before content download", async () => {
  for (const status of ["queued", "failed"]) {
    const f = fixture([JSON.stringify({ id: "video_1", status })]);
    const provider = createOpenAiProvider({ transport: f.transport, apiKey: "k", models: [{ id: "v", endpoint: "videos", outputType: "video/mp4" }], limits: { maxPolls: 0 } });
    await assert.rejects(collect(provider, request("v"))); assert.equal(f.requests.length, 1); assert.equal(f.disposed, 1);
  }
});

test("reference factories require truthful binary declarations and reject contradictory formats", async () => {
  const f = fixture([]);
  for (const endpoint of ["images", "videos"] as const) {
    assert.throws(() => createOpenAiProvider({ transport: f.transport, apiKey: "k", models: [{ id: "x", endpoint }] }), /outputType/);
  }
  assert.throws(() => createElevenLabsProvider({ transport: f.transport, apiKey: "k", models: [{ id: "x", endpoint: "tts" }] }), /outputType/);
  const image = createOpenAiProvider({ transport: f.transport, apiKey: "k", models: [{ id: "x", endpoint: "images", outputType: "image/png" }] });
  await assert.rejects(collect(image, request("x", { options: { output_format: "jpeg" } })), /output_format/);
  const audio = createElevenLabsProvider({ transport: f.transport, apiKey: "k", models: [{ id: "x", endpoint: "music", outputType: "audio/mpeg" }] });
  await assert.rejects(collect(audio, request("x", { options: { output_format: "wav_44100" } })), /output_format/);
  assert.equal(f.requests.length, 0);
});

test("image format derives from metadata, and file parts retain exact bytes", async () => {
  const f = fixture(['{"data":[{"b64_json":"AP8="}]}']);
  const image = createOpenAiProvider({ transport: f.transport, apiKey: "k", models: [{ id: "x", endpoint: "images", outputType: "image/png" }] });
  await collect(image, request("x", { attachments: [{ mimeType: "image/png", bytes: Uint8Array.of(0, 255) }] }));
  const text = new TextDecoder().decode(f.requests[0]!.bytes);
  assert.ok(text.includes('name="output_format"\r\n\r\npng\r\n'));
  assert.ok(f.requests[0]!.bytes.some((byte, index, bytes) => byte === 0 && bytes[index + 1] === 255));
});

test("pending transport response is disposed after cancellation with exact false reason", async () => {
  let deliver!: (response: Awaited<ReturnType<HttpTransport>>) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  let disposed = 0;
  const transport: HttpTransport = async () => { started(); return new Promise(resolve => { deliver = resolve; }); };
  const provider = createElevenLabsProvider({ transport, apiKey: "k", models: [{ id: "x", endpoint: "music", outputType: "audio/mpeg" }] });
  const abort = new AbortController(); const result = collect(provider, request("x", { signal: abort.signal }));
  await entered; abort.abort(false); await assert.rejects(result, reason => reason === false);
  deliver({ status: 200, statusText: "ok", headers: [], body: (async function* () { yield Uint8Array.of(1); })(), async dispose() { disposed++; } });
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(disposed, 1);
});

test("blocked response read aborts promptly and starts disposal", async () => {
  let started!: () => void, disposed = 0;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const transport: HttpTransport = async () => ({ status: 200, statusText: "ok", headers: [], body: { [Symbol.asyncIterator]() { return { next() { started(); return new Promise<IteratorResult<Uint8Array>>(() => {}); } }; } }, async dispose() { disposed++; } });
  const provider = createElevenLabsProvider({ transport, apiKey: "k", models: [{ id: "x", endpoint: "music", outputType: "audio/mpeg" }] });
  const abort = new AbortController(); const result = collect(provider, request("x", { signal: abort.signal }));
  await entered; abort.abort(0); await assert.rejects(result, reason => reason === 0);
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(disposed, 1);
});

test("SSE event size and request limits reject without retaining unbounded buffers", async () => {
  const f = fixture(['data: {"choices":[{"delta":{"content":"too long"}}]}\n\n']);
  const chat = createOpenAiProvider({ transport: f.transport, apiKey: "k", models: [{ id: "x", endpoint: "chat" }], limits: { maxEventBytes: 8 } });
  await assert.rejects(collect(chat, request("x")), /event byte limit/); assert.equal(f.disposed, 1);
  const small = createOpenAiProvider({ transport: f.transport, apiKey: "k", models: [{ id: "x", endpoint: "chat" }], limits: { maxRequestBytes: 4 } });
  await assert.rejects(collect(small, request("x")), /request byte limit/); assert.equal(f.requests.length, 1);
});

test("transport ownership survives cancellation at every response adoption microtask", async () => {
  for (let hops = 0; hops < 10; hops++) {
    const abort = new AbortController(); let disposed = 0;
    const transport: HttpTransport = async () => {
      let remaining = hops;
      const cancel = (): void => { if (remaining-- > 0) queueMicrotask(cancel); else abort.abort(false); };
      queueMicrotask(cancel);
      return { status: 200, statusText: "ok", headers: [], body: (async function* () { yield Uint8Array.of(1); })(), async dispose() { disposed++; } };
    };
    const provider = createElevenLabsProvider({ transport, apiKey: "k", models: [{ id: "x", endpoint: "music", outputType: "audio/mpeg" }] });
    try { await collect(provider, request("x", { signal: abort.signal })); } catch (reason) { assert.equal(reason, false); }
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(disposed, 1, `adoption hop ${hops}`);
  }
});
