import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTacCommand } from "./index.js";

for (const [separator, input, expected] of [
 ["[[:alpha:]]", "ab", "ab"],
 ["[[:alpha:]]", "a]X", "Xa]"],
 ["[[:space:]]", "a\nb\n", "a\nb\n"],
 ["[[:space:]]", "s]X", "Xs]"],
 ["[ab]", "ab", "ba"],
 ["[[.a.]]", "a]X", "]Xa"],
 ["[[=a=]]", "a]X", "]Xa"],
 ["[[:unknown:]]", "n]X", "Xn]"],
]) {
 test(`tac Emacs separator ${separator} on ${JSON.stringify(input)}`, async () => {
  const values = createCommandArguments(["-r", "-s", separator!]);
  let output = "", errors = "";
  const result = await createTacCommand().execute({
   command: "tac", args: values.args, argumentValues: values, cwd: "/", env: {},
   fs: createMemoryFileSystem(), stdin: toByteSource(input!),
   stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0, errors);
  assert.equal(errors, "");
  assert.equal(output, expected);
 });
}

