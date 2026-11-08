import assert from "node:assert/strict";
import test from "node:test";
import { createLlmService } from "./service.js";
import { createOpenAiProvider } from "./openai.js";
import type { LlmRequest } from "./types.js";
import reference from "./fixtures/openai-numeric-reference.json" with { type: "json" };

test("declared numeric options match pinned reference admission and typed values before provider execution", () => {
  const requests: LlmRequest[] = [];
  const service = createLlmService({ defaultModel: "gpt-4o", providers: [{
    name: "fixture", models: [{ id: "gpt-4o", options: { temperature: { type: "number", minimum: 0, maximum: 2 }, seed: { type: "integer" } } }],
    complete(request) { requests.push(request); return (async function* () { yield "ok"; })(); },
  }] });
  for (const fixture of reference.cases) {
    const before = requests.length;
    const invoke = () => service.complete({ prompt: "test", attachments: [], options: { [fixture.option]: fixture.value }, signal: new AbortController().signal });
    if (fixture.accepted) {
      invoke();
      assert.equal(requests.length, before + 1);
      assert.deepEqual(requests.at(-1)?.options, { [fixture.option]: fixture.converted });
    } else {
      assert.throws(invoke, { message: `${fixture.option}\n  ${fixture.message}` });
      assert.equal(requests.length, before);
    }
  }
});

test("OpenAI numeric coercion matches pinned grammar at the serialized HTTP boundary without model declarations", async () => {
  const requests: Record<string, unknown>[] = [];
  const provider = createOpenAiProvider({ apiKey: "synthetic", models: [{ id: "gpt-4o", endpoint: "chat" }], transport: async request => {
    assert.ok(request.body);
    let body = "";
    const decoder = new TextDecoder();
    for await (const chunk of request.body) body += decoder.decode(chunk, { stream: true });
    requests.push(JSON.parse(body + decoder.decode()) as Record<string, unknown>);
    return { status: 200, statusText: "OK", headers: [], dispose: async () => {}, body: (async function* () {
      yield new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    })() };
  } });
  for (const fixture of reference.cases) {
    const before = requests.length;
    const invoke = async () => {
      for await (const chunk of provider.complete({ model: "gpt-4o", prompt: "test", attachments: [], options: { [fixture.option]: fixture.value }, signal: new AbortController().signal })) assert.equal(chunk, "ok");
    };
    if (fixture.accepted) {
      await invoke();
      assert.equal(requests.length, before + 1);
      // JSON serialization normalizes signed zero; the service fixture checks it exactly.
      assert.ok(requests.at(-1)?.[fixture.option] === fixture.converted, JSON.stringify(fixture));
    } else {
      await assert.rejects(invoke, /Invalid OpenAI option/);
      assert.equal(requests.length, before);
    }
  }
});
