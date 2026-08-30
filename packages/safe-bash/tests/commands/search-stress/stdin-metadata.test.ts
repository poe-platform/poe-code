import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { discovered, inputFileSystem, searchInput } from "./stdin-helpers.js";

const forbiddenInput: ByteSource = { [Symbol.asyncIterator]() { assert.fail("input selection acquired unrelated stdin"); } };
const filesystemResult = { code: 0, stdout: discovered, stderr: "" };
const emptyResult = { code: 1, stdout: "", stderr: "" };

for (const metadata of [true, undefined]) test(`direct ${metadata === true ? "default" : "legacy unknown"} metadata discovers cwd without acquiring stdin`, async () => {
  const input = metadata === undefined ? { stdin: forbiddenInput } : { stdin: forbiddenInput, stdinIsDefault: metadata };
  assert.deepEqual(await searchInput(await inputFileSystem(), input), filesystemResult);
});

test("legacy unknown metadata does not infer provenance from nonempty bytes", async () => {
  let acquired = false;
  const stdin = (async function* () { acquired = true; yield Buffer.from("needle from supplied input\n"); })();
  assert.deepEqual(await searchInput(await inputFileSystem(), { stdin }), filesystemResult);
  assert.equal(acquired, false);
});

for (const kind of ["empty string", "empty bytes", "empty iterator"]) test(`direct nondefault ${kind} never discovers cwd`, async () => {
  const fs = await inputFileSystem();
  fs.readdir = async () => { assert.fail("connected input triggered filesystem discovery"); };
  const stdin = kind === "empty string" ? toByteSource("") : kind === "empty bytes" ? toByteSource(new Uint8Array()) : (async function* () {})();
  assert.deepEqual(await searchInput(fs, { stdin, stdinIsDefault: false }), emptyResult);
});

test("exhausted nondefault input remains stdin", async () => {
  const stdin = (async function* () { yield Buffer.from("needle\n"); })();
  for await (const chunk of stdin) assert.equal(Buffer.from(chunk).toString(), "needle\n");
  assert.deepEqual(await searchInput(await inputFileSystem(), { stdin, stdinIsDefault: false }), emptyResult);
});

test("zero-length chunks before data are consumed once as nondefault stdin", async () => {
  let acquired = 0; let reads = 0;
  const chunks = [new Uint8Array(), new Uint8Array(), Buffer.from("needle\n")];
  const stdin: ByteSource = { [Symbol.asyncIterator]() {
    acquired++;
    return { async next() { const chunk = chunks[reads++]; return chunk ? { done: false as const, value: chunk } : { done: true as const, value: undefined }; } };
  } };
  assert.deepEqual(await searchInput(await inputFileSystem(), { stdin, stdinIsDefault: false }), { code: 0, stdout: "needle\n", stderr: "" });
  assert.equal(acquired, 1); assert.equal(reads, 4);
});

test("cwd override ignores connected stdin without acquisition", async () => {
  assert.deepEqual(await searchInput(await inputFileSystem(), { stdin: forbiddenInput, stdinIsDefault: false }, ["needle"], { defaultInput: "cwd" }), filesystemResult);
});

for (const metadata of [true, undefined]) test(`stdin override supersedes ${String(metadata)} metadata`, async () => {
  const input = metadata === undefined ? { stdin: toByteSource("") } : { stdin: toByteSource(""), stdinIsDefault: metadata };
  assert.deepEqual(await searchInput(await inputFileSystem(), input, ["needle"], { defaultInput: "stdin" }), emptyResult);
});

test("explicit file overrides connected stdin and configured input default", async () => {
  assert.deepEqual(await searchInput(await inputFileSystem(), { stdin: forbiddenInput, stdinIsDefault: false }, ["needle", "match.txt"], { defaultInput: "stdin" }), { code: 0, stdout: "needle\n", stderr: "" });
});

test("explicit dash overrides default metadata and cwd configuration", async () => {
  assert.deepEqual(await searchInput(await inputFileSystem(), { stdin: toByteSource("needle\n"), stdinIsDefault: true }, ["needle", "-"], { defaultInput: "cwd" }), { code: 0, stdout: "needle\n", stderr: "" });
});

test("files mode inventories cwd without acquiring connected stdin", async () => {
  assert.deepEqual(await searchInput(await inputFileSystem(), { stdin: forbiddenInput, stdinIsDefault: false }, ["--files"], { defaultInput: "stdin" }), { code: 0, stdout: "empty\nmatch.txt\n", stderr: "" });
});

for (const args of [["-e", "needle"], ["-f", ".patterns"]]) test(`pattern option ${args[0]} retains connected-empty stdin selection`, async () => {
  assert.deepEqual(await searchInput(await inputFileSystem(), { stdin: toByteSource(""), stdinIsDefault: false }, args), emptyResult);
});

for (const options of [{}, { defaultInput: "stdin" as const }]) test(`pattern stdin reserves input and searches cwd with ${options.defaultInput ?? "auto"} configuration`, async () => {
  assert.deepEqual(await searchInput(await inputFileSystem(), { stdin: toByteSource("needle\n"), stdinIsDefault: false }, ["-f", "-"], options), filesystemResult);
});

test("pattern stdin with explicit data file preserves literal operands", async () => {
  assert.deepEqual(await searchInput(await inputFileSystem(), { stdin: toByteSource("needle\n"), stdinIsDefault: false }, ["-f", "-", "match.txt"]), { code: 0, stdout: "needle\n", stderr: "" });
});

test("simultaneous pattern and data stdin is rejected before acquisition", async () => {
  const result = await searchInput(await inputFileSystem(), { stdin: forbiddenInput, stdinIsDefault: false }, ["-f", "-", "-"]);
  assert.equal(result.code, 2); assert.equal(result.stdout, "");
  assert.match(result.stderr, /cannot search stdin while also reading patterns from stdin/u);
});

test("files mode does not consume an unused pattern-stdin flag", async () => {
  assert.deepEqual(await searchInput(await inputFileSystem(), { stdin: forbiddenInput, stdinIsDefault: false }, ["--files", "-f", "-"]), { code: 0, stdout: "empty\nmatch.txt\n", stderr: "" });
});
