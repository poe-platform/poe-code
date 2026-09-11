import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { createOpenAiProvider, type OpenAiModel } from "../../../src/commands/llm/openai.js";
import { openAiChat } from "../../../src/commands/llm/openai-sse.js";
import type { LlmRequest } from "../../../src/commands/llm/types.js";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../../src/commands/network/types.js";

const encoder = new TextEncoder();
const picture = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0, 255);
const movie = Uint8Array.of(0, 0, 0, 20, 102, 116, 121, 112, 0, 255);
const models: readonly OpenAiModel[] = [
  { id: "custom-chat", endpoint: "chat", aliases: ["talk"], attachmentTypes: ["image/*"] },
  { id: "custom-image", endpoint: "images", attachmentTypes: ["image/*"], outputType: "image/png" },
  { id: "custom-video", endpoint: "videos", attachmentTypes: ["image/*"], outputType: "video/mp4" },
];

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return { model: "custom-chat", prompt: "describe", attachments: [], options: {}, signal: new AbortController().signal, ...overrides };
}

async function* bytes(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  yield* chunks;
}

function response(payload: unknown, status = 200): { -readonly [Key in keyof HttpResponse]: HttpResponse[Key] } & { disposed: number } {
  return {
    status, statusText: "", headers: [], disposed: 0,
    body: bytes(payload instanceof Uint8Array ? payload : encoder.encode(typeof payload === "string" ? payload : JSON.stringify(payload))),
    async dispose() { this.disposed++; },
  };
}

function fake(...responses: HttpResponse[]): { transport: HttpTransport; calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  return {
    calls,
    transport: async input => {
      calls.push(input);
      const next = responses.shift();
      assert.ok(next, "unexpected transport request");
      return next;
    },
  };
}

async function collect(source: AsyncIterable<string | Uint8Array>): Promise<(string | Uint8Array)[]> {
  const chunks: (string | Uint8Array)[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return chunks;
}

async function wireBody(input: HttpRequest): Promise<Response> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  if (input.body) for await (const chunk of input.body) chunks.push(Uint8Array.from(chunk));
  return new Response(new Blob(chunks), { headers: new Headers(input.headers.map(([name, value]): [string, string] => [name, value])) });
}

function provider(transport: HttpTransport) {
  return createOpenAiProvider({ transport, apiKey: "test-secret", models });
}

