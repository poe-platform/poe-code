import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTsortCommand } from "./index.js";

for (const operand of [".", "empty"]) {
 test(`tsort distinguishes a directory from an empty file: ${operand}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  const values = createCommandArguments([operand]);
  let stdout = "";
  let stderr = "";
  const result = await createTsortCommand().execute({
   command: "tsort", args: values.args, argumentValues: values, cwd: "/", env: {},
   fs, stdin: toByteSource(""),
   stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, {
   exitCode: operand === "." ? 1 : 0,
   stdout: "",
   stderr: operand === "." ? "tsort: .: read error: Is a directory\n" : "",
  });
 });
}

test("tsort help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createTsortCommand().execute({
  command: "tsort", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});
