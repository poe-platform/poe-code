import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createApplyPatchCommand } from "./index.js";

test("apply-patch behavior works through the standalone portable factory", async () => {
 const values = createCommandArguments([]);
 let output = "";
 const result = await createApplyPatchCommand().execute({
  command: "apply-patch", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource("*** Begin Patch\n*** Add File: /hello.txt\n+hello\n*** End Patch\n"),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.equal(output, "Success. Updated the following files:\nA /hello.txt\n");
});
