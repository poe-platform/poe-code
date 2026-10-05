import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createLlmService } from "./service.js";
import { streamLlmToolChain } from "./tool-chain.js";
import fixtures from "./fixtures/tool-chain-0.27.1.json" with { type: "json" };
import type { LlmToolChainOptions } from "./tool-chain.js";
import type { LlmStreamEvent } from "./service.js";
import { toByteSource } from "safe-bash-contracts";

const call = {name: "lookup", arguments: {}, id: "id"};
function options(overrides: Partial<LlmToolChainOptions> = {}): LlmToolChainOptions {
  return {
    context: {fs: new MemoryFileSystem(), cwd: "/", signal: new AbortController().signal},
    tools: [{name: "lookup", inputSchema: {}, implementation: () => ({output: "done"})}],
    async *openResponse() { yield {type: "response", response: {model: "fixture", toolCalls: [call]}}; },
    async visit(result) { for await (const bytes of result.output.bytes) assert.ok(bytes.length); },
    ...overrides
  };
}
async function drain(input: LlmToolChainOptions): Promise<void> {
  for await (const event of streamLlmToolChain(input)) assert.ok(event.type);
}

for (const fixture of fixtures) test(`pinned serial chain limit ${fixture.limit}`, async () => {
  const events: string[] = [];
  let text = "", error: string | null = null, requests = 0;
  const service = createLlmService({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture", capabilities: ["tools"] }],
    async *complete() { yield "step"; return requests === 1 ? { toolCalls: [{name: "lookup", arguments: {}, id: "id"}] } : {}; }
  }] });
  const tools = [{name: "lookup", inputSchema: {}, implementation: () => ({output: "done"})}];
  try {
    for await (const event of streamLlmToolChain({
      context: {fs: new MemoryFileSystem(), cwd: "/", signal: new AbortController().signal},
      tools, chainLimit: fixture.limit,
      openResponse(index, signal) { assert.equal(index, requests++); return service.stream({prompt: "host owns continuation", tools, attachments: [], options: {}, signal}); },
      beforeCall() { events.push("before"); },
      async visit(result) { for await (const bytes of result.output.bytes) assert.equal(new TextDecoder().decode(bytes), "done"); events.push("after"); }
    })) if (event.type === "text") text += event.text;
  } catch (caught) { error = (caught as Error).message; }
  assert.deepEqual({text, events, error}, {text: fixture.text, events: fixture.events, error: fixture.error});
});

test("default SDK chain limit is ten and prevents the tenth tool invocation", async () => {
  let opened = 0, executed = 0;
  await assert.rejects(drain(options({
    async *openResponse(index) { assert.equal(index, opened++); yield {type: "response", response: {model: "fixture", toolCalls: [call]}}; },
    beforeCall() { executed++; }
  })), {message: "Chain limit of 10 exceeded."});
  assert.equal(opened, 10);
  assert.equal(executed, 9);
});

test("results and attachment bytes share one quota across response rounds", async () => {
  let opened = 0, disposed = 0;
  await assert.rejects(drain(options({
    maxToolOutputBytes: 7,
    tools: [{name: "lookup", inputSchema: {}, implementation: () => ({
      output: "out", attachments: [{mimeType: "image/png", source: {bytes: toByteSource("ab"), async dispose() {disposed++;}}}]
    })}],
    async *openResponse() { opened++; yield {type: "response", response: {model: "fixture", toolCalls: [call]}}; },
    async visit(result) {
      for await (const bytes of result.output.bytes) assert.ok(bytes.length);
      for (const attachment of result.attachments) if (attachment.source)
        for await (const bytes of attachment.source.bytes) assert.ok(bytes.length);
    }
  })), {message: "Tool output byte limit exceeded"});
  assert.equal(opened, 2);
  assert.equal(disposed, 2);
});

test("response data and call controls share one quota across rounds", async () => {
  let opened = 0;
  // Compact JSON control encoding is 44 bytes for this fixture.
  await assert.rejects(drain(options({
    maxOutputBytes: 90,
    async *openResponse() {
      opened++; yield {type: "text", text: "round"};
      yield {type: "response", response: {model: "fixture", toolCalls: [call]}};
    }
  })), {message: "LLM chain output byte limit exceeded"});
  assert.equal(opened, 2);
});

test("bounded Unicode/binary output preserves values and owns byte chunks", async () => {
  const text = "a😀界".repeat(20000), bytes = new Uint8Array(65537).fill(42);
  let actual = "", size = 0;
  for await (const event of streamLlmToolChain(options({
    async *openResponse() { yield {type: "text", text}; yield {type: "bytes", data: bytes}; yield {type: "response", response: {model: "fixture"}}; }
  }))) {
    if (event.type === "text") { assert.ok(new TextEncoder().encode(event.text).length <= 16384); actual += event.text; }
    if (event.type === "bytes") { assert.ok(event.data.length <= 16384); size += event.data.length; event.data.fill(0); }
  }
  assert.equal(actual, text);
  assert.equal(size, bytes.length);
  assert.ok(bytes.every(byte => byte === 42));
});

