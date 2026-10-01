import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createCommCommand } from "./index.js";

test("comm help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createCommCommand().execute({
  command: "comm", args: values.args, argumentValues: values, cwd: "/", env: {},
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
 const result = await createCommCommand().execute({
  command: "comm", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
  stdin: toByteSource(""), signal: new AbortController().signal,
  stdout: { async write(bytes) { const text = new TextDecoder().decode(bytes); stdout += text; combined += text; } },
  stderr: { async write(bytes) { const text = new TextDecoder().decode(bytes); stderr += text; combined += text; } },
 });
 return { ...result, stdout, stderr, combined };
}

for (const reverse of [false, true]) {
 test("comm detects disorder case 0 in either operand " + reverse, async () => {
  const files = { "/a": "b\nc\na\ne\n", "/b": "b\nc\nd\ne\n" };
  const args = reverse ? ["/b", "/a"] : ["/a", "/b"];
  const result = await run(args, files);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /not in sorted order/u);
  assert.equal((await run(["--nocheck-order", ...args], files)).exitCode, 0);
 });
}

test("fully paired disorder remains allowed by default", async () => {
 const files = { "/a": "c\na\nb\n", "/b": "c\na\nb\n" };
 assert.equal((await run(["/a", "/b"], files)).exitCode, 0);
 assert.equal((await run(["--check-order", "/a", "/b"], files)).exitCode, 1);
});

test("comm flushes produced rows before order diagnostics and summary", async () => {
 const result = await run(["/a", "/b"], { "/a": "a\nb\nc\nb\ne\n", "/b": "b\nc\nd\ne\n" });
 assert.ok(result.combined.startsWith("a\n\t\tb\n\t\tc\ncomm: file 1 is not in sorted order\n"), result.combined);
 assert.ok(result.combined.endsWith("\t\te\ncomm: input is not in sorted order\n"), result.combined);
});
