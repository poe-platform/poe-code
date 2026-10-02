import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createLlmCommand } from "./command.js";
import { llmReferenceVersion } from "./index.js";
import reference from "./fixtures/version-reference.json" with { type: "json" };

test("root version flags match the pinned CLI without acquiring input or invoking a provider", async () => {
  assert.equal(llmReferenceVersion, reference.reference.split("==")[1]);
  const command = createLlmCommand();
  for (const fixture of reference.cases) {
    let output = "";
    const sink = { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } };
    const result = await command.execute({ command: "llm", args: fixture.args, fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal, stdin: { [Symbol.asyncIterator]() { return assert.fail("version acquired stdin"); } }, stdout: sink, stderr: sink });
    assert.equal(result.exitCode, fixture.exitCode, JSON.stringify(fixture.args));
    assert.equal(output, fixture.output, JSON.stringify(fixture.args));
  }
});
