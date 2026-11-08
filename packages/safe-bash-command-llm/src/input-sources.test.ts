import assert from "node:assert/strict";
import test from "node:test";
import { createLlmService } from "./service.js";
import type { LlmProvider } from "./types.js";

test("streamed input admission rejects unsupported providers before reading and releases ownership", async () => {
  let reads = 0, closed = 0, calls = 0;
  const source = { bytes: { async *[Symbol.asyncIterator]() { reads++; yield new Uint8Array([97]); } }, async dispose() { closed++; } };
  const service = createLlmService({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture" }], async *complete() { calls++; yield "unexpected"; } }] });
  await assert.rejects(async () => {
    for await (const event of service.streamSources!({ prompt: source, attachments: [], options: {}, signal: new AbortController().signal })) void event;
  }, /does not support streamed inputs/);
  assert.deepEqual({ reads, closed, calls }, { reads: 0, closed: 1, calls: 0 });
});

test("streamed input cancellation closes input ownership independently of a stalled provider", async () => {
  let closed = 0;
  const controller = new AbortController();
  const reason = new Error("cancel input");
  const source = { bytes: { async *[Symbol.asyncIterator]() { yield new Uint8Array([97]); } }, async dispose() { closed++; } };
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  const provider = {
    name: "fixture", models: [{ id: "fixture" }], complete() { throw new Error("buffered path must not run"); },
    completeSources() {
      return { [Symbol.asyncIterator]() { return { next() { started(); return new Promise<IteratorResult<string>>(() => undefined); }, async return() { return { done: true as const, value: undefined }; } }; } };
    },
  } satisfies LlmProvider;
  const service = createLlmService({ defaultModel: "fixture", providers: [provider] });
  const iterator = service.streamSources!({ prompt: source, attachments: [], options: {}, signal: controller.signal })[Symbol.asyncIterator]();
  const next = iterator.next();
  const rejected = assert.rejects(next, error => error === reason);
  await admitted;
  controller.abort(reason);
  await rejected;
  assert.equal(closed, 1);
});

 test("invalid streamed output limits reject before provider admission and dispose shared input once", async () => {
  let closed = 0, calls = 0;
  const source = { bytes: { async *[Symbol.asyncIterator]() { yield new Uint8Array([97]); } }, async dispose() { closed++; } };
  const service = createLlmService({defaultModel:"fixture",providers:[{
    name:"fixture",models:[{id:"fixture",attachmentTypes:["image/png"]}],complete(){throw new Error("buffered path must not run");},
    completeSources(){calls++;return {async *[Symbol.asyncIterator](){yield "answer";}};},
  }]});
  await assert.rejects(async () => {
    for await (const event of service.streamSources!({prompt:source,attachments:[{mimeType:"image/png",source}],options:{},signal:new AbortController().signal,maxOutputBytes:-1})) void event;
  }, /Invalid LLM output limit/);
  assert.deepEqual({closed,calls},{closed:1,calls:0});
 });

test("OpenAI consumes streamed UTF-8 prompts and binary attachments through the shared service", async () => {
  const { createOpenAiProvider } = await import("./openai.js");
  let sent: unknown, closed = 0;
  const source = (text: string) => ({ bytes: {async *[Symbol.asyncIterator]() { const bytes=new TextEncoder().encode(text); for(const byte of bytes) yield new Uint8Array([byte]); }}, async dispose(){closed++;} });
  const service=createLlmService({defaultModel:"fixture",providers:[createOpenAiProvider({apiKey:"fixture-key",models:[{id:"fixture",endpoint:"chat",attachmentTypes:["image/png"],capabilities:["messages","schema"]}],async transport(request){
    const chunks:Uint8Array[]=[];
    for await(const chunk of request.body!) {assert.ok(chunk.byteLength<=16384);chunks.push(chunk);}
    sent=JSON.parse(Buffer.concat(chunks).toString());
    return {status:200,statusText:"OK",headers:[],body:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n');}},async dispose(){}};
  }})]});
  const events=[];
  for await(const event of service.streamSources!({prompt:source('new\n🐈'),system:source('system\n🙂'),messages:[{role:"assistant",content:source('prior "reply"')}],attachments:[{mimeType:"image/png",source:source("abcde")}],options:{temperature:"0.2"},schema:{type:"object"},signal:new AbortController().signal})) events.push(event);
  assert.deepEqual(sent,{temperature:0.2,response_format:{type:"json_schema",json_schema:{name:"response",schema:{type:"object"}}},model:"fixture",messages:[{role:"system",content:'system\n🙂'},{role:"assistant",content:'prior "reply"'},{role:"user",content:[{type:"text",text:'new\n🐈'},{type:"image_url",image_url:{url:"data:image/png;base64,YWJjZGU="}}]}],stream:true,stream_options:{include_usage:true}});
  assert.equal(events[0]?.type,"text");
  assert.equal(closed,4);
});


test("cancellation interrupts stalled provider retirement after early source return", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel retirement");
  let disposed = 0;
  let retiring!: () => void;
  const retirementStarted = new Promise<void>(resolve => { retiring = resolve; });
  const source = { bytes: { async *[Symbol.asyncIterator]() { yield Uint8Array.of(97); } }, async dispose() { disposed++; } };
  const service = createLlmService({ defaultModel: "fixture", providers: [{
    name: "fixture", models: [{ id: "fixture" }], complete() { throw new Error("buffered path must not run"); },
    completeSources() { return { [Symbol.asyncIterator]() { return {
      async next() { return { done: false as const, value: "answer" }; },
      return() { retiring(); return new Promise<IteratorResult<string>>(() => undefined); },
    }; } }; },
  }] });
  const iterator = service.streamSources!({ prompt: source, attachments: [], options: {}, signal: controller.signal })[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { done: false, value: { type: "text", text: "answer" } });
  const retirement = iterator.return!();
  await retirementStarted;
  const rejected = assert.rejects(retirement, error => error === reason);
  controller.abort(reason);
  await rejected;
  assert.equal(disposed, 1);
});
