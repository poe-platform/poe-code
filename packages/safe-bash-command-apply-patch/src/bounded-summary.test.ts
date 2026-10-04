import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createApplyPatchCommand } from "./index.js";

for (const mode of ["success", "quota", "sink"] as const) test(`large success summaries remain staged and bounded: ${mode}`, async t => {
  const fs = createMemoryFileSystem();
  const names = Array.from({ length: 180 }, (_, index) => `${"é".repeat(100)}${index}`);
  const expected = "Success. Updated the following files:\n" + names.map(name => `A ${name}\n`).join("");
  const expectedBytes = new TextEncoder().encode(expected);
  const encode = TextEncoder.prototype.encode;
  t.mock.method(TextEncoder.prototype, "encode", function(this: TextEncoder, text = "") {
    assert.ok(text.length <= 16384, "output must not encode the whole summary at once");
    return encode.call(this, text);
  });
  let output = "", diagnostic = "", written = 0;
  const decoder = new TextDecoder();
  const failure = new Error("sink failed");
  const result = Promise.resolve(createApplyPatchCommand(mode === "quota" ? { limits: { maxOutputBytes: expectedBytes.length - 1 } } : {}).execute({
    command: "apply_patch", args: [], cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {
      const encoder = new TextEncoder();
      yield encoder.encode("*** Begin Patch\n");
      for (const name of names) yield encoder.encode(`*** Add File: ${name}\n+created\n`);
      yield encoder.encode("*** End Patch\n");
    } },
    stdout: { async write(bytes) {
      assert.ok(bytes.length <= 16384);
      if (mode === "sink" && ++written === 2) throw failure;
      await Promise.resolve();
      // Streaming decode preserves code points split at spool page boundaries.
      output += decoder.decode(bytes, { stream: true });
    } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
  }));
  if (mode === "sink") await assert.rejects(result, error => error === failure);
  else assert.equal((await result).exitCode, mode === "quota" ? 1 : 0, diagnostic);
  output += decoder.decode();
  if (mode === "success") assert.equal(output, expected);
  if (mode === "quota") { assert.equal(output, ""); assert.notEqual(diagnostic, ""); }
  assert.equal((await fs.readdir("/")).length, mode === "quota" ? 0 : names.length);
  if (mode !== "quota") for (const name of names) assert.equal(new TextDecoder().decode(await fs.readFile(`/${name}`)), "created\n");
});
