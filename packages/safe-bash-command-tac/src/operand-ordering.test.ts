import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTacCommand } from "./index.js";

for (const env of [{}, { POSIXLY_CORRECT: "1" }, { POSIXLY_CORRECT: "" }] as Record<string, string>[]) {
 for (const args of [["f", "-b"], ["--", "f", "-b"], ["-s", ":", "f", "-b"], ["-", "-b"]]) {
  test(`tac operand ordering for ${JSON.stringify(args)} with ${JSON.stringify(env)}`, async () => {
   const fs = createMemoryFileSystem();
   await fs.writeFile("/f", new TextEncoder().encode("Xé:Z"));
   await fs.writeFile("/-b", new TextEncoder().encode("T\nU\n"));
   const values = createCommandArguments(args);
   let stdout = "", stderr = "";
   const result = await createTacCommand().execute({
    command: "tac", args: values.args, argumentValues: values, cwd: "/", env, fs,
    stdin: toByteSource("Xé:Z"), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   });
   const literal = env.POSIXLY_CORRECT !== undefined || args[0] === "--";
   const expected = args[0] === "-s"
    ? (literal ? "ZXé:T\nU\n" : ":ZXé")
    : (literal ? "Xé:ZU\nT\n" : "Xé:Z");
   assert.equal(result.exitCode, 0, stderr);
   assert.equal(stderr, "");
   assert.equal(stdout, expected);
  });
 }
}

