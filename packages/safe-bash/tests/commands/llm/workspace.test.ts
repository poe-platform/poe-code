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

test("LLM configuration persists through the shell's scoped overlay filesystem", async () => {
  const { Shell } = await import("../../../src/index.js");
  const { llmCommands } = await import("safe-bash-command-llm");
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LLM_USER_PATH: "/settings" } }).use(llmCommands({
    providers: [{ name: "fixture", models: [{ id: "echo" }], async *complete() { yield "unused"; } }],
  }));
  try {
    const alias = await shell.exec("llm aliases set tiny echo");
    assert.equal(alias.exitCode, 0, alias.stderr);
    const option = await shell.exec("llm models options set tiny temperature 0.5");
    assert.equal(option.exitCode, 0, option.stderr);
    assert.equal((await shell.exec("llm models options show tiny")).stdout, "temperature: 0.5\n");
    assert.equal((await shell.exec("llm aliases list --json")).stdout, '{\n    "tiny": "echo"\n}\n');
  } finally { await shell.dispose(); }
});
