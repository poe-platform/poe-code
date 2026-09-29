import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import reference from "./fixtures/templates-reference.json" with { type: "json" };

test("stored template workflows match the pinned deterministic reference", async () => {
  const fs = new MemoryFileSystem();
  const command = createLlmCommand({ providers: [{ name: "fixture", models: [{ id: "fixture-chat", aliases: ["echo"] }], async *complete(request) { yield request.prompt; } }] });
  for (const fixture of reference.cases) {
    const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await command.execute({ command: "llm", args: fixture.argv, fs, cwd: "/", env: { LLM_USER_PATH: "/settings" }, signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write(chunk) { chunks.push(chunk.slice()); } }, stderr: { async write(chunk) { errors.push(chunk.slice()); } } });
    const label = fixture.argv.join(" ");
    assert.equal(result.exitCode, fixture.exitCode, label);
    assert.equal(Buffer.concat(chunks).toString(), fixture.stdout.replaceAll("<USER_PATH>", "/settings"), label);
    assert.equal(Buffer.concat(errors).toString(), fixture.stderr, label);
    for (const [name, text] of Object.entries(fixture.files)) assert.equal(new TextDecoder().decode(await fs.readFile(`/settings/${name}`)), text, label);
  }
});
