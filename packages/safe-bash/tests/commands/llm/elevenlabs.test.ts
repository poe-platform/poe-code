import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { createElevenLabsProvider, type ElevenLabsModel } from "../../../src/commands/llm/elevenlabs.js";
import type { LlmRequest } from "../../../src/commands/llm/types.js";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../../src/commands/network/types.js";

const audio = [new Uint8Array([0xff, 0xfb, 0, 0x80]), new Uint8Array([0, 13, 10, 255])];
const models: readonly ElevenLabsModel[] = [
  { id: "consumer-speech", aliases: ["tts"], endpoint: "tts", outputType: "audio/mpeg", defaultVoiceId: "default-voice" },
  { id: "consumer-music", aliases: ["music"], endpoint: "music", outputType: "audio/mpeg" },
];

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return { model: "consumer-speech", prompt: "Hello 🦊", attachments: [], options: {}, signal: new AbortController().signal, ...overrides };
}

function fixture(overrides: Partial<HttpResponse> = {}) {
  const requests: HttpRequest[] = [];
  const bodies: unknown[] = [];
  let disposed = 0;
  let reads = 0;
  const response: HttpResponse = {
    status: 200, statusText: "OK", headers: [["content-type", "audio/mpeg"]],
    body: (async function* () { for (const chunk of audio) { reads++; yield chunk; } })(),
    async dispose() { disposed++; },
    ...overrides,
  };
  const transport: HttpTransport = async (outgoing) => {
    requests.push(outgoing);
    let body = "";
    const decoder = new TextDecoder();
    if (outgoing.body) for await (const chunk of outgoing.body) body += decoder.decode(chunk, { stream: true });
    bodies.push(JSON.parse(body + decoder.decode()));
    return response;
  };
  return { transport, requests, bodies, response, get disposed() { return disposed; }, get reads() { return reads; } };
}

async function collect(source: AsyncIterable<string | Uint8Array>): Promise<Uint8Array[]> {
  const result: Uint8Array[] = [];
  for await (const chunk of source) { assert.ok(chunk instanceof Uint8Array); result.push(new Uint8Array(chunk)); }
  return result;
}

test("ElevenLabs exposes only consumer models and streams exact TTS bytes through the injected transport", async () => {
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "secret", models });
  assert.equal(provider.name, "elevenlabs");
  assert.deepEqual(provider.models, models);
  const input = request({ options: { voice_id: "voice /?#", stability: "0.5", similarity_boost: "0.75", speed: "1.2", style: "0", use_speaker_boost: "false", custom_setting: "001" } });
  assert.deepEqual(await collect(provider.complete(input)), audio);
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0]?.url, "https://api.elevenlabs.io/v1/text-to-speech/voice%20%2F%3F%23?output_format=mp3_44100_128");
  assert.equal(fake.requests[0]?.method, "POST");
  assert.equal(fake.requests[0]?.signal, input.signal);
  const headers = new Map(fake.requests[0]?.headers);
  assert.equal(headers.get("xi-api-key"), "secret");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(fake.bodies, [{ text: "Hello 🦊", model_id: "consumer-speech", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.2, style: 0, use_speaker_boost: false, custom_setting: "001" } }]);
  assert.equal(input.options.voice_id, "voice /?#");
  assert.equal(fake.disposed, 1);
});

test("ElevenLabs uses per-model default voice and preserves a custom base path", async () => {
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", baseUrl: "https://proxy.invalid/eleven/", models });
  await collect(provider.complete(request()));
  assert.equal(fake.requests[0]?.url, "https://proxy.invalid/eleven/v1/text-to-speech/default-voice?output_format=mp3_44100_128");
  assert.deepEqual(fake.bodies, [{ text: "Hello 🦊", model_id: "consumer-speech", voice_settings: {} }]);
});

test("ElevenLabs music maps numeric and boolean options without replacing prompt or model", async () => {
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  const input = request({ model: "consumer-music", prompt: "Jazz loop", options: { music_length_ms: "30000", force_instrumental: "true", store_for_inpainting: "false", sign_with_c2pa: "true", respect_sections_durations: "false", finetune_id: "001", future_option: "true", model_id: "wrong", prompt: "wrong" } });
  assert.deepEqual(await collect(provider.complete(input)), audio);
  assert.equal(fake.requests[0]?.url, "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128");
  assert.deepEqual(fake.bodies, [{ prompt: "Jazz loop", model_id: "consumer-music", music_length_ms: 30000, force_instrumental: true, store_for_inpainting: false, sign_with_c2pa: true, respect_sections_durations: false, finetune_id: "001", future_option: "true" }]);
  assert.equal(fake.disposed, 1);
});

