import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import { createLlmTemplateStore } from "./templates.js";

test("template attachment records normalize reference-compatible extra fields", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/settings/templates", { recursive: true });
  await fs.writeFile("/settings/templates/extra.yaml", new TextEncoder().encode('attachment_types:\n  - type: text/plain\n    value: /note.txt\n    description: ignored\n'));
  const context = { command: "llm", args: [], fs, cwd: "/", env: { LLM_USER_PATH: "/settings" }, signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  assert.deepEqual(await createLlmTemplateStore(context).load("extra"), { name: "extra", attachment_types: [{ type: "text/plain", value: "/note.txt" }] });
});

test("templates persist attachment paths and types and merge them in reference request order", async () => {
  const fs = new MemoryFileSystem();
  for (const [path, content] of [["/a.txt", "a"], ["/b.bin", "b"], ["/c.txt", "c"], ["/d.bin", "d"]]) await fs.writeFile(path!, new TextEncoder().encode(content));
  let calls = 0;
  const command = createLlmCommand({ providers: [{ name: "fixture", models: [{ id: "fixture", attachmentTypes: ["text/plain", "image/png"] }], async *complete(request) {
    calls++;
    assert.equal(request.prompt, "Explain\nmore");
    assert.deepEqual(request.attachments.map(({ mimeType, bytes }) => [mimeType, new TextDecoder().decode(bytes)]), [["text/plain", "a"], ["text/plain", "c"], ["image/png", "b"], ["image/png", "d"]]);
    yield "ok";
  } }] });
  const errors: Uint8Array[] = [];
  const context = { command: "llm", args: [] as string[], fs, cwd: "/", env: { LLM_USER_PATH: "/settings" }, signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write(chunk: Uint8Array) { errors.push(chunk.slice()); } } };
  context.args = ["Explain", "-m", "fixture", "-a", "/a.txt", "--at", "/b.bin", "image/png", "--save", "images"];
  assert.equal((await command.execute(context)).exitCode, 0, Buffer.concat(errors).toString());
  assert.equal(calls, 0);
  assert.deepEqual(await createLlmTemplateStore(context).load("images"), { name: "images", model: "fixture", prompt: "Explain", attachments: ["/a.txt"], attachment_types: [{ type: "image/png", value: "/b.bin" }] });
  context.args = ["more", "-t", "images", "-a", "/c.txt", "--at", "/d.bin", "image/png"];
  assert.equal((await command.execute(context)).exitCode, 0, Buffer.concat(errors).toString());
  assert.equal(calls, 1);
});
