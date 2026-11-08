import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource } from "safe-bash-contracts";
import { createOpenAiProvider } from "./openai.js";
import { createLlmService } from "./service.js";

for (const streamed of [false, true]) test(`attachment-only content omits an empty text part, source=${streamed}`, async () => {
  let body: {messages: unknown[]} | undefined;
  const provider = createOpenAiProvider({apiKey: "fixture", models: [{id: "fixture", endpoint: "chat", attachmentTypes: ["image/png"], attachmentUrls: true, capabilities: ["messages", "tools"]}], transport: async request => {
    let text = ""; for await (const bytes of request.body!) text += new TextDecoder().decode(bytes); body = JSON.parse(text);
    return {status: 200, statusText: "OK", headers: [], body: toByteSource('{"choices":[{"message":{"content":"done"}}]}'), async dispose() {}};
  }});
  const service = createLlmService({providers: [provider]});
  const input = {model: "fixture", prompt: "", attachments: [{mimeType: "image/png", url: "https://fixture/image.png"}],
    messages: [{role: "user" as const, content: "", attachments: [{mimeType: "image/png", url: "https://fixture/prior.png"}]}],
    options: {}, signal: new AbortController().signal, stream: false};
  const source = () => ({bytes: {async *[Symbol.asyncIterator]() {yield new Uint8Array(); yield new Uint8Array();}}, async dispose() {}});
  for await (const event of streamed ? service.streamSources!({...input, prompt: source(), messages: [{...input.messages[0]!, content: source()}]}) : service.stream(input)) assert.ok(event.type);
  assert.deepEqual(body?.messages, ["prior", "image"].map(name => ({role: "user", content: [{type: "image_url", image_url: {url: `https://fixture/${name}.png`}}]})));
});
