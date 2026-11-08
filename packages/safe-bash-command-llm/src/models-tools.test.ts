import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createLlmCommand } from "./command.js";
import fixtures from "./fixtures/models-tools-0.27.1.json" with { type: "json" };

for (const fixture of fixtures) test(`pinned tool model discovery: ${fixture.argv.join(" ")}`, async () => {
  const command = createLlmCommand({
    defaultModel: "fixture-plain",
    providers: [{
      name: "FixtureModel",
      models: [
        { id: "fixture-plain", aliases: ["plain"] },
        { id: "fixture-tools", aliases: ["tool"], capabilities: ["tools"] },
        { id: "fixture-both", aliases: ["both"], capabilities: ["tools", "schema"] }
      ],
      complete() { throw new Error("discovery cannot invoke model"); }
    }]
  });
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: "llm", args: fixture.argv, fs: new MemoryFileSystem(), cwd: "/", env: {},
    signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { throw new Error("discovery cannot read stdin"); } },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(result.exitCode, fixture.exitCode);
  assert.equal(stdout, fixture.stdout);
  assert.equal(stderr, fixture.stderr);
});
