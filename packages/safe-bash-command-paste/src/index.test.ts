import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

test("paste help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createPasteCommand().execute({
  command: "paste", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

async function run(args: string[], files: Record<string, string>) {
 const fs = createMemoryFileSystem();
 for (const [path, content] of Object.entries(files)) await fs.writeFile(path, new TextEncoder().encode(content));
 const values = createCommandArguments(args);
 let stdout = "", stderr = "", combined = "";
 const result = await createPasteCommand().execute({
  command: "paste", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
  stdin: toByteSource(""), signal: new AbortController().signal,
  stdout: { async write(bytes) { const text = new TextDecoder().decode(bytes); stdout += text; combined += text; } },
  stderr: { async write(bytes) { const text = new TextDecoder().decode(bytes); stderr += text; combined += text; } },
 });
 return { ...result, stdout, stderr, combined };
}

test("serial paste flushes the record terminator before a missing-file diagnostic", async () => {
 const result = await run(["-s", "/a", "/missing"], { "/a": "a\nb\nc\n" });
 assert.equal(result.exitCode, 1);
 assert.ok(result.combined.startsWith("a\tb\tc\npaste: "), result.combined);
});

for (const separator of ["\n", "\0"]) {
 const options = separator === "\0" ? ["-z"] : [];
 const rows = `x${separator}y${separator}`;
 for (const directoryFirst of [true, false]) {
  const operands = directoryFirst ? ["/", "/rows"] : ["/rows", "/"];
  const expected = directoryFirst ? `\tx${separator}\ty${separator}` : `x\t${separator}y\t${separator}`;
  test(`parallel paste preserves columns for a directory ${directoryFirst ? "first" : "last"} with ${JSON.stringify(separator)} records`, async () => {
   const result = await run([...options, ...operands], { "/rows": rows });
   assert.equal(result.stdout, expected);
   assert.equal(result.exitCode, 1);
   assert.ok(result.stderr.includes("EISDIR"), result.stderr);
  });
  test(`parallel paste still aborts for a missing operand ${directoryFirst ? "first" : "last"} with ${JSON.stringify(separator)} records`, async () => {
   const result = await run([...options, ...operands.map(file => file === "/" ? "/missing" : file)], { "/rows": rows });
   assert.equal(result.stdout, "");
   assert.equal(result.exitCode, 1);
   assert.ok(result.stderr.includes("ENOENT"), result.stderr);
  });
  test(`parallel paste pads an empty file ${directoryFirst ? "first" : "last"} with ${JSON.stringify(separator)} records`, async () => {
   const result = await run([...options, ...operands.map(file => file === "/" ? "/empty" : file)], { "/rows": rows, "/empty": "" });
   assert.equal(result.stdout, expected);
   assert.equal(result.exitCode, 0);
   assert.equal(result.stderr, "");
  });
 }
 test(`parallel paste emits no records for only directories with ${JSON.stringify(separator)} records`, async () => {
  const result = await run([...options, "/", "/"], {});
  assert.equal(result.stdout, "");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.split("EISDIR").length - 1, 2);
 });
 test(`serial paste still skips empty files with ${JSON.stringify(separator)} records`, async () => {
  const result = await run([...options, "-s", "/empty", "/rows", "/empty"], { "/empty": "", "/rows": rows });
  assert.equal(result.stdout, `x\ty${separator}`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
 });
}
