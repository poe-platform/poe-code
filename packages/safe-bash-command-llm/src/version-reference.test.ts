import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createLlmCommand } from "./command.js";
import { llmReferenceVersion } from "./index.js";
import eagerReference from "./fixtures/root-eager-0.27.1.json" with { type: "json" };
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

for (const fixture of eagerReference) test(`pinned eager root options ${JSON.stringify(fixture.args)}`, async () => {
  let stdout = "", stderr = "";
  const result = await createLlmCommand().execute({
    command: "llm", args: fixture.args, fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { return assert.fail("root options acquired stdin"); } },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, fixture.exit_code);
  assert.equal(stdout, fixture.exit_code === 0 ? fixture.output : "");
  assert.equal(stderr, fixture.exit_code === 0 ? "" : fixture.output);
});

for (const args of [["-h", "--version"], ["--unknown", "--help"], ["-nh"], ["-mhello", "--version"], ["--help", "prompt"]]) {
  test(`eager help precedes version ${JSON.stringify(args)}`, async () => {
    const command = createLlmCommand();
    const outputs: string[] = [];
    for (const tokens of [["--help"], args]) {
      let output = "";
      const result = await command.execute({ command: "llm", args: tokens, fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: { [Symbol.asyncIterator]() { return assert.fail("help acquired stdin"); } },
        stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
        stderr: { async write() { assert.fail("help emitted diagnostic"); } },
      });
      assert.equal(result.exitCode, 0);
      outputs.push(output);
    }
    assert.equal(outputs[1], outputs[0]);
  });
}
