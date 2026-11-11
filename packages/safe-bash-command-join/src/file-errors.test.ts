import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { FsError, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createJoinCommand } from "./index.js";

async function run(args: string[], env: Record<string, string> = { LC_ALL: "C" }, code?: FsError["code"]) {
 const fs = createMemoryFileSystem();
 await fs.mkdir("/work");
 await fs.writeFile("/work/left", new TextEncoder().encode("a 1\n"));
 await fs.writeFile("/work/two words", new TextEncoder().encode("a 2\n"));
 await fs.symlink("loop", "/work/loop");
 if (code) fs.stat = async () => { throw new FsError(code, { syscall: "stat", path: "/private/backend/path" }); };
 let stdout = "", stderr = "";
 const context: CommandContext = {
  command: "join", args, cwd: "/work", env, fs,
  stdin: toByteSource(""), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
 };
 const result = await createJoinCommand().execute(context);
 return { ...result, stdout, stderr };
}

// GNU join in the C locale: quote only operands that need shell escaping.
for (const [file, displayed] of [
 ["missing", "missing"],
 ["./missing", "./missing"],
 ["missing file", "'missing file'"],
 ["", "''"],
 ["a:b", "'a:b'"],
 ["can't", '"can\'t"'],
 ["a\nb", "'a'$'\\n''b'"],
 ["a\tb", "'a'$'\\t''b'"],
 ["a\\b", "'a\\b'"],
 ["a{b}", "a{b}"],
 ["{", "'{'"],
 ["#file", "'#file'"],
 ["~file", "'~file'"],
 ["a]b", "a]b"],
 ["a^b", "'a^b'"],
 ["é", "''$'\\303\\251'"],
] as const) {
 for (const args of [[file, "left"], ["left", file]]) {
  test(`join quotes failed file operands: ${JSON.stringify(args)}`, async () => {
   assert.deepEqual(await run(args), {
    exitCode: 1, stdout: "", stderr: `join: ${displayed}: No such file or directory\n`,
   });
  });
 }
}

for (const [args, message] of [
 [["left", "left/abc"], "left/abc: Not a directory"],
 [["left/abc", "missing"], "left/abc: Not a directory"],
 [["left", "two words/abc"], "'two words/abc': Not a directory"],
 [["left", "loop"], "loop: Too many levels of symbolic links"],
 [[".", "missing file"], "'missing file': No such file or directory"],
 [[".", "left/abc"], "left/abc: Not a directory"],
 [["left", "."], "read error: Is a directory"],
 [[".", "left"], "read error: Is a directory"],
] as const) {
 test(`join reports native file error reasons: ${JSON.stringify(args)}`, async () => {
  assert.deepEqual(await run([...args]), { exitCode: 1, stdout: "", stderr: `join: ${message}\n` });
 });
}

for (const [code, reason] of [
 ["EACCES", "Permission denied"],
 ["EPERM", "Operation not permitted"],
 ["EIO", "Input/output error"],
 ["ENAMETOOLONG", "File name too long"],
] as const) {
 test(`join hides backend paths and operations for ${code}`, async () => {
  assert.deepEqual(await run(["two words", "left"], { LC_ALL: "C" }, code), {
   exitCode: 1, stdout: "", stderr: `join: 'two words': ${reason}\n`,
  });
 });
}

for (const [env, file, displayed] of [
 [{ LC_ALL: "C.UTF-8" }, "é", "é"],
 [{ LC_ALL: "C.UTF-8" }, "café menu", "'café menu'"],
 [{ LANG: "C.UTF-8" }, "é", "é"],
 [{ LANG: "C", LC_CTYPE: "C.UTF-8" }, "é", "é"],
 [{ LC_ALL: "C", LANG: "C.UTF-8" }, "é", "''$'\\303\\251'"],
 [{ LC_ALL: "C.UTF-8" }, "é\u009b", "'é'$'\\302\\233'"],
] as const) {
 test(`join uses filename character locale: ${JSON.stringify({ env, file })}`, async () => {
  assert.deepEqual(await run(["left", file], env), {
   exitCode: 1, stdout: "", stderr: `join: ${displayed}: No such file or directory\n`,
  });
 });
}

test("join opens filenames with spaces without changing the operand", async () => {
 assert.deepEqual(await run(["left", "two words"]), { exitCode: 0, stdout: "a 1 2\n", stderr: "" });
});
