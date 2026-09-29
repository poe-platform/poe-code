import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import reference from "./fixtures/configuration-reference.json" with { type: "json" };

test("persisted CLI workflow matches llm 0.27.1 deterministic configuration characterization", async () => {
  assert.equal(reference.version, "0.27.1");
  const fs = new MemoryFileSystem();
  const command = createLlmCommand({ defaultModel: "fixture-chat", providers: [{
    name: "fixture", models: [{ id: "fixture-chat", aliases: ["echo"] }], async *complete(request) {
      const options = { ...request.options };
      if (Object.hasOwn(options, "temperature")) options.temperature = Number(options.temperature);
      const encoded = Object.entries(options).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(", ");
      yield `{"model": ${JSON.stringify(request.model)}, "options": {${encoded}}, "prompt": ${JSON.stringify(request.prompt)}}`;
    },
  }] });
  for (const fixture of reference.cases) {
    const output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const context: CommandContext = {
      command: "llm", args: fixture.argv, fs, cwd: "/", env: { LLM_USER_PATH: "/settings" },
      signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { output.push(bytes.slice()); } },
      stderr: { async write(bytes) { errors.push(bytes.slice()); } },
    };
    const result = await command.execute(context);
    const label = fixture.argv.join(" ");
    assert.equal(result.exitCode, fixture.exitCode, label);
    assert.equal(Buffer.concat(output).toString(), fixture.stdout.replaceAll("<USER_PATH>", "/settings"), label);
    assert.equal(Buffer.concat(errors).toString(), fixture.stderr, label);
    for (const [name, text] of Object.entries(fixture.files)) {
      assert.equal(new TextDecoder().decode(await fs.readFile(`/settings/${name}`)), text, `${label}: ${name}`);
    }
  }
});
