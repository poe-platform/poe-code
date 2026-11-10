import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type ShellValue } from "safe-bash-contracts";
import { createJoinCommand, type JoinCommandsOptions } from "./index.js";

async function run(args: ShellValue[], files: Record<string, string | Uint8Array>, env: Record<string, string> = { LC_ALL: "C.UTF-8" }, options: JoinCommandsOptions = {}) {
 const fs = createMemoryFileSystem();
 for (const [path, content] of Object.entries(files)) await fs.writeFile(path, typeof content === "string" ? new TextEncoder().encode(content) : content);
 const values = createCommandArguments(args);
 const stdout: number[] = [];
 let stderr = "";
 const result = await createJoinCommand(options).execute({
  command: "join", args: values.args, argumentValues: values, cwd: "/", env, fs,
  stdin: toByteSource(""), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdout.push(...bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
 });
 return { ...result, stdout: Buffer.from(stdout), stderr };
}


for (const env of [
 { LC_ALL: "en_US.UTF-8", LC_COLLATE: "C" },
 { LC_COLLATE: "en_US.UTF-8", LANG: "C" },
 { LC_ALL: "", LC_COLLATE: "", LANG: "en_US.UTF-8" },
]) {
 test(`join merges and checks locale keys: ${JSON.stringify(env)}`, async () => {
  for (const [first, last] of [["a", "B"], ["é", "z"]]) {
   for (const mode of [[], ["--check-order"], ["--nocheck-order"]]) {
    const result = await run([...mode, "/a", "/b"], { "/a": `${first} left\n${last} left\n`, "/b": `${last} right\n` }, env);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString(), `${last} left right\n`);
    assert.equal(result.stderr, "");
   }
  }
  for (const file of ["/a", "/b"]) {
   const result = await run(["--check-order", "/a", "/b"], { "/a": "", "/b": "", [file]: "z left\né left\n" }, env);
   assert.equal(result.exitCode, 1);
   assert.equal(result.stderr, `join: file ${file === "/a" ? 1 : 2} is not in sorted order\n`);
  }
 });
}

for (const env of [{}, { LC_CTYPE: "en_US.UTF-8" }, ...["C", "POSIX", "C.UTF-8", "C.utf8"].map(LC_ALL => ({ LC_ALL, LC_COLLATE: "en_US.UTF-8" }))]) {
 test(`join retains byte order: ${JSON.stringify(env)}`, async () => {
  const result = await run(["/a", "/b"], { "/a": "a left\nB left\n", "/b": "B right\n" }, env);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr, "join: file 1 is not in sorted order\njoin: input is not in sorted order\n");
 });
}

test("join groups collation-equivalent keys for the full Cartesian product", async () => {
 const result = await run(["--check-order", "/a", "/b"], { "/a": "é L1\né L2\n", "/b": "e\u0301 R1\ne\u0301 R2\n" }, { LC_ALL: "en_US.UTF-8" });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(result.stdout.toString(), "é L1 R1\né L1 R2\né L2 R1\né L2 R2\n");
});

test("join ignore-case retains folded byte comparison in language locales", async () => {
 const result = await run(["-i", "--check-order", "/a", "/b"], { "/a": "B left\nz left\n", "/b": "b right\nz right\n" }, { LC_ALL: "en_US.UTF-8" });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(result.stdout.toString(), "B left right\nz left right\n");
});