for (const [outputType, outputFormat] of [
  ["audio/mpeg", "mp3_44100_128"], ["audio/wav", "wav_44100"], ["audio/x-wav", "wav_44100"],
  ["audio/pcm", "pcm_44100"], ["audio/basic", "ulaw_8000"], ["audio/opus", "opus_48000_128"],
] as const) test(`ElevenLabs derives ${outputFormat} from ${outputType}`, async () => {
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models: [{ id: "custom", endpoint: "tts", outputType, defaultVoiceId: "voice" }] });
  await collect(provider.complete(request({ model: "custom" })));
  assert.equal(new URL(fake.requests[0]!.url).searchParams.get("output_format"), outputFormat);
  assert.equal(Object.hasOwn(fake.bodies[0] as object, "output_format"), false);
});

test("ElevenLabs defaults omitted outputType to audio/mpeg rather than advertising text", async () => {
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models: [{ id: "custom", endpoint: "music" }] });
  assert.equal(provider.models[0]?.outputType, "audio/mpeg");
  await collect(provider.complete(request({ model: "custom" })));
  assert.equal(new URL(fake.requests[0]!.url).searchParams.get("output_format"), "mp3_44100_128");
});

test("ElevenLabs rejects missing and blank voices before transport", async () => {
  for (const options of [{}, { voice_id: "" }, { voice_id: "   " }]) {
    const fake = fixture();
    const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models: [{ id: "custom", endpoint: "tts", outputType: "audio/mpeg" }] });
    await assert.rejects(collect(provider.complete(request({ model: "custom", options }))), /voice_id.*defaultVoiceId/);
    assert.equal(fake.requests.length, 0);
  }
});

test("ElevenLabs rejects unknown models and all attachments before transport", async () => {
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  await assert.rejects(collect(provider.complete(request({ model: "not-configured" }))), /Unknown model: not-configured/);
  for (const model of models) {
    await assert.rejects(collect(provider.complete(request({ model: model.id, attachments: [{ mimeType: "audio/mpeg", bytes: audio[0]! }] }))), /does not accept audio\/mpeg/);
  }
  assert.equal(fake.requests.length, 0);
});

for (const options of [{ stability: "NaN" }, { speed: "" }, { similarity_boost: "Infinity" }, { style: "0.4oops" }, { use_speaker_boost: "yes" }]) {
  test(`ElevenLabs rejects invalid TTS setting ${JSON.stringify(options)}`, async () => {
    const fake = fixture();
    const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
    await assert.rejects(collect(provider.complete(request({ options }))), /Invalid ElevenLabs option/);
    assert.equal(fake.requests.length, 0);
  });
}

for (const options of [{ music_length_ms: "3.5" }, { music_length_ms: "Infinity" }, { music_length_ms: " " }, { force_instrumental: "1" }, { seed: "1.5" }]) {
  test(`ElevenLabs rejects invalid music option ${JSON.stringify(options)}`, async () => {
    const fake = fixture();
    const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
    await assert.rejects(collect(provider.complete(request({ model: "consumer-music", options }))), /Invalid ElevenLabs option/);
    assert.equal(fake.requests.length, 0);
  });
}

for (const status of [301, 401, 422, 429, 500]) test(`ElevenLabs rejects HTTP ${status} and disposes without yielding error bytes`, async () => {
  const fake = fixture({ status, statusText: "Failure" });
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  await assert.rejects(collect(provider.complete(request())), new RegExp(`ElevenLabs.*${status}`));
  assert.equal(fake.reads, 0);
  assert.equal(fake.disposed, 1);
});

test("ElevenLabs remains lazy and does not read ahead; breaking disposes the response", async () => {
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  const stream = provider.complete(request());
  assert.equal(fake.requests.length, 0);
  for await (const chunk of stream) { assert.deepEqual(chunk, audio[0]); assert.equal(fake.reads, 1); break; }
  assert.equal(fake.disposed, 1);
  assert.equal(fake.reads, 1);
});

