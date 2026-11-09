import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

async function run(args: string[], files: Record<string, string>, stdin = "") {
 const fs = createMemoryFileSystem();
 for (const [path, content] of Object.entries(files)) await fs.writeFile(path, new TextEncoder().encode(content));
 const values = createCommandArguments(args);
 let stdout = "", stderr = "";
 const result = await createPasteCommand().execute({
  command: "paste", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
  stdin: toByteSource(stdin), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
 });
 return { ...result, stdout, stderr };
}

for (const option of ["serial", "delimiters", "zero-terminated"]) {
 for (let length = 1; length <= option.length; length++) {
  const prefix = `--${option.slice(0, length)}`;
  test(`paste accepts GNU option prefix ${prefix}`, async () => {
   const args = option === "serial" ? [prefix, "-"]
    : option === "delimiters" ? ["-s", prefix, ":", "-"] : ["-s", prefix, "-"];
   const input = option === "zero-terminated" ? "a\0b\0" : "a\nb\n";
   const expected = option === "serial" ? "a\tb\n"
    : option === "delimiters" ? "a:b\n" : "a\tb\0";
   const result = await run(args, {}, input);
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stdout, expected);
   assert.equal(result.stderr, "");
  });
  if (option === "delimiters") {
   for (const delimiter of [":", "", "="]) {
    test(`paste accepts attached delimiter ${JSON.stringify(delimiter)} with ${prefix}`, async () => {
     const result = await run(["-s", `${prefix}=${delimiter}`, "-"], {}, "a\nb\n");
     assert.equal(result.exitCode, 0, result.stderr);
     assert.equal(result.stdout, `a${delimiter}b\n`);
     assert.equal(result.stderr, "");
    });
   }
  }
 }
}

for (const option of ["--unknown", "--serially", "--delimiters-extra=:", "--zero-terminator", "--=:", "--s=", "--ser=yes", "--z=", "--zero-t=yes"]) {
 test(`paste rejects invalid option ${option}`, async () => {
  const result = await run([option], {}, "a\nb\n");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("unsupported option"), result.stderr);
 });
}

test("paste requires a delimiter value after an abbreviated option", async () => {
 const result = await run(["--delim"], {}, "a\nb\n");
 assert.equal(result.exitCode, 1);
 assert.equal(result.stdout, "");
 assert.ok(result.stderr.includes("requires an argument"), result.stderr);
});

test("paste treats option prefixes after -- as filenames", async () => {
 const result = await run(["-s", "--", "--ser"], { "/--ser": "a\nb\n" });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(result.stdout, "a\tb\n");
 assert.equal(result.stderr, "");
});