test("OpenAI routes arbitrary configured models and streams split UTF-8 SSE deltas", async () => {
  const reply = response("");
  const stream = encoder.encode(': heartbeat\r\ndata: {"choices":[{"delta":{"role":"assistant"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"fox 🦊"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  reply.body = bytes(...Array.from(stream, value => Uint8Array.of(value)));
  const transport = fake(reply);
  const configured = createOpenAiProvider({ transport: transport.transport, apiKey: "test-secret", baseUrl: "https://compatible.test/custom/v1/", models });
  assert.equal(configured.name, "openai");
  assert.deepEqual(configured.models, models);
  const signal = new AbortController().signal;
  assert.deepEqual(await collect(configured.complete(request({ system: "be brief", signal, options: { temperature: "0.25" }, attachments: [{ mimeType: "image/png", bytes: picture }] }))), ["fox 🦊", "!"]);
  const sent = transport.calls[0]!;
  assert.equal(sent.url, "https://compatible.test/custom/v1/chat/completions");
  assert.equal(sent.method, "POST");
  assert.equal(sent.signal, signal);
  assert.equal(new Headers(sent.headers.map(([name, value]): [string, string] => [name, value])).get("authorization"), "Bearer test-secret");
  assert.deepEqual(await (await wireBody(sent)).json(), {
    model: "custom-chat", stream: true, temperature: 0.25,
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: [{ type: "text", text: "describe" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoA/w==" } }] },
    ],
  });
  assert.equal(reply.disposed, 1);
});

test("OpenAI image generation decodes fixed bytes and passes option strings unchanged", async () => {
  const reply = response({ data: [{ b64_json: "iVBORw0KGgoA/w==" }] });
  const transport = fake(reply);
  assert.deepEqual(await collect(provider(transport.transport).complete(request({ model: "custom-image", options: { size: "1024x1024", quality: "high", background: "transparent" } }))), [picture]);
  assert.equal(transport.calls[0]!.url, "https://api.openai.com/v1/images/generations");
  assert.deepEqual(await (await wireBody(transport.calls[0]!)).json(), { model: "custom-image", prompt: "describe", size: "1024x1024", quality: "high", background: "transparent", output_format: "png" });
  assert.equal(reply.disposed, 1);
});

test("OpenAI image edits send owned multipart bytes for every attachment", async () => {
  const reply = response({ data: [{ b64_json: "iVBORw0KGgoA/w==" }] });
  const transport = fake(reply);
  const input = picture.slice();
  await collect(provider(transport.transport).complete(request({ model: "custom-image", options: { size: "auto" }, attachments: [{ mimeType: "image/png", bytes: input }, { mimeType: "image/webp", bytes: picture }] })));
  input.fill(0);
  assert.equal(transport.calls[0]!.url, "https://api.openai.com/v1/images/edits");
  const form = await (await wireBody(transport.calls[0]!)).formData();
  assert.equal(form.get("model"), "custom-image");
  assert.equal(form.get("prompt"), "describe");
  assert.equal(form.get("size"), "auto");
  const images = form.getAll("image[]") as File[];
  assert.equal(images.length, 2);
  assert.equal(images[0]!.type, "image/png");
  assert.equal(images[1]!.type, "image/webp");
  assert.deepEqual(new Uint8Array(await images[0]!.arrayBuffer()), picture);
  assert.equal(reply.disposed, 1);
});

test("OpenAI video creation uses multipart input_reference then polls and downloads", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const created = response({ id: "video/custom", status: "queued" });
  const pending = response({ id: "video/custom", status: "in_progress" });
  const completed = response({ id: "video/custom", status: "completed" });
  const downloaded = response(movie);
  const transport = fake(created, pending, completed, downloaded);
  const output = collect(provider(transport.transport).complete(request({ model: "custom-video", options: { seconds: "8", size: "1280x720" }, attachments: [{ mimeType: "image/png", bytes: picture }] })));
  for (let tick = 0; tick < 100; tick++) { await Promise.resolve(); context.mock.timers.tick(10_000); }
  assert.deepEqual(await output, [movie]);
  assert.deepEqual(transport.calls.map(input => [input.method, input.url]), [
    ["POST", "https://api.openai.com/v1/videos"],
    ["GET", "https://api.openai.com/v1/videos/video%2Fcustom"],
    ["GET", "https://api.openai.com/v1/videos/video%2Fcustom"],
    ["GET", "https://api.openai.com/v1/videos/video%2Fcustom/content"],
  ]);
  const form = await (await wireBody(transport.calls[0]!)).formData();
  assert.equal(form.get("model"), "custom-video");
  assert.equal(form.get("seconds"), "8");
  assert.equal(form.get("size"), "1280x720");
  const reference = form.get("input_reference") as File;
  assert.equal(reference.type, "image/png");
  assert.deepEqual(new Uint8Array(await reference.arrayBuffer()), picture);
  assert.ok([created, pending, completed, downloaded].every(reply => reply.disposed === 1));
});

for (const status of [301, 302, 307, 308, 400, 401, 429, 500]) {
  test(`OpenAI HTTP ${status} fails without redirect following and disposes`, async () => {
    const reply = response({ error: { message: "request denied" } }, status);
    reply.headers = [["location", "https://untrusted.test/leak"]];
    const transport = fake(reply);
    await assert.rejects(collect(provider(transport.transport).complete(request())), new RegExp(String(status)));
    assert.equal(transport.calls.length, 1);
    assert.equal(reply.disposed, 1);
  });
}

for (const model of models) for (const maxResponseBytes of [1, 16]) {
  test(`OpenAI ${model.endpoint} HTTP errors stop reading at configured response budget ${maxResponseBytes}`, async () => {
    const payload = encoder.encode(JSON.stringify({ error: { message: "denied" }, padding: "1234567890" }));
    const reply = response("", 401);
    let consumed = 0, returned = 0;
    reply.body = (async function* () {
      try { for (const byte of payload) { consumed++; yield Uint8Array.of(byte); } }
      finally { returned++; }
    })();
    const transport = fake(reply);
    const configured = createOpenAiProvider({ transport: transport.transport, apiKey: "test-secret", models, limits: { maxResponseBytes } });
    const input = request({ model: model.id });
    await assert.rejects(collect(configured.complete(input)), /OpenAI HTTP 401/);
    assert.equal(consumed, maxResponseBytes + 1, "only one overflow-detection byte may be consumed");
    assert.equal(returned, 1);
    assert.equal(reply.disposed, 1);
    assert.equal(transport.calls.length, 1);
    assert.equal(getEventListeners(input.signal, "abort").length, 0);
  });
}

for (const margin of [-1, 0, 1]) {
  test(`OpenAI HTTP error detail respects the exact UTF-8 byte budget with margin ${margin}`, async () => {
    const message = "denied 🦊";
    const payload = encoder.encode(JSON.stringify({ error: { message } }));
    const maxResponseBytes = payload.length + margin;
    const reply = response("", 429);
    let consumed = 0, closed = false;
    reply.body = (async function* () {
      try { for (const byte of payload) { consumed++; yield Uint8Array.of(byte); } }
      finally { closed = true; }
    })();
    const configured = createOpenAiProvider({ transport: fake(reply).transport, apiKey: "test-secret", models, limits: { maxResponseBytes } });
    await assert.rejects(collect(configured.complete(request())), { message: margin < 0 ? "OpenAI HTTP 429" : `OpenAI HTTP 429: ${message}` });
    assert.equal(consumed, Math.min(payload.length, maxResponseBytes + 1));
    assert.equal(closed, true);
    assert.equal(reply.disposed, 1);
  });
}

for (const maxResponseBytes of [undefined, 64 * 1024, 128 * 1024]) {
  test(`OpenAI HTTP errors retain the 64 KiB diagnostic ceiling with response budget ${maxResponseBytes ?? "default"}`, async () => {
    const reply = response("", 500);
    let consumed = 0, closed = false;
    reply.body = (async function* () {
      try {
        for (let chunk = 0; chunk < 128; chunk++) {
          consumed += 1024;
          yield new Uint8Array(1024).fill(32);
        }
      } finally { closed = true; }
    })();
    const configured = createOpenAiProvider({ transport: fake(reply).transport, apiKey: "test-secret", models,
      limits: maxResponseBytes === undefined ? {} : { maxResponseBytes } });
    await assert.rejects(collect(configured.complete(request())), { message: "OpenAI HTTP 500" });
    assert.equal(consumed, 65 * 1024, "stop at the first chunk exceeding the smaller diagnostic ceiling");
    assert.equal(closed, true);
    assert.equal(reply.disposed, 1);
  });
}

test("OpenAI bounded HTTP errors survive iterator and response cleanup failures", async () => {
  const reply = response("", 503);
  let consumed = 0, returned = 0;
  reply.body = { [Symbol.asyncIterator]() { return {
    async next() { consumed++; return { done: false as const, value: Uint8Array.of(32) }; },
    async return() { returned++; throw new Error("secondary iterator cleanup"); },
  }; } };
  reply.dispose = async () => { reply.disposed++; throw new Error("secondary response cleanup"); };
  const configured = createOpenAiProvider({ transport: fake(reply).transport, apiKey: "test-secret", models, limits: { maxResponseBytes: 1 } });
  await assert.rejects(collect(configured.complete(request())), { message: "OpenAI HTTP 503" });
  assert.equal(consumed, 2);
  assert.equal(returned, 1);
  assert.equal(reply.disposed, 1);
});

for (const reason of [null, false, 0, ""]) {
  test(`OpenAI configured HTTP error parsing preserves cancellation ${JSON.stringify(reason)}`, async () => {
    const controller = new AbortController();
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    let reads = 0, returned = 0;
    const reply = response("", 401);
    reply.body = { [Symbol.asyncIterator]() { return {
      next() {
        if (++reads === 1) return Promise.resolve({ done: false as const, value: Uint8Array.of(123) });
        started();
        return new Promise<IteratorResult<Uint8Array>>(() => undefined);
      },
      async return() { returned++; return { done: true as const, value: undefined }; },
    }; } };
    const configured = createOpenAiProvider({ transport: fake(reply).transport, apiKey: "test-secret", models, limits: { maxResponseBytes: 8 } });
    const output = collect(configured.complete(request({ signal: controller.signal })));
    await reading;
    controller.abort(reason);
    await assert.rejects(output, error => error === reason);
    assert.equal(reads, 2);
    assert.equal(returned, 1);
    assert.equal(reply.disposed, 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
}

for (const payload of ["not JSON", "data: nope\n\n", 'data: {"choices":[{"delta":{"content":42}}]}\n\n', 'data: {"error":{"message":"stream failed"}}\n\n', 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']) {
  test(`OpenAI malformed or incomplete SSE fails: ${payload}`, async () => {
    const reply = response(payload);
    await assert.rejects(collect(provider(fake(reply).transport).complete(request())));
    assert.equal(reply.disposed, 1);
  });
}

for (const payload of ["broken", {}, { data: [] }, { data: [{}] }, { data: [{ b64_json: "%%%" }] }, { data: [{ b64_json: "" }] }, { error: { message: "image failed" } }]) {
  test(`OpenAI rejects malformed images: ${JSON.stringify(payload)}`, async () => {
    const reply = response(payload);
    await assert.rejects(collect(provider(fake(reply).transport).complete(request({ model: "custom-image" }))));
    assert.equal(reply.disposed, 1);
  });
}

for (const payload of [{}, { id: "", status: "completed" }, { id: "vid", status: "unknown" }, { id: "vid", status: "failed", error: { message: "render failed" } }, { id: "vid", status: "cancelled" }]) {
  test(`OpenAI rejects failed or malformed video jobs: ${JSON.stringify(payload)}`, async () => {
    const reply = response(payload);
    const transport = fake(reply);
    await assert.rejects(collect(provider(transport.transport).complete(request({ model: "custom-video" }))));
    assert.equal(transport.calls.length, 1);
    assert.equal(reply.disposed, 1);
  });
}

test("OpenAI pre-aborted requests do not acquire transport resources", async () => {
  const transport = fake();
  const reason = new Error("cancelled by caller");
  await assert.rejects(collect(provider(transport.transport).complete(request({ signal: AbortSignal.abort(reason) }))), error => error === reason);
  assert.equal(transport.calls.length, 0);
});

test("OpenAI cancellation interrupts video polling without another request", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const reply = response({ id: "vid", status: "queued" });
  const transport = fake(reply);
  const controller = new AbortController();
  const output = collect(provider(transport.transport).complete(request({ model: "custom-video", signal: controller.signal })));
  for (let turn = 0; turn < 40; turn++) await Promise.resolve();
  const reason = new Error("stop polling");
  controller.abort(reason);
  await assert.rejects(output, error => error === reason);
  context.mock.timers.tick(100_000);
  assert.equal(transport.calls.length, 1);
  assert.equal(reply.disposed, 1);
});

test("OpenAI closes SSE on early consumer return", async () => {
  const reply = response('data: {"choices":[{"delta":{"content":"first"}}]}\n\ndata: {"choices":[{"delta":{"content":"second"}}]}\n\ndata: [DONE]\n\n');
  const iterator = provider(fake(reply).transport).complete(request())[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: "first", done: false });
  await iterator.return?.();
  assert.equal(reply.disposed, 1);
});

test("OpenAI download retains owned chunks when producer reuses and finalizes a buffer", async () => {
  const reply = response("");
  const shared = movie.slice();
  reply.body = (async function* () {
    try { yield shared; shared.fill(7); yield shared; }
    finally { shared.fill(0); }
  })();
  const transport = fake(response({ id: "vid", status: "completed" }), reply);
  const chunks = await collect(provider(transport.transport).complete(request({ model: "custom-video" })));
  assert.deepEqual(chunks, [movie, new Uint8Array(movie.length).fill(7)]);
  assert.equal(reply.disposed, 1);
});

test("OpenAI rejects unknown models and protocol field overrides before transport", async () => {
  const transport = fake();
  for (const input of [request({ model: "absent" }), request({ options: { stream: "false" } }), request({ options: { model: "other" } }), request({ model: "custom-image", options: { prompt: "other" } }), request({ model: "custom-video", options: { input_reference: "remote" } })]) {
    await assert.rejects(collect(provider(transport.transport).complete(input)));
  }
  assert.equal(transport.calls.length, 0);
});

test("OpenAI rejects unsupported attachments rather than silently discarding them", async () => {
  const transport = fake();
  for (const model of models) {
    await assert.rejects(collect(provider(transport.transport).complete(request({ model: model.id, attachments: [{ mimeType: "audio/mpeg", bytes: picture }] }))));
  }
  await assert.rejects(collect(provider(transport.transport).complete(request({ model: "custom-video", attachments: [{ mimeType: "image/png", bytes: picture }, { mimeType: "image/png", bytes: picture }] }))));
  assert.equal(transport.calls.length, 0);
});

test("OpenAI configuration validates URL, credentials and duplicate models", () => {
  const transport = fake().transport;
  for (const baseUrl of ["file:///tmp/data", "https://user:password@api.test", "https://api.test/v1?key=secret", "https://api.test/#fragment"]) {
    assert.throws(() => createOpenAiProvider({ transport, apiKey: "secret", models, baseUrl }));
  }
  assert.throws(() => createOpenAiProvider({ transport, apiKey: "", models }));
  assert.throws(() => createOpenAiProvider({ transport, apiKey: "key\r\ninjected: header", models }));
  assert.throws(() => createOpenAiProvider({ transport, apiKey: "secret", models: [models[0]!, models[0]!] }));
});

test("OpenAI snapshots declarative configuration without caller mutation changing routing", async () => {
  const model = { id: "dynamic", endpoint: "chat" as const, aliases: ["alias"], attachmentTypes: ["image/*"] };
  const transport = fake(response("data: [DONE]\n\n"));
  const configured = createOpenAiProvider({ transport: transport.transport, apiKey: "secret", models: [model] });
  model.id = "changed";
  model.aliases.push("changed");
  model.attachmentTypes.length = 0;
  assert.equal(configured.models[0]!.id, "dynamic");
  assert.deepEqual(configured.models[0]!.aliases, ["alias"]);
  assert.deepEqual(configured.models[0]!.attachmentTypes, ["image/*"]);
  await collect(configured.complete(request({ model: "dynamic" })));
});

test("OpenAI SSE supports BOM, multiline data, CR-only framing and usage events", async () => {
  const reply = response('\uFEFF: heartbeat\r\rdata: {"choices":\rdata: [{"delta":{"content":"ok"}}]}\r\rdata: {"choices":[],"usage":{"total_tokens":1}}\r\rdata: [DONE]\r\r');
  assert.deepEqual(await collect(provider(fake(reply).transport).complete(request())), ["ok"]);
  assert.equal(reply.disposed, 1);
});

test("OpenAI transport rejection awaits registered cleanup and preserves failure identity", async () => {
  const failure = new Error("transport failed");
  let cleaned = 0;
  const transport: HttpTransport = async input => {
    input.registerCleanup?.(async () => { await Promise.resolve(); cleaned++; });
    throw failure;
  };
  await assert.rejects(collect(provider(transport).complete(request())), error => error === failure);
  assert.equal(cleaned, 1);
});

test("OpenAI abort during pending acquisition disposes registered and late resources", async () => {
  const controller = new AbortController();
  let deliver!: (value: HttpResponse) => void;
  let admitted!: () => void;
  const started = new Promise<void>(resolve => { admitted = resolve; });
  let cleaned = 0;
  const transport: HttpTransport = input => {
    input.registerCleanup?.(() => { cleaned++; });
    admitted();
    return new Promise(resolve => { deliver = resolve; });
  };
  const output = collect(provider(transport).complete(request({ signal: controller.signal })));
  await started;
  const reason = new Error("abort acquiring");
  controller.abort(reason);
  await assert.rejects(output, error => error === reason);
  assert.equal(cleaned, 1);
  const late = response("data: [DONE]\n\n");
  deliver(late);
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  assert.equal(late.disposed, 1);
});

test("OpenAI abort interrupts a blocked body and closes it without replacing the reason", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let returned = 0;
  const reply = response("");
  reply.body = {
    [Symbol.asyncIterator]() {
      return {
        next() { started(); return new Promise<IteratorResult<Uint8Array>>(() => undefined); },
        async return() { returned++; return { done: true as const, value: undefined }; },
      };
    },
  };
  const output = collect(provider(fake(reply).transport).complete(request({ signal: controller.signal })));
  await reading;
  const reason = new Error("stop reading");
  controller.abort(reason);
  await assert.rejects(output, error => error === reason);
  assert.equal(reply.disposed, 1);
  assert.equal(returned, 1);
});

test("OpenAI abort disposes an acquired response while consumer is paused", async () => {
  const reply = response('data: {"choices":[{"delta":{"content":"first"}}]}\n\ndata: [DONE]\n\n');
  const controller = new AbortController();
  const iterator = provider(fake(reply).transport).complete(request({ signal: controller.signal }))[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: "first", done: false });
  controller.abort(new Error("paused cancellation"));
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  assert.equal(reply.disposed, 1);
  await assert.rejects(iterator.next(), error => error === controller.signal.reason);
  assert.equal(reply.disposed, 1);
});

test("OpenAI does not dispose a cleanup registered by transport twice", async () => {
  let disposed = 0;
  const dispose = async () => { disposed++; };
  const transport: HttpTransport = async input => {
    input.registerCleanup?.(dispose);
    return { ...response("data: [DONE]\n\n"), dispose };
  };
  await collect(provider(transport).complete(request()));
  assert.equal(disposed, 1);
});

test("OpenAI protocol errors survive secondary disposal failures", async () => {
  const reply = response('data: {"error":{"message":"original stream failure"}}\n\n');
  reply.dispose = async () => { throw new Error("secondary cleanup failure"); };
  await assert.rejects(collect(provider(fake(reply).transport).complete(request())), /original stream failure/);
});

test("OpenAI body failures survive secondary disposal failures", async () => {
  const failure = new Error("body read failed");
  const reply = response("");
  reply.body = { [Symbol.asyncIterator]() { return { async next() { throw failure; } }; } };
  reply.dispose = async () => { throw new Error("secondary cleanup failure"); };
  await assert.rejects(collect(provider(fake(reply).transport).complete(request())), error => error === failure);
});

for (const payload of ["", '{"error":{"message":"download denied"}}']) {
  test(`OpenAI rejects empty and JSON video downloads: ${payload}`, async () => {
    const reply = response(payload);
    if (payload) reply.headers = [["Content-Type", "application/json"]];
    const transport = fake(response({ id: "vid", status: "completed" }), reply);
    await assert.rejects(collect(provider(transport.transport).complete(request({ model: "custom-video" }))));
    assert.equal(reply.disposed, 1);
  });
}

for (const id of [".", ".."]) {
  test(`OpenAI rejects URL-normalizing video job id ${id}`, async () => {
    const reply = response({ id, status: "completed" });
    const transport = fake(reply);
    await assert.rejects(collect(provider(transport.transport).complete(request({ model: "custom-video" }))));
    assert.equal(transport.calls.length, 1);
    assert.equal(reply.disposed, 1);
  });
}

test("OpenAI abort does not yield another choice from the same SSE event", async () => {
  const reply = response('data: {"choices":[{"delta":{"content":"first"}},{"delta":{"content":"second"}}]}\n\ndata: [DONE]\n\n');
  const controller = new AbortController();
  const iterator = provider(fake(reply).transport).complete(request({ signal: controller.signal }))[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: "first", done: false });
  const reason = new Error("no second choice");
  controller.abort(reason);
  await assert.rejects(iterator.next(), error => error === reason);
  assert.equal(reply.disposed, 1);
});

