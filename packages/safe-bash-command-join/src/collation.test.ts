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
   assert.equal(result.stderr, `join: ${file}:2: is not sorted: é left\n`);
  }
 });
}

for (const env of [{}, { LC_CTYPE: "en_US.UTF-8" }, ...["C", "POSIX", "C.UTF-8", "C.utf8", "C.UTF8", "C.utf-8"].map(LC_ALL => ({ LC_ALL, LC_COLLATE: "en_US.UTF-8" }))]) {
 test(`join retains byte order: ${JSON.stringify(env)}`, async () => {
  const result = await run(["/a", "/b"], { "/a": "a left\nB left\n", "/b": "B right\n" }, env);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr, "join: /a:2: is not sorted: B left\njoin: input is not in sorted order\n");
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

for (const locale of ["C.UTF8", "C.utf-8"]) {
 for (const env of [
  { LC_ALL: locale, LC_COLLATE: "en_US.UTF-8", LANG: "en_US.UTF-8" },
  { LC_ALL: "", LC_COLLATE: locale, LANG: "en_US.UTF-8" },
  { LC_ALL: "", LC_COLLATE: "", LANG: locale },
 ]) {
  test(`join accepts C UTF-8 aliases: ${JSON.stringify(env)}`, async () => {
   const result = await run(["--check-order", "/a", "/b"], {
    "/a": "B L1\nz L2\né L3\n", "/b": "B R1\nz R2\né R3\n",
   }, env);
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stdout.toString(), "B L1 R1\nz L2 R2\né L3 R3\n");
   assert.equal(result.stderr, "");
  });
 }
 test(`join preserves UTF-8 fields in ${locale}`, async () => {
  for (const delimiter of [" ", "\u2003", "é"]) {
   const result = await run([...(delimiter === "é" ? ["-t", delimiter] : []), "/a", "/b"], {
    "/a": `a${delimiter}L\n`, "/b": `a${delimiter}R\n`,
   }, { LC_ALL: locale });
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stdout.toString(), delimiter === "é" ? "aéLéR\n" : "a L R\n");
   assert.equal(result.stderr, "");
  }
 });
}
