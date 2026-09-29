import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";

test("private LLM command applies explicit byte limits without querying an oversized input", async () => {
  const { createLlmCommand } = await import("safe-bash-command-llm");
  let requests = 0;
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const command = createLlmCommand({ defaultModel: "echo", limits: { maxInputBytes: 2 }, providers: [{
    name: "fixture", models: [{ id: "echo" }], async *complete() { requests++; yield "answer"; },
  }] });
  const context: CommandContext = {
    command: "llm", args: [], fs: new MemoryFileSystem(), cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource("abc"),
    stdout: { async write(bytes) { output.push(bytes.slice()); } },
    stderr: { async write(bytes) { errors.push(bytes.slice()); } },
  };
  assert.equal((await command.execute(context)).exitCode, 1);
  assert.equal(requests, 0);
  assert.equal(output.length, 0);
  assert.match(Buffer.concat(errors).toString(), /input byte limit exceeded/);
});