test("early consumer exit aborts the response without running its tools", async () => {
  let returned = false, signal: AbortSignal | undefined;
  for await (const event of streamLlmToolChain(options({
    async *openResponse(_index, active) {
      signal = active;
      try { yield {type: "response", response: {model: "fixture", toolCalls: [call]}}; }
      finally { returned = true; }
    },
    beforeCall() { assert.fail("must not execute after exit"); }
  }))) { assert.equal(event.type, "response"); break; }
  await Promise.resolve();
  assert.ok(signal?.aborted);
  assert.ok(returned);
});

test("pending response cancellation retires source leases without waiting on provider", async () => {
  const abort = new AbortController();
  let released = 0, started!: () => void;
  const ready = new Promise<void>(resolve => {started = resolve;});
  const service = createLlmService({defaultModel: "fixture", providers: [{name: "fixture", models: [{id: "fixture"}],
    complete() { assert.fail("source path required"); },
    completeSources() { return {[Symbol.asyncIterator]() {return {
      next() { started(); return new Promise<IteratorResult<string>>(() => {}); },
      async return() { return {done: true as const, value: undefined}; }
    };}}; }
  }]});
  const running = drain(options({
    context: {fs: new MemoryFileSystem(), cwd: "/", signal: abort.signal},
    openResponse(_index, signal) { return service.streamSources!({prompt: {bytes: toByteSource("hello"), async dispose() {released++;}}, attachments: [], options: {}, signal}); }
  }));
  await ready;
  abort.abort(new Error("cancel pending response"));
  await assert.rejects(running, {message: "cancel pending response"});
  assert.equal(released, 1);
});

test("host stages results before constructing the next source request", async () => {
  let resultText = "", closed = 0, requests = 0;
  const service = createLlmService({defaultModel: "fixture", providers: [{name: "fixture", models: [{id: "fixture", capabilities: ["tools", "messages"]}],
    complete() { assert.fail("source path required"); },
    async *completeSources(request) {
      requests++;
      let prompt = "";
      for await (const bytes of request.prompt.bytes) prompt += new TextDecoder().decode(bytes);
      if (requests === 1) { assert.equal(prompt, "hello"); return {toolCalls: [call]}; }
      assert.equal(prompt, "");
      assert.equal(request.messages?.[0]?.role, "tool");
      assert.equal(request.messages?.[0]?.toolCallId, "id");
      for await (const bytes of request.messages![0]!.content.bytes) assert.equal(new TextDecoder().decode(bytes), "done");
      yield "finished";
    }
  }]});
  const source = (text: string) => ({bytes: toByteSource(text), async dispose() {closed++;}});
  await drain(options({
    openResponse(index, signal) {
      return service.streamSources!({prompt: source(index ? "" : "hello"), attachments: [], options: {}, signal,
        ...(index ? {messages: [{role: "tool", toolCallId: "id", content: source(resultText)}]} : {})});
    },
    async visit(result) { for await (const bytes of result.output.bytes) resultText += new TextDecoder().decode(bytes); }
  }));
  assert.equal(requests, 2);
  assert.equal(closed, 3);
});

test("visitor failure stops the chain and releases the borrowed tool result", async () => {
  let released = 0, opened = 0;
  await assert.rejects(drain(options({
    tools: [{name: "lookup", inputSchema: {}, implementation: () => ({source: {bytes: toByteSource("result"), async dispose() {released++;}}})}],
    async *openResponse() { opened++; yield {type: "response", response: {model: "fixture", toolCalls: [call]}}; },
    visit() { throw new Error("host staging failed"); }
  })), {message: "host staging failed"});
  assert.equal(opened, 1);
  assert.equal(released, 1);
});

test("malformed event order fails before any tool or continuation", async () => {
  for (const events of [[], [{type: "response", response: {model: "fixture", toolCalls: [call]}}, {type: "text", text: "late"}]] as LlmStreamEvent[][])
    await assert.rejects(drain(options({
      async *openResponse(index) { assert.equal(index, 0); yield* events; },
      beforeCall() {assert.fail("malformed response must not run tools");}
    })), /LLM (stream ended|response event)/);
});

test("invalid limits fail before opening a response", async () => {
  for (const limits of [{chainLimit: Infinity}, {chainLimit: 1.5}, {maxToolOutputBytes: -1}, {maxOutputBytes: NaN}])
    await assert.rejects(drain(options({...limits, openResponse() {assert.fail("must validate before dispatch");}})), RangeError);
});

test("empty response events yield cooperatively for cancellation", async () => {
  const controller = new AbortController(); let pulled = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(drain(options({
      context: {fs: new MemoryFileSystem(), cwd: "/", signal: controller.signal},
      async *openResponse() {
        timer = setTimeout(() => controller.abort(new Error("cancel empty stream")), 0);
        for (; pulled < 4096; pulled++) yield {type: "text", text: ""};
        yield {type: "response", response: {model: "fixture"}};
      }
    })), {message: "cancel empty stream"});
    assert.ok(pulled < 4096);
  } finally {clearTimeout(timer);}
});