test("OpenAI cancellation preserves reason if body iterator cleanup throws", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const reply = response("");
  reply.body = { [Symbol.asyncIterator]() { return {
    next() { started(); return new Promise<IteratorResult<Uint8Array>>(() => undefined); },
    return() { throw new Error("iterator cleanup failure"); },
  }; } };
  const output = collect(provider(fake(reply).transport).complete(request({ signal: controller.signal })));
  await reading;
  const reason = new Error("original abort");
  controller.abort(reason);
  await assert.rejects(output, error => error === reason);
  assert.equal(reply.disposed, 1);
});

test("OpenAI body failure preserves reason if body iterator cleanup rejects", async () => {
  const failure = new Error("original body failure");
  const reply = response("");
  reply.body = { [Symbol.asyncIterator]() { return {
    async next() { throw failure; },
    async return() { throw new Error("iterator cleanup failure"); },
  }; } };
  await assert.rejects(collect(provider(fake(reply).transport).complete(request())), error => error === failure);
  assert.equal(reply.disposed, 1);
});

test("OpenAI awaits disposal on success and reports disposal failure", async () => {
  const failure = new Error("dispose failed");
  const reply = response("data: [DONE]\n\n");
  reply.dispose = async () => { await Promise.resolve(); throw failure; };
  await assert.rejects(collect(provider(fake(reply).transport).complete(request())), error => error === failure);
});

