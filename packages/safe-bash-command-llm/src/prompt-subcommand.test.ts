import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";

test("explicit prompt subcommand matches implicit prompt and preserves escaped literal text", async () => {
  const command = createLlmCommand({ defaultModel: "fixture-chat", providers: [{
    name: "fixture", models: [{ id: "fixture-chat", aliases: ["echo"] }],
    async *complete(request) { yield request.prompt; },
  }] });
  const cases: { args: string[]; expected: string }[] = [
    { args: ["hello", "-m", "echo", "--no-log"], expected: "hello\n" },
    { args: ["prompt", "hello", "-m", "echo", "--no-log"], expected: "hello\n" },
    { args: ["--", "prompt", "hello"], expected: "prompt hello\n" },
  ];
  for (const { args, expected } of cases) {
    const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await command.execute({
      command: "llm", args, fs: new MemoryFileSystem(), cwd: "/", env: {},
      signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
      stderr: { async write(chunk) { errors.push(chunk.slice()); } },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.concat(chunks).toString(), expected);
    assert.equal(Buffer.concat(errors).length, 0);
  }
});
