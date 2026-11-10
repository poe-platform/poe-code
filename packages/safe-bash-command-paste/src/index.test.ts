import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource, type ShellValue } from "safe-bash-contracts";
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

async function run(args: ShellValue[], files: Record<string, string>, env: Record<string, string> = {}, stdin = "") {
 const fs = createMemoryFileSystem();
 for (const [path, content] of Object.entries(files)) await fs.writeFile(path, new TextEncoder().encode(content));
 const values = createCommandArguments(args);
 let stdout = "", stderr = "", combined = "";
 const result = await createPasteCommand().execute({
  command: "paste", args: values.args, argumentValues: values, cwd: "/", env, fs,
  stdin: toByteSource(stdin), signal: new AbortController().signal,
  stdout: { async write(bytes) { const text = new TextDecoder().decode(bytes); stdout += text; combined += text; } },
  stderr: { async write(bytes) { const text = new TextDecoder().decode(bytes); stderr += text; combined += text; } },
 });
 return { ...result, stdout, stderr, combined };
}

for (const env of [{}, { POSIXLY_CORRECT: "1" }, { POSIXLY_CORRECT: "" }] as Record<string, string>[]) {
 for (const args of [["rows", "-s"], ["--", "rows", "-s"], ["-d", ":", "rows", "-s"], ["-", "-s"]]) {
  test(`paste operand ordering for ${JSON.stringify(args)} with ${JSON.stringify(env)}`, async () => {
   const result = await run(args, { "/rows": "A\nB\n", "/-s": "x\ny\n" }, env, "A\nB\n");
   const literal = env.POSIXLY_CORRECT !== undefined || args[0] === "--";
   const delimiter = args[0] === "-d" ? ":" : "\t";
   const expected = literal ? `A${delimiter}x\nB${delimiter}y\n` : `A${delimiter}B\n`;
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stderr, "");
   assert.equal(result.stdout, expected);
  });
 }
}

test("serial paste flushes the record terminator before a missing-file diagnostic", async () => {
 const result = await run(["-s", "/a", "/missing"], { "/a": "a\nb\nc\n" });
 assert.equal(result.exitCode, 1);
 assert.ok(result.combined.startsWith("a\tb\tc\npaste: "), result.combined);
});

for (const separator of ["\n", "\0"]) {
 const options = separator === "\0" ? ["-z"] : [];
 const rows = `x${separator}y${separator}`;
 for (const operands of [["/", "/missing"], ["/missing", "/"], ["/", "/", "/missing"]]) {
  test(`parallel paste suppresses directory diagnostics on fatal open failure ${JSON.stringify([...options, ...operands])}`, async () => {
   const result = await run([...options, ...operands], {});
   const missing = await run([...options, "/missing"], {});
   assert.equal(result.exitCode, 1);
   assert.equal(result.stdout, "");
   assert.equal(result.stderr, missing.stderr);
  });
  test(`serial paste retains directory diagnostics and records with a missing file ${JSON.stringify([...options, ...operands])}`, async () => {
   const result = await run([...options, "-s", ...operands], {});
   assert.equal(result.exitCode, 1);
   assert.equal(result.stdout, separator.repeat(operands.length - 1));
   assert.equal(result.stderr.split("EISDIR").length - 1, operands.length - 1);
   assert.equal(result.stderr.split("ENOENT").length - 1, 1);
  });
 }
 for (const directoryFirst of [true, false]) {
  const operands = directoryFirst ? ["/", "/rows"] : ["/rows", "/"];
  const expected = directoryFirst ? `\tx${separator}\ty${separator}` : `x\t${separator}y\t${separator}`;
  test(`parallel paste preserves columns for a directory ${directoryFirst ? "first" : "last"} with ${JSON.stringify(separator)} records`, async () => {
   const result = await run([...options, ...operands], { "/rows": rows });
   assert.equal(result.stdout, expected);
   assert.equal(result.exitCode, 1);
   assert.ok(result.stderr.includes("EISDIR"), result.stderr);
  });
  test(`serial paste preserves a directory record ${directoryFirst ? "first" : "last"} with ${JSON.stringify(separator)} records`, async () => {
   const operands = directoryFirst ? ["/", "-"] : ["-", "/"];
   const result = await run([...options, "-s", ...operands], {}, {}, rows);
   assert.equal(result.stdout, directoryFirst ? `${separator}x\ty${separator}` : `x\ty${separator}${separator}`);
   assert.equal(result.exitCode, 1);
   assert.ok(result.stderr.includes("EISDIR"), result.stderr);
  });
  test(`serial paste skips a missing operand ${directoryFirst ? "first" : "last"} with ${JSON.stringify(separator)} records`, async () => {
   const result = await run([...options, "-s", ...operands.map(file => file === "/" ? "/missing" : file)], { "/rows": rows });
   assert.equal(result.stdout, `x\ty${separator}`);
   assert.equal(result.exitCode, 1);
   assert.ok(result.stderr.includes("ENOENT"), result.stderr);
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
 test(`serial paste emits a record per directory with ${JSON.stringify(separator)} records`, async () => {
  const result = await run([...options, "-s", "/", "/"], {});
  assert.equal(result.stdout, separator.repeat(2));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.split("EISDIR").length - 1, 2);
 });
 test(`serial paste emits a record for empty files with ${JSON.stringify(separator)} records`, async () => {
  const result = await run([...options, "-s", "/empty", "/rows", "/empty"], { "/empty": "", "/rows": rows });
  assert.equal(result.stdout, `${separator}x\ty${separator}${separator}`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
 });
 for (const operands of [[], ["-"], ["-", "-"]]) {
  test(`serial paste emits a record per empty stdin operand ${JSON.stringify([...options, ...operands])}`, async () => {
   const result = await run([...options, "-s", ...operands], {});
   assert.equal(result.stdout, separator.repeat(operands.length || 1));
   assert.equal(result.exitCode, 0);
   assert.equal(result.stderr, "");
  });
  test(`parallel paste emits no records for empty stdin ${JSON.stringify([...options, ...operands])}`, async () => {
   const result = await run([...options, ...operands], {});
   assert.equal(result.stdout, "");
   assert.equal(result.exitCode, 0);
   assert.equal(result.stderr, "");
  });
 }
}

for (const args of [
 ["-d", "\\", "-d", ":"],
 ["-d\\", "-d:"],
 ["--delimiters", "\\", "--delimiters=:"],
 ["--d=\\", "-d", ":"],
 ["-d", "\\", "--d=:"],
 ["-d", ",", "-d", ":"],
 ["-d", "\\", "-d", ""],
 ["-d", "\\", "-d", "\\0"],
]) {
 for (const serial of [true, false]) {
  test(`paste uses only the final delimiter list ${JSON.stringify(args)} in ${serial ? "serial" : "parallel"} mode`, async () => {
   const result = await run(
    serial ? ["-s", ...args] : [...args, "-", "-"], {}, {}, "1\n2\n",
   );
   const joined = args.at(-1) === "" || args.at(-1) === "\\0" ? "12\n" : "1:2\n";
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stdout, joined);
   assert.equal(result.stderr, "");
  });
 }
}

for (const args of [
 ["-d", ":", "-d", "\\"],
 ["--d=:", "-d\\"],
 ["-d:", "--delimiters", "\\"],
 ["-d", ":", "--d=\\"],
]) {
 test(`paste validates the final delimiter list ${JSON.stringify(args)}`, async () => {
  const result = await run(["-s", ...args], {}, {}, "1\n2\n");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `paste: delimiter list ends with an unescaped backslash: ${"\\"}\n`);
 });
}

for (const option of ["-d", "--delimiters", "--d"]) {
 test(`paste still requires an argument for repeated ${option}`, async () => {
  const result = await run(["-s", "-d", "\\", option], {}, {}, "1\n2\n");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("requires an argument"), result.stderr);
 });
}

