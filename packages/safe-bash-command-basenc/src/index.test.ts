import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createBasencCommand } from "./index.js";

test("basenc help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createBasencCommand().execute({
  command: "basenc", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

for (const encoding of ["base64url", "base16", "base32", "base32hex", "base2msbf", "base2lsbf", "z85"]) {
 test(`basenc ${encoding} counts ignored garbage against the input limit`, async () => {
  let stderr = "";
  const values = createCommandArguments([`--${encoding}`, "-di"]);
  const result = await createBasencCommand({ limits: { maxInputBytes: 2 } }).execute({
   command: "basenc", args: values.args, argumentValues: values, cwd: "/", env: {},
   fs: createMemoryFileSystem(), stdin: toByteSource("~~~"),
   stdout: { async write() { assert.fail("unexpected output"); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 1);
  assert.match(stderr, /input limit exceeded/u);
 });
}