test("OpenAI body transport stream failure disposes binary download", async () => {
  const failure = new Error("download interrupted");
  const reply = response("");
  reply.body = (async function* () { yield movie; throw failure; })();
  const iterator = provider(fake(response({ id: "vid", status: "completed" }), reply).transport).complete(request({ model: "custom-video" }))[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: movie, done: false });
  await assert.rejects(iterator.next(), error => error === failure);
  assert.equal(reply.disposed, 1);
});

test("OpenAI closes video download when downstream stops consuming", async () => {
  const reply = response(movie);
  const iterator = provider(fake(response({ id: "vid", status: "completed" }), reply).transport).complete(request({ model: "custom-video" }))[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: movie, done: false });
  await iterator.return?.();
  assert.equal(reply.disposed, 1);
});

test("OpenAI rejects malformed UTF-8 SSE and noncanonical base64 image responses", async () => {
  const reply = response(Uint8Array.of(100, 97, 116, 97, 58, 32, 255, 10, 10));
  await assert.rejects(collect(provider(fake(reply).transport).complete(request())));
  assert.equal(reply.disposed, 1);
  for (const b64_json of ["AB==", " YQ==", "YQ==\n", "YQ", 42]) {
    const image = response({ data: [{ b64_json }] });
    await assert.rejects(collect(provider(fake(image).transport).complete(request({ model: "custom-image" }))));
    assert.equal(image.disposed, 1);
  }
});

