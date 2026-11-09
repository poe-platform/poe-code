import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

async function run(args: string[], files: Record<string, string>, env: Record<string, string> = {}, stdin = "") {
 const fs = createMemoryFileSystem();
 for (const [path, content] of Object.entries(files)) await fs.writeFile(path, new TextEncoder().encode(content));
 const values = createCommandArguments(args);
 let stdout = "", stderr = "";
 const result = await createPasteCommand().execute({
  command: "paste", args: values.args, argumentValues: values, cwd: "/", env, fs,
  stdin: toByteSource(stdin), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
 });
 return { ...result, stdout, stderr };
}

for (const option of ["--help", "--version"]) {
 for (const env of [{}, { POSIXLY_CORRECT: "1" }, { POSIXLY_CORRECT: "" }] as Record<string, string>[]) {
  const files = { "/rows": "A\nB\nC", [`/${option}`]: "DATA\n" };
  for (const operand of ["rows", "-"]) {
   for (const explicitEnd of [false, true]) {
    const args = [...(explicitEnd ? ["--"] : []), operand, option];
    test(`paste information operand ${JSON.stringify(args)} with ${JSON.stringify(env)}`, async () => {
     const result = await run(args, files, env, "A\nB\nC");
     assert.equal(result.exitCode, 0, result.stderr);
     assert.equal(result.stderr, "");
     if (explicitEnd || env.POSIXLY_CORRECT !== undefined) {
      assert.equal(result.stdout, "A\tDATA\nB\t\nC\t\n");
     } else {
      const information = await run([option], {}, env);
      assert.equal(result.stdout, information.stdout);
      assert.ok(result.stdout.startsWith(option === "--help" ? "Usage: paste " : "paste ("));
     }
    });
   }
  }
  test(`paste recognizes ${option} before operands with ${JSON.stringify(env)}`, async () => {
   const result = await run(["-d", ":", option, "rows"], files, env);
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stderr, "");
   assert.ok(result.stdout.startsWith(option === "--help" ? "Usage: paste " : "paste ("));
  });
 }
}
