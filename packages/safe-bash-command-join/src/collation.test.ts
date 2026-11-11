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
 { LC_ALL: "en_US.utf8" },
 { LC_ALL: "en_US.UTF8" },
 { LC_ALL: "en_US.utf-8" },
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

test("join groups identical non-ASCII keys for the full Cartesian product", async () => {
 const result = await run(["--check-order", "/a", "/b"], { "/a": "é L1\né L2\n", "/b": "é R1\né R2\n" }, { LC_ALL: "en_US.UTF-8" });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(result.stdout.toString(), "é L1 R1\né L1 R2\né L2 R1\né L2 R2\n");
});

// Verified against GNU coreutils 9.4 with en_US.utf8.
for (const [first, second] of [["e\u0301", "é"], ["a", "a\u00ad"]] as const) {
 test(`join keeps Unicode collation ties distinct: ${JSON.stringify([first, second])}`, async () => {
  for (const mode of [[], ["--check-order"], ["--nocheck-order"]]) {
   for (const [left, right] of [[first, second], [second, first]]) {
    const files = { "/a": `${left} x\n`, "/b": `${right} y\n` };
    const result = await run([...mode, "/a", "/b"], files, { LC_ALL: "en_US.utf8" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, Buffer.alloc(0));
    assert.equal(result.stderr, "");

    const unpaired = await run([...mode, "-a1", "-a2", "/a", "/b"], files, { LC_ALL: "en_US.utf8" });
    assert.equal(unpaired.exitCode, 0, unpaired.stderr);
    assert.deepEqual(unpaired.stdout, Buffer.from(left === first ? `${left} x\n${right} y\n` : `${right} y\n${left} x\n`));
    assert.equal(unpaired.stderr, "");
   }
  }
 });

 test(`join separates adjacent duplicate groups across Unicode collation ties: ${JSON.stringify([first, second])}`, async () => {
  const result = await run(["--check-order", "/a", "/b"], {
   "/a": `${first} L1\n${first} L2\n${second} L3\n`,
   "/b": `${first} R1\n${second} R2\n${second} R3\n`,
  }, { LC_ALL: "en_US.utf8" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.from(`${first} L1 R1\n${first} L2 R1\n${second} L3 R2\n${second} L3 R3\n`));
  assert.equal(result.stderr, "");
 });

 test(`join checks order across Unicode collation ties: ${JSON.stringify([first, second])}`, async () => {
  for (const file of ["/a", "/b"]) {
   const result = await run(["--check-order", "/a", "/b"], {
    "/a": "", "/b": "", [file]: `${second} L\n${first} L\n`,
   }, { LC_ALL: "en_US.utf8" });
   assert.equal(result.exitCode, 1);
   assert.equal(result.stderr, `join: ${file}:2: is not sorted: ${first} L\n`);
  }
 });
}

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

for (const env of [
 { LC_ALL: "definitely_invalid" },
 { LC_ALL: "en_US.NO_SUCH_CODESET" },
 { LC_ALL: "en_US.utf8.NO_SUCH_CODESET" },
 { LC_ALL: "en_US." },
 { LANG: "en_US.NO_SUCH_CODESET" },
 { LC_ALL: "", LC_COLLATE: "en_US.NO_SUCH_CODESET", LC_CTYPE: "C.UTF-8" },
 { LC_COLLATE: "en_US.UTF-8", LC_CTYPE: "en_US.NO_SUCH_CODESET" },
 { LANG: "en_US.UTF-8", LC_MESSAGES: "en_US.NO_SUCH_CODESET" },
 { LC_ALL: "unknown_X.utf8" },
 { LANG: "unknown_X.utf8" },
 { LC_ALL: "", LC_COLLATE: "unknown_X.utf8", LC_CTYPE: "C.UTF-8" },
 { LC_COLLATE: "en_US.UTF-8", LC_CTYPE: "unknown_X.utf8" },
 { LANG: "unknown_X.utf8", LC_COLLATE: "C", LC_CTYPE: "C.UTF-8" },
 { LANG: "en_US.UTF-8", LC_MESSAGES: "unknown_X.utf8" },
]) {
 test(`join falls back to C when locale initialization fails: ${JSON.stringify(env)}`, async () => {
  const unpaired = await run(["-a1", "-a2", "/a", "/b"], { "/a": "a x\n", "/b": "B y\n" }, env);
  assert.equal(unpaired.exitCode, 0, unpaired.stderr);
  assert.equal(unpaired.stdout.toString(), "B y\na x\n");
  assert.equal(unpaired.stderr, "");

  const joined = await run(["/a", "/b"], { "/a": "a L\n", "/b": "a R\n" }, env);
  assert.equal(joined.exitCode, 0, joined.stderr);
  assert.equal(joined.stdout.toString(), "a L R\n");
  assert.equal(joined.stderr, "");

  const ordered = await run(["--check-order", "/a", "/b"], {
   "/a": "B L\na L\n", "/b": "B R\na R\n",
  }, env);
  assert.equal(ordered.exitCode, 0, ordered.stderr);
  assert.equal(ordered.stdout.toString(), "B L R\na L R\n");
  assert.equal(ordered.stderr, "");

  const blanks = await run(["/a", "/b"], { "/a": "a\u2003L\n", "/b": "a\u2003R\n" }, env);
  assert.equal(blanks.exitCode, 0, blanks.stderr);
  assert.equal(blanks.stdout.length, 0);
  assert.equal(blanks.stderr, "");

  for (const args of [["-t", "é"], ["-o", "1.1\u20032.2"]]) {
   const result = await run([...args, "/a", "/b"], { "/a": "a L\n", "/b": "a R\n" }, env);
   const cLocale = await run([...args, "/a", "/b"], { "/a": "a L\n", "/b": "a R\n" }, { LC_ALL: "C" });
   assert.equal(result.exitCode, 1);
   assert.deepEqual(result, cLocale);
  }
 });
}

test("join ignores unavailable locales overridden by LC_ALL", async () => {
 const result = await run(["/a", "/b"], { "/a": "a\u2003L\n", "/b": "a\u2003R\n" }, {
  LC_ALL: "C.UTF-8", LANG: "unknown_X.utf8", LC_COLLATE: "en_US.NO_SUCH_CODESET", LC_CTYPE: "unknown_X.utf8",
 });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(result.stdout.toString(), "a L R\n");
 assert.equal(result.stderr, "");
});
