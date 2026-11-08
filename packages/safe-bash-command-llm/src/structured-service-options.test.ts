import assert from "node:assert/strict";
import test from "node:test";
import { createLlmService } from "./service.js";
import { openAiChatOptions } from "./openai-chat-options.js";
import { validateModelOptions } from "./model-options.js";
import type { LlmModel, LlmOption, LlmRequest } from "./types.js";

test("shared completion accepts dictionary bias and array options without flattening", async () => {
  const requests: LlmRequest[] = [];
  const service = createLlmService({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture" }], async *complete(request) { requests.push(request); yield "ok"; } }] });
  const options = { logit_bias: { "42": "5", "99": -2.8 }, stop: ["end", "done"] };
  for await (const chunk of service.complete({ prompt: "hello", attachments: [], options, signal: new AbortController().signal })) assert.equal(chunk, "ok");
  assert.deepEqual(requests[0]?.options, options);
  assert.deepEqual(openAiChatOptions(requests[0]!.options), { logit_bias: { "42": 5, "99": -2 }, stop: ["end", "done"] });
});

test("structured descriptors accept native values and CLI JSON with shape validation", () => {
  const model = { id: "fixture", options: { bias: { type: "object" }, stop: { type: "array" } } } satisfies LlmModel;
  assert.deepEqual(validateModelOptions(model, { bias: '{"42":5}', stop: '["end"]' }), { bias: { "42": 5 }, stop: ["end"] });
  for (const values of [{ bias: '[]' }, { stop: '{}' }, { bias: 'null' }, { stop: 'bad JSON' }]) assert.throws(() => validateModelOptions(model, values));
});

test("invalid nested options fail before provider execution", () => {
  const service = createLlmService({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture" }], complete() { return assert.fail("invalid options reached provider"); } }] });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [{ nested: Infinity }, [NaN], cycle, new Date(0), { nested: undefined }, { nested: 1n }]) {
    assert.throws(() => service.complete({ prompt: "hello", attachments: [], options: { value: value as LlmOption }, signal: new AbortController().signal }), /Invalid model option/);
  }
});

test("dictionary logit bias retains provider validation", () => {
  for (const bias of [{ bad: 1 }, { "42": 101 }, { "42": [] }]) assert.throws(() => openAiChatOptions({ logit_bias: bias }), /Invalid OpenAI logit_bias/);
});

test("structured options cannot bypass scalar rules or finite-number admission", () => {
  const model = { id: "fixture", options: { enabled: { type: "boolean" }, bias: { type: "object" } } } satisfies LlmModel;
  assert.throws(() => validateModelOptions(model, { enabled: [true] }));
  assert.throws(() => validateModelOptions(model, { bias: '{"42":1e400}' }));
  assert.throws(() => openAiChatOptions({ json_object: [true] }));
});

test("source requests and embeddings carry structured options through declared models", async () => {
  const requests: Readonly<Record<string, LlmOption>>[] = [];
  const service = createLlmService({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture", capabilities: ["embed"], options: { values: { type: "array" } } }],
    complete() { return assert.fail("source input was materialized"); },
    async *completeSources(request) { requests.push(request.options); yield "ok"; },
    async embed(request) { requests.push(request.options); return { model: request.model, vectors: [[1]] }; },
  }] });
  let disposed = 0;
  const signal = new AbortController().signal;
  const options = { values: [1, { nested: true }] };
  for await (const event of service.streamSources!({ prompt: { bytes: (async function* () {})(), async dispose() { disposed++; } }, attachments: [], options, signal })) assert.ok(event);
  await service.embed({ inputs: ["hello"], options, signal });
  assert.equal(disposed, 1);
  assert.deepEqual(requests, [options, options]);
});

test("CLI options decode structured declarations before provider execution", async () => {
  const { createLlmCommand } = await import("./command.js");
  const { MemoryFileSystem } = await import("@poe-code/safe-fs/core");
  const { toByteSource } = await import("safe-bash-contracts");
  let received: LlmRequest | undefined;
  const command = createLlmCommand({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture", options: { logit_bias: { type: "object" }, stop: { type: "array" } } }], async *complete(request) { received = request; yield "ok"; } }] });
  const chunks: Uint8Array[] = [];
  const result = await command.execute({ command: "llm", args: ["hello", "-o", "logit_bias", '{"01":10,"1":20}', "-o", "stop", '["end"]'], fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write(chunk) { chunks.push(chunk); } }, stderr: { async write(chunk) { assert.fail(new TextDecoder().decode(chunk)); } } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(openAiChatOptions(received!.options), { logit_bias: { "1": 20 }, stop: ["end"] });
  assert.equal(Buffer.concat(chunks).toString(), "ok\n");
});


test("declared dictionary options retain reference collision ordering through the service", async () => {
  const service = createLlmService({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture", options: { logit_bias: { type: "object" } } }], async *complete(request) { yield JSON.stringify(openAiChatOptions(request.options)); } }] });
  for (const input of ['{"01":10,"1":20}', '{"1":20,"01":10}', '{"01":10,"1":20,"01":30}', '{"\\u0030\\u0031":10,"1":20}']) {
    let output = "";
    for await (const chunk of service.complete({ prompt: "hello", attachments: [], options: { logit_bias: input }, signal: new AbortController().signal })) output += chunk;
    assert.deepEqual(JSON.parse(output), openAiChatOptions({ logit_bias: input }), input);
  }
});


test("declared dictionaries retain key order for JSON serialization and nested values", () => {
  const model = { id: "fixture", options: { value: { type: "object" } } } satisfies LlmModel;
  const input = '{"01":{"nested":["a,b",{"1":true}]},"1":20,"__proto__":3}';
  const { value } = validateModelOptions(model, { value: input });
  assert.equal(JSON.stringify(value), input);
  assert.deepEqual(Object.keys(value as object), ["01", "1", "__proto__"]);
});
