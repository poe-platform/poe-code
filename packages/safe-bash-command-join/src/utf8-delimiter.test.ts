import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource, type ShellValue } from "safe-bash-contracts";
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

for (const delimiter of ["é", "界", "😀", "\ufeff"]) {
 test(`join splits and emits the complete UTF-8 delimiter ${JSON.stringify(delimiter)}`, async () => {
  const files = { "/a": `k${delimiter}A${delimiter}\n`, "/b": `k${delimiter}B\n` };
  for (const format of [[], ["-o", "auto"], ["-o", "0,1.2,1.3,2.2"]]) {
   const result = await run([`-t${delimiter}`, ...format, "/a", "/b"], files);
   assert.equal(result.exitCode, 0, result.stderr);
   assert.deepEqual(result.stdout, Buffer.from(`k${delimiter}A${delimiter}${delimiter}B\n`));
  }
 });
}

test("join uses LC_ALL, LC_CTYPE, then LANG for delimiter characters", async () => {
 const files = { "/a": "kéA\n", "/b": "kéB\n" };
 for (const env of [
  { LANG: "en_US.UTF-8" }, { LC_CTYPE: "C.utf8", LANG: "C" },
  { LC_ALL: "C.UTF-8", LC_CTYPE: "C" }, { LC_ALL: "", LC_CTYPE: "C.UTF-8" },
 ]) {
  const result = await run(["-t", "é", "/a", "/b"], files, env);
  assert.equal(result.exitCode, 0, JSON.stringify(env) + result.stderr);
  assert.deepEqual(result.stdout, Buffer.from("kéAéB\n"));
 }
 for (const env of [{}, { LC_ALL: "C", LANG: "C.UTF-8" }, { LC_CTYPE: "POSIX", LANG: "C.UTF-8" }, { LANG: "C" }]) {
  const result = await run(["-t", "é", "/a", "/b"], files, env);
  assert.equal(result.exitCode, 1, JSON.stringify(env));
  assert.equal(result.stdout.length, 0);
  assert.ok(result.stderr.includes("one byte"));
 }
});

test("join rejects multiple delimiter characters and conflicting multibyte delimiters", async () => {
 const files = { "/a": "kéA\n", "/b": "kéB\n" };
 for (const delimiter of ["ab", "éx", "éé", "e\u0301", shellValueFromBytes(Uint8Array.of(0xc3, 0xff))]) {
  const result = await run(["-t", delimiter, "/a", "/b"], files);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.length, 0);
 }
 const repeated = await run(["-té", "-té", "/a", "/b"], files);
 assert.equal(repeated.exitCode, 0, repeated.stderr);
 assert.deepEqual(repeated.stdout, Buffer.from("kéAéB\n"));
 const conflict = await run(["-té", "-tê", "/a", "/b"], files);
 assert.equal(conflict.exitCode, 1);
 assert.ok(conflict.stderr.includes("incompatible field delimiters"));
});

test("join matches full delimiters without splitting other UTF-8 characters or changing invalid bytes", async () => {
 const result = await run(["-té", "/a", "/b"], {
  "/a": Uint8Array.from([107, 195, 170, 195, 195, 169, 65, 10]),
  "/b": Uint8Array.from([107, 195, 170, 195, 195, 169, 66, 10]),
 });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.deepEqual(result.stdout, Buffer.from([107, 195, 170, 195, 195, 169, 65, 195, 169, 66, 10]));
});

test("join multibyte delimiters preserve headers, NUL records, replacement and unpaired rows", async () => {
 const result = await run(["-té", "-z", "--header", "-a1", "-a2", "-e", "M", "-o", "auto", "/a", "/b"], {
  "/a": "keyéleft\0aé\0béB\0", "/b": "keyéright\0aéA\0céC\0",
 });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.deepEqual(result.stdout, Buffer.from("keyéleftéright\0aéMéA\0béBéM\0céMéC\0"));
});

test("join counts all delimiter bytes against the output limit", async () => {
 for (const maxOutputBytes of [7, 8]) {
  const result = await run(["-té", "/a", "/b"], { "/a": "kéA\n", "/b": "kéB\n" },
   { LC_ALL: "C.UTF-8" }, { limits: { maxOutputBytes } });
  assert.equal(result.exitCode, maxOutputBytes === 8 ? 0 : 1, result.stderr);
  assert.deepEqual(result.stdout, Buffer.from(maxOutputBytes === 8 ? "kéAéB\n" : ""));
  if (maxOutputBytes === 7) assert.ok(result.stderr.includes("output limit exceeded"));
 }
});

for (const blank of ["\t", " ", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2008", "\u2009", "\u200a", "\u205f", "\u3000"]) {
 test(`join splits locale blanks ${JSON.stringify(blank)} without empty edge fields`, async () => {
  const result = await run(["/a", "/b"], { "/a": `${blank}a${blank}${blank}red${blank}\n`, "/b": `a${blank}blue\n` });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdout, Buffer.from("a red blue\n"));
 });
}

test("join keeps nonblank Unicode spaces and C locale bytes in fields", async () => {
 for (const blank of ["\u00a0", "\u2007", "\u202f", "\u2028", "\u2029", "\ufeff", "\v", "\f", "\r"]) {
  const result = await run(["/a", "/b"], { "/a": `a${blank}red\n`, "/b": `a${blank}blue\n` });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.alloc(0));
 }
 for (const env of [{}, { LC_ALL: "C", LANG: "C.UTF-8" }, { LC_CTYPE: "POSIX", LANG: "C.UTF-8" }]) {
  const result = await run(["/a", "/b"], { "/a": "a\u2003red\n", "/b": "a\u2003blue\n" }, env);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.alloc(0));
 }
});

test("join applies locale precedence to blanks and preserves explicit separators", async () => {
 for (const env of [{ LANG: "en_US.UTF-8" }, { LC_CTYPE: "C.utf8", LANG: "C" }, { LC_ALL: "C.UTF-8", LC_CTYPE: "C" }]) {
  const files = { "/a": "a\u2003red\n", "/b": "a\u2003blue\n" };
  assert.deepEqual((await run(["/a", "/b"], files, env)).stdout, Buffer.from("a red blue\n"));
  for (const delimiter of ["", " "]) assert.deepEqual((await run(["-t", delimiter, "/a", "/b"], files, env)).stdout, Buffer.alloc(0));
 }
});

test("join preserves invalid UTF-8 bytes around locale blanks and NUL records", async () => {
 const result = await run(["-z", "/a", "/b"], {
  "/a": Buffer.concat([Buffer.from([0xff]), Buffer.from("\u2003red\u3000\n\0")]),
  "/b": Buffer.concat([Buffer.from([0xff]), Buffer.from("\u3000blue\0")]),
 });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.deepEqual(result.stdout, Buffer.concat([Buffer.from([0xff]), Buffer.from(" red blue\0")]));
});
