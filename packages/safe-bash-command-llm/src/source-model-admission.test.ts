import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import { createOpenAiProvider } from "./openai.js";
import { createLlmService } from "./service.js";

test("mixed OpenAI providers preserve CLI image generation alongside streamed chat", async () => {
  let calls = 0;
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const provider = createOpenAiProvider({ apiKey: "synthetic", models: [
    { id: "chat", endpoint: "chat" }, { id: "image", endpoint: "images", outputType: "image/png" },
  ], async transport(request) {
    calls++;
    assert.ok(request.url.endsWith("/images/generations"));
    return { status: 200, statusText: "OK", headers: [], async dispose() {}, body: toByteSource('{"data":[{"b64_json":"AQI="}]}') };
  } });
  const result = await createLlmCommand({ defaultModel: "image", providers: [provider] }).execute({ command: "llm", args: ["draw"], fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { output.push(bytes.slice()); } }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  assert.equal(calls, 1);
  assert.deepEqual([...Buffer.concat(output)], [1, 2]);
  assert.equal(provider.models[0]!.inputSources, true);
  assert.equal(provider.models[1]!.inputSources, false);
});

test("service declines model-specific source input before calling the provider and disposes the lease", async () => {
  let calls = 0, disposed = 0;
  const service = createLlmService({ defaultModel: "buffered", providers: [{ name: "mixed", models: [{ id: "buffered", inputSources: false }],
    complete() { throw new Error("not called"); }, completeSources() { calls++; throw new Error("must not call source provider"); },
  }] });
  await assert.rejects(async () => {
    for await (const event of service.streamSources!({ prompt: { bytes: toByteSource("hello"), async dispose() { disposed++; } }, attachments: [], options: {}, signal: new AbortController().signal })) void event;
  }, /does not support streamed inputs/);
  assert.equal(calls, 0);
  assert.equal(disposed, 1);
});