test("ElevenLabs preserves a stream error while disposing", async () => {
  const failure = new Error("broken audio stream");
  const fake = fixture({ body: (async function* () { yield audio[0]!; throw failure; })() });
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  await assert.rejects(collect(provider.complete(request())), error => error === failure);
  assert.equal(fake.disposed, 1);
});

test("ElevenLabs abort before request does not acquire transport", async () => {
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  const failure = new Error("cancelled");
  await assert.rejects(collect(provider.complete(request({ signal: AbortSignal.abort(failure) }))), error => error === failure);
  assert.equal(fake.requests.length, 0);
});

test("ElevenLabs abort between chunks stops and disposes", async () => {
  const controller = new AbortController();
  const failure = new Error("cancelled");
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  const iterator = provider.complete(request({ signal: controller.signal }))[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, audio[0]);
  controller.abort(failure);
  await assert.rejects(iterator.next(), error => error === failure);
  assert.equal(fake.reads, 1);
  assert.equal(fake.disposed, 1);
});

test("ElevenLabs rejects a pending transport on abort and disposes a late response", async () => {
  const controller = new AbortController();
  const acquired = deferred<void>();
  const pending = deferred<HttpResponse>();
  const fake = fixture();
  const failure = new Error("cancelled acquisition");
  const provider = createElevenLabsProvider({ transport: () => { acquired.resolve(); return pending.promise; }, apiKey: "key", models });
  const completion = collect(provider.complete(request({ signal: controller.signal })));
  await acquired.promise;
  controller.abort(failure);
  await assert.rejects(completion, error => error === failure);
  pending.resolve(fake.response);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(fake.disposed, 1);
});

test("ElevenLabs abort interrupts a pending audio read and disposes", async () => {
  const controller = new AbortController();
  const reading = deferred<void>();
  const pending = deferred<IteratorResult<Uint8Array>>();
  const fake = fixture({ body: { [Symbol.asyncIterator]() { return { next() { reading.resolve(); return pending.promise; } }; } } });
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  const failure = new Error("cancelled read");
  const completion = collect(provider.complete(request({ signal: controller.signal })));
  await reading.promise;
  controller.abort(failure);
  await assert.rejects(completion, error => error === failure);
  assert.equal(fake.disposed, 1);
  pending.reject(new Error("late read rejection"));
});

test("ElevenLabs refuses unsupported formats, endpoints, duplicate ids, and declared attachments", () => {
  const fake = fixture();
  for (const invalid of [
    [{ id: "custom", endpoint: "tts", outputType: "image/png" }],
    [{ id: "custom", endpoint: "music", outputType: "audio/wav" }],
    [{ id: "custom", endpoint: "wrong", outputType: "audio/mpeg" }],
    [{ id: "custom", endpoint: "music", attachmentTypes: ["audio/*"] }],
    [models[0]!, models[0]!],
  ]) assert.throws(() => createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models: invalid as ElevenLabsModel[] }), /ElevenLabs/);
  assert.equal(fake.requests.length, 0);
});

test("ElevenLabs does not let dot-segment voice IDs change the endpoint", async () => {
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  for (const voice_id of [".", ".."]) {
    await assert.rejects(collect(provider.complete(request({ options: { voice_id } }))), /Invalid ElevenLabs voice_id/);
  }
  assert.equal(fake.requests.length, 0);
});

test("ElevenLabs accepts decimal CLI number spellings and preserves false", async () => {
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  await collect(provider.complete(request({ options: { stability: ".5", speed: "+1", use_speaker_boost: "true" } })));
  assert.deepEqual(fake.bodies[0], { text: "Hello 🦊", model_id: "consumer-speech", voice_settings: { stability: 0.5, speed: 1, use_speaker_boost: true } });
  await collect(provider.complete(request({ model: "consumer-music", options: { force_instrumental: "false", seed: "42" } })));
  assert.deepEqual(fake.bodies[1], { prompt: "Hello 🦊", model_id: "consumer-music", force_instrumental: false, seed: 42 });
});