for (const serial of [false, true]) {
 for (const literal of [false, true]) {
  const options = [...(serial ? ["-s"] : []), ...(literal ? ["--"] : [])];
  test(`paste rejects raw invalid UTF-8 filenames in ${serial ? "serial" : "parallel"} mode, literal=${literal}`, async () => {
   const invalid = shellValueFromBytes(Uint8Array.of(255));
   const result = await run([...options, invalid], { "/�": "other-file\n" }, { LC_ALL: "C" });
   assert.equal(result.stdout, "");
   assert.equal(result.exitCode, 1);
   assert.ok(result.stderr.startsWith("paste: "), result.stderr);
  });
  test(`paste opens the actual replacement-character filename in ${serial ? "serial" : "parallel"} mode, literal=${literal}`, async () => {
   const name = shellValueFromBytes(Uint8Array.of(239, 191, 189));
   const result = await run([...options, name], { "/�": "other-file\n" });
   assert.equal(result.stdout, "other-file\n");
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stderr, "");
  });
 }
 for (const invalidFirst of [false, true]) {
  test(`paste handles a raw invalid filename ${invalidFirst ? "before" : "after"} a valid operand in ${serial ? "serial" : "parallel"} mode`, async () => {
   const invalid = shellValueFromBytes(Uint8Array.of(255));
   const operands = invalidFirst ? [invalid, "rows"] : ["rows", invalid];
   const result = await run([...(serial ? ["-s"] : []), ...operands], { "/�": "other-file\n", "/rows": "a\nb\n" });
   assert.equal(result.stdout, serial ? "a\tb\n" : "");
   assert.equal(result.exitCode, 1);
   assert.ok(result.stderr.startsWith("paste: "), result.stderr);
  });
 }
}

for (const [delimiter, quoted] of [
 ["a\\", "a\\"],
 [":\\", '":\\\\"'],
 ["a b\\", "a b\\"],
 ['a"\\', '"a\\"\\\\"'],
 ["\t\\", '"\\t\\\\"'],
 ["é\\", '"\\303\\251\\\\"'],
 [shellValueFromBytes(Uint8Array.of(255, 92)), '"\\377\\\\"'],
] as const) {
 for (const attached of typeof delimiter === "string" ? [false, true] : [false]) {
  test(`paste includes the offending delimiter list (${quoted}, attached=${attached})`, async () => {
   const args: ShellValue[] = attached && typeof delimiter === "string"
    ? [`--delimiters=${delimiter}`] : ["-d", delimiter];
   const result = await run([...args, "a", "b"], { "/a": "A\nB\nC", "/b": "1\n2\n" }, { LC_ALL: "C" }, "x\ny\nz\n");
   assert.equal(result.exitCode, 1);
   assert.equal(result.stdout, "");
   assert.equal(result.stderr, `paste: delimiter list ends with an unescaped backslash: ${quoted}\n`);
  });
 }
}

test("paste ignores an invalid delimiter list overridden by a valid list", async () => {
 const result = await run(["-d", "a\\", "-d", ":", "a", "b"], { "/a": "A\nB\nC", "/b": "1\n2\n" }, { LC_ALL: "C" }, "x\ny\nz\n");
 assert.equal(result.exitCode, 0);
 assert.equal(result.stdout, "A:1\nB:2\nC:\n");
 assert.equal(result.stderr, "");
});
