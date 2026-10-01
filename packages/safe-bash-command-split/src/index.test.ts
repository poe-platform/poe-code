import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSplitCommand } from "./index.js";
import { parseArguments, settings } from "./options.js";

test("split help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createSplitCommand().execute({
  command: "split", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

for (const [option, start] of [["numeric", "99"], ["hex", "ff"]]) {
 test(`split matches GNU 9.12 fixed chunk suffix width with ${option} start`, () => {
  const parsed = parseArguments(["-n", "2", `--${option}-suffixes=${start}`], settings({}));
  assert.equal(parsed.suffixLength, 2);
  assert.equal(parseArguments(["-n", "2", "-a", "2", `--${option}-suffixes=${start}`], settings({})).suffixLength, 2);
 });
 test(`split matches GNU 9.12 empty ${option} start`, () => {
  assert.equal(parseArguments([`--${option}-suffixes=`], settings({})).numericStart, "0");
 });
}

test("split matches GNU 9.12 exhaustion at the numeric suffix boundary", async () => {
 const values = createCommandArguments(["-n", "2", "--numeric-suffixes=99", "-", "/out_"]);
 const fs = createMemoryFileSystem();
 let stderr = "";
 const result = await createSplitCommand().execute({
  command: "split", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs, stdin: toByteSource("abcd"),
  stdout: { async write() {} },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 1);
 assert.ok(stderr.includes("output file suffixes exhausted"));
 assert.equal(new TextDecoder().decode(await fs.readFile("/out_99")), "ab");
 await assert.rejects(fs.readFile("/out_100"));
});
