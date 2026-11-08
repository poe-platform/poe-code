import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import { createLlmService } from "./service.js";

test("CLI uses the caller's shared authorized service including model catalog and defaults", async () => {
  let calls = 0;
  const service = createLlmService({ defaultModel: "authorized", providers: [{ name: "fixture", models: [{ id: "authorized" }], async *complete(request) { calls++; yield request.prompt; } }] });
  const command = createLlmCommand({ service });
  const chunks: Uint8Array[] = [];
  const result = await command.execute({ command: "llm", args: ["hello"], fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write(chunk) { chunks.push(chunk.slice()); } }, stderr: { async write() {} } });
  assert.equal(result.exitCode, 0);
  assert.equal(calls, 1);
  assert.equal(Buffer.concat(chunks).toString(), "hello\n");
  assert.throws(() => createLlmCommand({ service, providers: [] }), /injected LLM service/);
  assert.throws(() => createLlmCommand({ service, defaultModel: "other" }), /injected LLM service/);
});
