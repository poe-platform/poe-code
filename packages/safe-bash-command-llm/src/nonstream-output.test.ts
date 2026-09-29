import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";

test("explicit nonstream output withholds partial provider text on failure", async () => {
  const command = createLlmCommand({ defaultModel: "model", providers: [{ name: "fixture", models: [{ id: "model" }], async *complete() { yield "partial"; throw new Error("provider failed"); } }] });
  for (const noStream of [false, true]) {
    const chunks: Uint8Array[] = [];
    const result = await command.execute({ command: "llm", args: ["test", ...(noStream ? ["--no-stream"] : [])], fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write(chunk) { chunks.push(chunk.slice()); } }, stderr: { async write() {} } });
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.concat(chunks).toString(), noStream ? "" : "partial");
  }
});