test("OpenAI video polling rejects a different job id and disposes both responses", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const created = response({ id: "expected", status: "queued" });
  const changed = response({ id: "unexpected", status: "completed" });
  const transport = fake(created, changed);
  const output = collect(provider(transport.transport).complete(request({ model: "custom-video" })));
  const rejected = assert.rejects(output, /invalid job id/);
  for (let turn = 0; turn < 100; turn++) { await Promise.resolve(); context.mock.timers.tick(10_000); }
  await rejected;
  assert.equal(transport.calls.length, 2);
  assert.equal(created.disposed, 1);
  assert.equal(changed.disposed, 1);
});

test("OpenAI abort interrupts already-pending iterator cleanup", async () => {
  const controller = new AbortController();
  let started!: () => void;
  let finish!: () => void;
  const closing = new Promise<void>(resolve => { started = resolve; });
  const closed = new Promise<void>(resolve => { finish = resolve; });
  const reply = response("");
  reply.body = { [Symbol.asyncIterator]() { return {
    async next() { return { value: encoder.encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n'), done: false }; },
    async return() { started(); await closed; return { done: true as const, value: undefined }; },
  }; } };
  const iterator = provider(fake(reply).transport).complete(request({ signal: controller.signal }))[Symbol.asyncIterator]();
  await iterator.next();
  const returned = iterator.return!();
  await closing;
  const reason = new Error("stop cleanup wait");
  controller.abort(reason);
  try {
    await assert.rejects(returned, error => error === reason);
    assert.equal(reply.disposed, 1);
  } finally { finish(); }
});

test("OpenAI SSE parser bounds unterminated event data before reading ahead", async () => {
  const reply = response("");
  let readAhead = false;
  reply.body = (async function* () {
    yield encoder.encode("data: " + "x".repeat(1024 * 1024));
    readAhead = true;
    yield encoder.encode("data: [DONE]\n\n");
  })();
  await assert.rejects(collect(provider(fake(reply).transport).complete(request())), /SSE event exceeds buffer limit/);
  assert.equal(readAhead, false);
  assert.equal(reply.disposed, 1);
});

test("OpenAI chat yields promptly without reading ahead or waiting for DONE", async () => {
  let reads = 0;
  const reply = response("");
  reply.body = (async function* () {
    reads++;
    yield encoder.encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
    reads++;
    yield encoder.encode('data: {"choices":[{"delta":{"content":"second"}}]}\n\n');
    reads++;
    yield encoder.encode("data: [DONE]\n\n");
  })();
  const iterator = provider(fake(reply).transport).complete(request())[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: "first", done: false });
  assert.equal(reads, 1);
  await iterator.return?.();
  assert.equal(reads, 1);
  assert.equal(reply.disposed, 1);
});

test("OpenAI releases abort listeners after success, failure and early consumer return", async () => {
  for (const mode of ["success", "failure", "early"] as const) {
    const controller = new AbortController();
    const reply = response(mode === "failure" ? "bad response" : 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    const output = provider(fake(reply).transport).complete(request({ signal: controller.signal }));
    if (mode === "failure") await assert.rejects(collect(output));
    else if (mode === "success") await collect(output);
    else { for await (const chunk of output) { assert.equal(chunk, "ok"); break; } }
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.equal(reply.disposed, 1);
  }
});

test("OpenAI preserves falsey cancellation reasons", async () => {
  for (const reason of [null, false, 0, ""]) {
    const reply = response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    const controller = new AbortController();
    const iterator = provider(fake(reply).transport).complete(request({ signal: controller.signal }))[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort(reason);
    await assert.rejects(iterator.next(), error => error === reason);
    assert.equal(reply.disposed, 1);
  }
});

test("OpenAI does not return an already-completed response body iterator", async () => {
  const reply = response("");
  let read = false, returns = 0;
  reply.body = { [Symbol.asyncIterator]() { return {
    async next() {
      if (read) return { done: true as const, value: undefined };
      read = true;
      return { done: false as const, value: encoder.encode('{"data":[{"b64_json":"iVBORw0KGgoA/w=="}]}') };
    },
    async return() { returns++; throw new Error("return after EOF"); },
  }; } };
  assert.deepEqual(await collect(provider(fake(reply).transport).complete(request({ model: "custom-image" }))), [picture]);
  assert.equal(returns, 0);
  assert.equal(reply.disposed, 1);
});

test("OpenAI cancellation during response disposal does not report successful completion", async () => {
  const controller = new AbortController();
  const reason = new Error("abort during cleanup");
  const reply = response("data: [DONE]\n\n");
  reply.dispose = async () => { reply.disposed++; controller.abort(reason); };
  await assert.rejects(collect(provider(fake(reply).transport).complete(request({ signal: controller.signal }))), error => error === reason);
  assert.equal(reply.disposed, 1);
});

test("OpenAI SSE reader applies the configured response budget independently of event limits", async () => {
  const source = bytes(encoder.encode("data: [DONE]\n\n"));
  await assert.rejects(collect(openAiChat(source, new AbortController().signal, 1024, 4)), /response byte limit/);
});
