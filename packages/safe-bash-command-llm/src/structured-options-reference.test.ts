import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAiProvider } from "./openai.js";
import reference from "./fixtures/openai-structured-options-reference.json" with {type:"json"};
import { openAiChatOptions } from "./openai-chat-options.js";
test("token IDs retain exact pinned integers beyond JavaScript numeric precision", () => {
 for (const [input, key, bias] of [
  ['{"9007199254740993":10}', "9007199254740993", 10],
  ['{"-9007199254740993":20}', "-9007199254740993", 20],
  ['{"+09_007_199_254_740_993":-100}', "9007199254740993", -100],
 ] as const) assert.deepEqual(openAiChatOptions({ logit_bias: input }), { logit_bias: { [key]: bias } });
});
test("token bias canonical collisions retain pinned Python dictionary insertion order", () => {
 for (const [input, expected] of [
  ['{"01":10,"1":20}', 20],
  ['{"1":20,"01":10}', 10],
  ['{"01":10,"1":20,"01":30}', 20],
  ['{"\\u0030\\u0031":10,"1":20}', 20],
 ] as const) assert.deepEqual(openAiChatOptions({ logit_bias: input }), { logit_bias: { "1": expected } });
});
test("OpenAI JSON mode and token bias match pinned provider request translation", async () => {
 const requests: Record<string, unknown>[] = [];
 const provider = createOpenAiProvider({ apiKey: "synthetic", models: [{ id: "gpt-4o", endpoint: "chat" }], transport: async request => {
  let body = ""; const decoder = new TextDecoder(); for await (const chunk of request.body!) body += decoder.decode(chunk, { stream: true });
  requests.push(JSON.parse(body + decoder.decode()));
  return { status: 200, statusText: "OK", headers: [], dispose: async () => {}, body: (async function* () { yield new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'); })() };
 }});
 for (const fixture of reference.cases) {
  const before = requests.length;
  const invoke = async () => { for await (const chunk of provider.complete({ model: "gpt-4o", prompt: "test JSON", attachments: [], options: { [fixture.option]: fixture.value }, signal: new AbortController().signal })) assert.equal(chunk, "ok"); };
  if (fixture.accepted) {
   await invoke(); assert.equal(requests.length, before + 1);
   const { model: ignoredModel, messages: ignoredMessages, stream: ignoredStream, ...options } = requests.at(-1)!;
   assert.deepEqual(options, fixture.kwargs, JSON.stringify(fixture));
  } else { await assert.rejects(invoke); assert.equal(requests.length, before); }
 }
});
