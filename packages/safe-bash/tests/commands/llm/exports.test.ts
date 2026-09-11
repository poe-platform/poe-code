import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as core from "../../../src/core.js";

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
