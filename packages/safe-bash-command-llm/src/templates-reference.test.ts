import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import reference from "./fixtures/templates-reference.json" with { type: "json" };

test("template CLI preserves explicit prompts and only acquires stdin for named input", async () => {
  for (const [prompt, expected, readsInput] of [
    ["Fixed", "Fixed\nworld\n", false],
    ["Fixed $$input", "Fixed $input\nworld\n", false],
    ["Fixed ${input}", "Fixed \nworld\n", false],
    ["Fixed $input", "Fixed world\n", true],
  ] as const) {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/settings/templates", { recursive: true });
    await fs.writeFile("/settings/templates/check.yaml", new TextEncoder().encode(`prompt: ${prompt}\nmodel: fixture-chat\n`));
    const command = createLlmCommand({ providers: [{ name: "fixture", models: [{ id: "fixture-chat" }], async *complete(request) { yield request.prompt; } }] });
    const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await command.execute({ command: "llm", args: ["world", "-t", "check"], fs, cwd: "/", env: { LLM_USER_PATH: "/settings" }, signal: new AbortController().signal,
      stdin: readsInput ? toByteSource("") : { [Symbol.asyncIterator]() { return assert.fail("fixed template must not acquire stdin"); } },
      stdout: { async write(chunk) { chunks.push(chunk.slice()); } }, stderr: { async write(chunk) { errors.push(chunk.slice()); } } });
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(chunks).toString(), expected);
  }
});

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

test("template validation and model admission precede stdin acquisition", async () => {
  for (const [prompt, expected] of [["$missing", "Error: Missing variables: missing\n"], ["$input", "Unknown model: missing\n"]]) {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/settings/templates", { recursive: true });
    await fs.writeFile("/settings/templates/check.yaml", new TextEncoder().encode(`prompt: ${prompt}\n`));
    const command = createLlmCommand({ defaultModel: "missing" });
    const errors: Uint8Array[] = [];
    const result = await command.execute({ command: "llm", args: ["-t", "check"], fs, cwd: "/", env: { LLM_USER_PATH: "/settings" }, signal: new AbortController().signal, stdin: { [Symbol.asyncIterator]() { return assert.fail("must not acquire stdin"); } }, stdout: { async write() { assert.fail("must not write output"); } }, stderr: { async write(chunk) { errors.push(chunk.slice()); } } });
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.concat(errors).toString(), expected);
  }
});
