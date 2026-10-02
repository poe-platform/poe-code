import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";

// llm==0.27.1, deterministic Model.execute + Click CliRunner, no color.
const expected = 'Token usage: 12,345 input, 0 output, {"cached": 2, "unicode": "\\u00e9"}\n';
for (const sources of [false, true]) for (const flag of ["-u", "--usage"]) {
  test(`usage matches the reference through ${sources ? "retained sources" : "buffered input"} with ${flag}`, async () => {
    for (const noStream of [false, true]) {
      const complete = async function* () { yield "hello"; return { usage: { input: 12345, output: 0, details: { cached: 2, unicode: "é" } } }; };
      const command = createLlmCommand({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture" }], complete, ...(sources ? { completeSources: complete } : {}) }] });
      let stdout = "", stderr = "";
      const result = await command.execute({ command: "llm", args: ["hello", flag, ...noStream ? ["--no-stream"] : []], fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal, stdin: toByteSource(new Uint8Array()), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stdout, "hello\n");
      assert.equal(stderr, expected);
    }
  });
}

test("usage is emitted only when requested and after successful completion", async () => {
  for (const requested of [false, true]) for (const fail of [false, true]) {
    const command = createLlmCommand({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture" }], async *complete() { yield "hello"; if (fail) throw new Error("provider failed"); } }] });
    let stderr = "";
    const result = await command.execute({ command: "llm", args: ["hello", ...requested ? ["--usage"] : []], fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal, stdin: toByteSource(new Uint8Array()), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
    assert.equal(result.exitCode, fail ? 1 : 0);
    assert.equal(stderr, fail ? "provider failed\n" : requested ? "Token usage: \n" : "");
  }
});

test("OpenAI usage reaches the CLI in JSON and SSE responses without losing native SDK fields", async () => {
  const { createOpenAiProvider } = await import("./openai.js");
  const { createLlmService } = await import("./service.js");
  for (const stream of [false, true]) {
    const usage = { prompt_tokens: 12345, completion_tokens: 0, total_tokens: 12345, prompt_tokens_details: { cached_tokens: 2, audio_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } };
    const provider = createOpenAiProvider({ apiKey: "synthetic-test-key", models: [{ id: "fixture", endpoint: "chat" }], transport: async request => { let body = ""; for await (const bytes of request.body!) body += new TextDecoder().decode(bytes); assert.deepEqual(JSON.parse(body).stream_options, stream ? { include_usage: true } : undefined); return ({ status: 200, statusText: "OK", headers: [], body: toByteSource(new TextEncoder().encode(stream ? `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n` : JSON.stringify({ choices: [{ message: { content: "hello" } }], usage }))), async dispose() {} }); } });
    const service = createLlmService({ providers: [provider], defaultModel: "fixture" });
    const events = [];
    for await (const event of service.stream({ model: "fixture", prompt: "hello", attachments: [], options: {}, signal: new AbortController().signal, stream })) events.push(event);
    const response = events.at(-1);
    assert.equal(response?.type, "response");
    if (response?.type === "response") {
      assert.equal(response.response.usage?.prompt_tokens, 12345);
      assert.equal(response.response.usage?.input, 12345);
      assert.deepEqual(response.response.usage?.details, { prompt_tokens_details: { cached_tokens: 2 } });
    }
    let stderr = "";
    const result = await createLlmCommand({ service }).execute({ command: "llm", args: ["hello", "--usage", ...stream ? [] : ["--no-stream"]], fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal, stdin: toByteSource(new Uint8Array()), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, 'Token usage: 12,345 input, 0 output, {"prompt_tokens_details": {"cached_tokens": 2}}\n');
  }
});

test("SDK usage serialization bounds chunks and stops on cancellation", async () => {
  const { serializeLlmTokenUsage } = await import("./usage.js");
  const controller = new AbortController();
  const usage = { details: { text: 'é: ",\\\u007f'.repeat(10000) } };
  const iterator = serializeLlmTokenUsage(usage, controller.signal)[Symbol.asyncIterator]();
  let bytes = 0;
  while (bytes < 8192) {
    const result = await iterator.next();
    assert.equal(result.done, false);
    assert.ok(result.value.byteLength <= 4101);
    bytes += result.value.byteLength;
  }
  controller.abort(new Error("cancel usage"));
  await assert.rejects(iterator.next(), /cancel usage/);
});
