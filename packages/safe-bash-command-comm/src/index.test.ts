import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource, type ShellValue } from "safe-bash-contracts";
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

async function run(args: ShellValue[], files: Record<string, string>) {
 const fs = createMemoryFileSystem();
 for (const [path, content] of Object.entries(files)) await fs.writeFile(path, new TextEncoder().encode(content));
 const values = createCommandArguments(args);
 let stdout = "", stderr = "", combined = "";
 const stdoutBytes: number[] = [];
 const result = await createCommCommand().execute({
  command: "comm", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
  stdin: toByteSource(""), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdoutBytes.push(...bytes); const text = new TextDecoder().decode(bytes); stdout += text; combined += text; } },
  stderr: { async write(bytes) { const text = new TextDecoder().decode(bytes); stderr += text; combined += text; } },
 });
 return { ...result, stdout, stdoutBytes, stderr, combined };
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

for (const reverse of [false, true]) {
 const args = reverse ? ["/b", "/a"] : ["/a", "/b"];
 const files = { "/a": "b\na\n", "/b": "b\na\nc\n" };
 for (const flags of [[], ["--total"], ["-12"], ["-123", "--total"], ["--nocheck-order"]]) {
  test(`comm allows paired disorder before EOF with ${JSON.stringify(flags)}, reversed ${reverse}`, async () => {
   const result = await run([...flags, ...args], files);
   const common = flags.includes("-123") ? "" : flags.includes("-12") ? "b\na\n" : "\t\tb\n\t\ta\n";
   const unpaired = flags.includes("-12") || flags.includes("-123") ? "" : reverse ? "c\n" : "\tc\n";
   const total = flags.includes("--total") ? `${reverse ? "1\t0" : "0\t1"}\t2\ttotal\n` : "";
   assert.equal(result.stdout, common + unpaired + total);
   assert.equal(result.stderr, "");
   assert.equal(result.exitCode, 0);
  });
 }

 test(`comm strictly checks paired disorder before EOF, reversed ${reverse}`, async () => {
  const result = await run(["--check-order", ...args], files);
  assert.equal(result.stdout, "\t\tb\n");
  assert.ok(result.stderr.includes("file 1 is not in sorted order"));
  assert.equal(result.exitCode, 1);
 });

 test(`comm still detects disorder after an unpaired row, reversed ${reverse}`, async () => {
  const result = await run(args, { "/a": "a\nd\nc\n", "/b": "a\nb\n" });
  assert.equal(result.stdout, reverse ? "\t\ta\nb\n\td\n\tc\n" : "\t\ta\n\tb\nd\nc\n");
  assert.equal(result.stderr, `comm: file ${reverse ? 2 : 1} is not in sorted order\ncomm: input is not in sorted order\n`);
  assert.equal(result.exitCode, 1);
 });
}

test("fully paired disorder remains allowed by default", async () => {
 const files = { "/a": "c\na\nb\n", "/b": "c\na\nb\n" };
 assert.equal((await run(["/a", "/b"], files)).exitCode, 0);
 assert.equal((await run(["--check-order", "/a", "/b"], files)).exitCode, 1);
});

for (const file of [1, 2]) {
 test(`comm --check-order stops at disorder in file ${file} with a plain diagnostic`, async () => {
  const files = { "/a": "b\nc\nz\n", "/b": "b\nc\nz\n" };
  files[file === 1 ? "/a" : "/b"] = "b\nc\na\nz\n";
  const result = await run(["--check-order", "/a", "/b"], files);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "\t\tb\n\t\tc\n");
  assert.equal(result.stderr, `comm: file ${file} is not in sorted order\n`);
  assert.equal(result.combined, result.stdout + result.stderr);
 });
}

test("comm --check-order reports only the first disordered operand", async () => {
 const result = await run(["--check-order", "/a", "/b"], { "/a": "b\na\n", "/b": "b\na\n" });
 assert.equal(result.exitCode, 1);
 assert.equal(result.stdout, "\t\tb\n");
 assert.equal(result.stderr, "comm: file 1 is not in sorted order\n");
});

test("comm default order checking keeps its warning and final summary", async () => {
 const result = await run(["/a", "/b"], { "/a": "a\nd\nc\n", "/b": "a\nb\n" });
 assert.equal(result.exitCode, 1);
 assert.equal(result.stdout, "\t\ta\n\tb\nd\nc\n");
 assert.equal(result.stderr, "comm: file 1 is not in sorted order\ncomm: input is not in sorted order\n");
});

test("comm flushes produced rows before order diagnostics and summary", async () => {
 const result = await run(["/a", "/b"], { "/a": "a\nb\nc\nb\ne\n", "/b": "b\nc\nd\ne\n" });
 assert.ok(result.combined.startsWith("a\n\t\tb\n\t\tc\ncomm: file 1 is not in sorted order\n"), result.combined);
 assert.ok(result.combined.endsWith("\t\te\ncomm: input is not in sorted order\n"), result.combined);
});

for (const attached of [false, true]) {
 for (const total of [false, true]) {
  for (const delimiter of [Uint8Array.of(0xff), Uint8Array.of(0xfe, 0xff), new TextEncoder().encode("é"), new Uint8Array()]) {
   test(`comm preserves delimiter bytes ${[...delimiter]} with attached=${attached}, total=${total}`, async () => {
    const option = attached
     ? [shellValueFromBytes(Uint8Array.from([...new TextEncoder().encode("--output-delimiter="), ...delimiter]))]
     : ["--output-delimiter", shellValueFromBytes(delimiter)];
    const result = await run([...option, ...option, ...(total ? ["--total"] : []), "/a", "/a"], { "/a": "x\n" });
    const separator = delimiter.length ? [...delimiter] : [0];
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, [
     ...separator, ...separator, 120, 10,
     ...(total ? [48, ...separator, 48, ...separator, 49, ...separator, ...new TextEncoder().encode("total\n")] : []),
    ]);
   });
  }
 }
}

for (const second of [Uint8Array.of(0xff), new TextEncoder().encode("�")]) {
 test(`comm rejects distinct delimiter bytes that decode identically: ${[...second]}`, async () => {
  const result = await run([
   "--output-delimiter", shellValueFromBytes(Uint8Array.of(0xfe)),
   shellValueFromBytes(Uint8Array.from([...new TextEncoder().encode("--output-delimiter="), ...second])),
   "/a", "/a",
  ], { "/a": "x\n" });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /multiple conflicting output delimiters/u);
  assert.deepEqual(result.stdoutBytes, []);
 });
}

test("comm requires an output delimiter argument", async () => {
 const result = await run(["/a", "/a", "--output-delimiter"], { "/a": "x\n" });
 assert.equal(result.exitCode, 1);
 assert.match(result.stderr, /requires an argument/u);
 assert.deepEqual(result.stdoutBytes, []);
});
