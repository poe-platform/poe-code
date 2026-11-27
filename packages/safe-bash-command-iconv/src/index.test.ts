import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createIconvCommand } from "./index.js";

for (const [env, expected] of [
 [{ LC_ALL: "C.UTF-8" }, "cafe u\n"],
 [{ LC_ALL: "C.utf8" }, "cafe u\n"],
 [{ LC_CTYPE: "en_US.UTF-8", LANG: "C" }, "cafe u\n"],
 [{ LC_ALL: "C", LC_CTYPE: "C.UTF-8" }, "caf? ?\n"],
 [{ LC_ALL: "POSIX" }, "caf? ?\n"],
] as const) test(`iconv transliteration respects ${JSON.stringify(env)}`, async () => {
 const values = createCommandArguments(["-f", "utf-8", "-t", "ascii//TRANSLIT"]);
 let stdout = "", stderr = "";
 const result = await createIconvCommand().execute({
  command: "iconv", args: values.args, argumentValues: values, cwd: "/work", env,
  fs: createMemoryFileSystem(), stdin: toByteSource("café ü\n"),
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(stderr, "");
 assert.equal(stdout, expected);
 assert.equal(result.exitCode, 0);
});

test("iconv help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createIconvCommand().execute({
  command: "iconv", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

for (const length of [1, 8160, 40000]) {
 test(`iconv preserves discarded-input status with ${length} valid output bytes`, async () => {
  const values = createCommandArguments(["-f", "UTF-8", "-t", "ASCII", "-c"]);
  let output = "";
  const result = await createIconvCommand().execute({
   command: "iconv", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: createMemoryFileSystem(),
   stdin: toByteSource("é" + "a".repeat(length)),
   stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
   stderr: { async write() {} }, signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(output, "a".repeat(length));
 });
}
