import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as core from "../../../src/core.js";
import * as entry from "../../../src/index.js";

test("llm is an explicit portable capability exposed at the root and command subpath", () => {
  const manifest = createRequire(import.meta.url)("../../../package.json") as { exports: Record<string, unknown> };
  for (const name of ["createLlmCommands", "llmCommands", "createOpenAiProvider", "createElevenLabsProvider"]) {
    assert.equal(typeof Reflect.get(core, name), "function", name);
  }
  assert.equal(core.createAgentCommands().some(command => command.name === "llm"), false);
  assert.deepEqual(Reflect.get(manifest.exports, "./commands/llm"), {
    types: "./dist/commands/llm/index.d.ts",
    workerd: "./dist/commands/llm/index.browser.js",
    browser: "./dist/commands/llm/index.browser.js",
    import: "./dist/commands/llm/index.js",
  });
});

test("public llm plugin connects independent text and binary providers through real shell pipelines", async () => {
  assert.equal(typeof entry.llmCommands, "function");
  const requests: string[] = [];
  const shell = new entry.Shell({ fs: new entry.MemoryFileSystem() }).use(entry.agentCommands()).use(entry.llmCommands({
    defaultModel: "words",
    providers: [
      { name: "text", models: [{ id: "words" }], async *complete(request) {
        requests.push(request.prompt);
        yield "answer";
      } },
      { name: "binary", models: [{ id: "audio", aliases: ["sound"], outputType: "audio/mpeg" }], async *complete() {
        yield new Uint8Array([0, 255, 13, 10]);
      } },
    ],
  }));
  try {
    const text = await shell.exec("printf input | llm instruction | cat");
    assert.equal(text.exitCode, 0, text.stderr);
    assert.equal(text.stdout, "answer\n");
    assert.equal(requests.length, 1);
    assert.ok(requests[0]!.includes("input"));
    assert.ok(requests[0]!.includes("instruction"));
    const binary = await shell.exec("llm -m sound prompt | cat");
    assert.equal(binary.exitCode, 0, binary.stderr);
    assert.deepEqual(binary.stdoutBytes, new Uint8Array([0, 255, 13, 10]));
    assert.ok(!entry.createAgentCommands().some(command => command.name === "llm"));
  } finally { await shell.dispose(); }
});
