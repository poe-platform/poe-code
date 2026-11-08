import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSplitCommand } from "./index.js";
import { parseArguments, settings } from "./options.js";
import { Budget, Cursor } from "./io.js";

test("split preserves large input chunks by default and honors explicit chunk limits", async () => {
 const bytes = new Uint8Array(65_537).fill(97);
 for (const maximum of [undefined, Infinity, 1024]) {
  const signal = new AbortController().signal;
  const context = {
   command: "split", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
   stdin: toByteSource(bytes), stdout: { async write() {} }, stderr: { async write() {} }, signal,
  };
  const limits = settings(maximum === undefined ? {} : { limits: { maxChunkBytes: maximum } });
  const cursor = new Cursor(context, "-", new Budget(limits, signal));
  try {
   assert.equal((await cursor.peek()).length, maximum === 1024 ? 1024 : bytes.length);
  } finally {
   await cursor.close();
  }
 }
});

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

test("split uses finite filesystem reads with unlimited default chunks", async () => {
 const fs = createMemoryFileSystem();
 const bytes = new Uint8Array(65_537).fill(97);
 await fs.writeFile("/input", bytes);
 const readStream = fs.readStream.bind(fs);
 const sizes: (number | undefined)[] = [];
 fs.readStream = (path, options) => {
  sizes.push(options?.chunkSize);
  return readStream(path, options);
 };
 const values = createCommandArguments(["-b", String(bytes.length), "/input", "/part"]);
 const result = await createSplitCommand().execute({
  command: "split", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
  stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0);
 assert.deepEqual(sizes, [64 * 1024]);
 assert.deepEqual(await fs.readFile("/partaa"), bytes);
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