test("ElevenLabs cleans up a response that arrives concurrently with abort", async () => {
  const fake = fixture();
  const controller = new AbortController();
  const failure = new Error("abort during acquisition");
  const provider = createElevenLabsProvider({ transport: async () => { controller.abort(failure); return fake.response; }, apiKey: "key", models });
  await assert.rejects(collect(provider.complete(request({ signal: controller.signal }))), error => error === failure);
  assert.equal(fake.disposed, 1);
  assert.equal(fake.reads, 0);
});

test("ElevenLabs exposes transport errors without retrying", async () => {
  const failure = new Error("transport denied");
  for (const transport of [() => { throw failure; }, async () => { throw failure; }]) {
    const provider = createElevenLabsProvider({ transport, apiKey: "key", models });
    await assert.rejects(collect(provider.complete(request())), error => error === failure);
  }
});

test("ElevenLabs rejects non-byte stream chunks and closes the iterator", async () => {
  let closed = false;
  const body = (async function* () { try { yield "not audio"; } finally { closed = true; } })();
  const fake = fixture({ body: body as unknown as HttpResponse["body"] });
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  await assert.rejects(collect(provider.complete(request())), /Uint8Array/);
  assert.equal(fake.disposed, 1);
  assert.equal(closed, true);
});

test("ElevenLabs waits for response disposal and reports cleanup failure on success", async () => {
  const disposing = deferred<void>();
  const cleanup = deferred<void>();
  const failure = new Error("disposal failed");
  const fake = fixture({ dispose() { disposing.resolve(); return cleanup.promise; } });
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  let settled = false;
  const completion = collect(provider.complete(request()));
  void completion.then(() => { settled = true; }, () => { settled = true; });
  await disposing.promise;
  assert.equal(settled, false);
  cleanup.reject(failure);
  await assert.rejects(completion, error => error === failure);
});

test("ElevenLabs preserves primary stream errors even if both cleanup operations fail", async () => {
  const failure = new Error("primary stream error");
  let closed = false;
  const fake = fixture({
    body: { [Symbol.asyncIterator]() { return { async next() { throw failure; }, async return() { closed = true; throw new Error("iterator cleanup"); } }; } },
    async dispose() { throw new Error("response cleanup"); },
  });
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  await assert.rejects(collect(provider.complete(request())), error => error === failure);
  assert.equal(closed, true);
});

test("ElevenLabs disposes while a consumer is paused and preserves falsey abort reasons", async () => {
  const controller = new AbortController();
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  const iterator = provider.complete(request({ signal: controller.signal }))[Symbol.asyncIterator]();
  await iterator.next();
  controller.abort(null);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(fake.disposed, 1);
  await assert.rejects(iterator.next(), error => error === null);
  assert.equal(fake.disposed, 1);
});

test("ElevenLabs rejects ambiguous base URLs before sending credentials", () => {
  const fake = fixture();
  for (const baseUrl of ["file:///tmp", "https://user:password@proxy.invalid", "https://proxy.invalid/?query=1", "https://proxy.invalid/#fragment"]) {
    assert.throws(() => createElevenLabsProvider({ transport: fake.transport, apiKey: "key", baseUrl, models }), /Invalid ElevenLabs baseUrl/);
  }
  assert.equal(fake.requests.length, 0);
});

test("ElevenLabs does not advance the producer when abort races a queued read", async () => {
  const controller = new AbortController();
  const fake = fixture();
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  const iterator = provider.complete(request({ signal: controller.signal }))[Symbol.asyncIterator]();
  await iterator.next();
  const pending = iterator.next();
  const failure = new Error("cancel queued read");
  controller.abort(failure);
  await assert.rejects(pending, error => error === failure);
  assert.equal(fake.reads, 1);
  assert.equal(fake.disposed, 1);
});

test("ElevenLabs preserves cancellation during cooperative response cleanup", async () => {
  const controller = new AbortController();
  const disposing = deferred<void>();
  const cleanup = deferred<void>();
  const fake = fixture({ dispose() { disposing.resolve(); return cleanup.promise; } });
  const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
  const completion = collect(provider.complete(request({ signal: controller.signal })));
  await disposing.promise;
  const failure = new Error("cancel during cleanup");
  controller.abort(failure);
  cleanup.resolve();
  await assert.rejects(completion, error => error === failure);
});

test("ElevenLabs releases abort listeners on completion, error, and consumer closure", async () => {
  for (const ending of ["complete", "error", "break"] as const) {
    const controller = new AbortController();
    const fake = fixture(ending === "error" ? { status: 500 } : {});
    const provider = createElevenLabsProvider({ transport: fake.transport, apiKey: "key", models });
    const source = provider.complete(request({ signal: controller.signal }));
    if (ending === "error") await assert.rejects(collect(source));
    else if (ending === "complete") await collect(source);
    else for await (const chunk of source) { assert.deepEqual(chunk, audio[0]); break; }
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.equal(fake.disposed, 1);
  }
});

test("ElevenLabs abort waits for cleanup registered by a pending transport", async () => {
  const controller = new AbortController();
  const entered = deferred<void>(), cleaning = deferred<void>(), release = deferred<void>();
  const pending = deferred<HttpResponse>();
  const fake = fixture();
  let calls = 0;
  let supportsCleanup = false;
  const provider = createElevenLabsProvider({ apiKey: "key", models, transport(outgoing) {
    supportsCleanup = typeof outgoing.registerCleanup === "function";
    outgoing.registerCleanup?.(async () => { calls++; cleaning.resolve(); await release.promise; });
    entered.resolve();
    return pending.promise;
  } });
  let settled = false;
  const completion = collect(provider.complete(request({ signal: controller.signal })));
  void completion.then(() => { settled = true; }, () => { settled = true; });
  await entered.promise;
  assert.equal(supportsCleanup, true);
  const failure = new Error("cancel acquisition with registered cleanup");
  controller.abort(failure);
  await cleaning.promise;
  assert.equal(settled, false);
  release.resolve();
  await assert.rejects(completion, error => error === failure);
  assert.equal(calls, 1);
  pending.resolve(fake.response);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(fake.disposed, 1);
});

test("ElevenLabs deduplicates registered response disposal", async () => {
  const fake = fixture();
  const provider = createElevenLabsProvider({ apiKey: "key", models, transport: async outgoing => {
    assert.equal(typeof outgoing.registerCleanup, "function");
    outgoing.registerCleanup!(fake.response.dispose);
    outgoing.registerCleanup!(fake.response.dispose);
    return fake.response;
  } });
  assert.deepEqual(await collect(provider.complete(request())), audio);
  assert.equal(fake.disposed, 1);
});

test("ElevenLabs runs registered cleanup when transport throws before returning a response", async () => {
  let closed = 0;
  const failure = new Error("transport failure after acquiring resources");
  const provider = createElevenLabsProvider({ apiKey: "key", models, transport: outgoing => {
    assert.equal(typeof outgoing.registerCleanup, "function");
    outgoing.registerCleanup!(() => { closed++; });
    throw failure;
  } });
  await assert.rejects(collect(provider.complete(request())), error => error === failure);
  assert.equal(closed, 1);
});

test("ElevenLabs retains the receiver for response dispose methods", async () => {
  const fake = fixture();
  const response = { ...fake.response, calls: 0, async dispose() { this.calls++; } };
  const provider = createElevenLabsProvider({ apiKey: "key", models, transport: async () => response });
  await collect(provider.complete(request()));
  assert.equal(response.calls, 1);
});

test("ElevenLabs waits for already-started iterator cleanup when abort arrives during consumer closure", async () => {
  const controller = new AbortController();
  const closing = deferred<void>(), release = deferred<void>();
  let returns = 0;
  const fake = fixture({ body: { [Symbol.asyncIterator]() { return {
    async next() { return { done: false as const, value: audio[0]! }; },
    async return() { returns++; closing.resolve(); await release.promise; return { done: true as const, value: undefined }; },
  }; } } });
  const provider = createElevenLabsProvider({ apiKey: "key", models, transport: fake.transport });
  const completion = (async () => {
    for await (const chunk of provider.complete(request({ signal: controller.signal }))) { assert.deepEqual(chunk, audio[0]); break; }
  })();
  let settled = false;
  void completion.then(() => { settled = true; }, () => { settled = true; });
  await closing.promise;
  const failure = new Error("abort during cooperative iterator cleanup");
  controller.abort(failure);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  release.resolve();
  await assert.rejects(completion, error => error === failure);
  assert.equal(returns, 1);
  assert.equal(fake.disposed, 1);
});
