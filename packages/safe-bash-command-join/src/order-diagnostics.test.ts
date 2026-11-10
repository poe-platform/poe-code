import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createJoinCommand } from "./index.js";

// GNU join with LC_ALL=C; capture bytes so records are not decoded or escaped.
async function run(args: string[], left: string | Uint8Array, right: string, stdin = "") {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/left", typeof left === "string" ? Buffer.from(left) : left);
 await fs.writeFile("/right", Buffer.from(right));
 const stdout: Buffer[] = [], stderr: Buffer[] = [], combined: Buffer[] = [];
 const result = await createJoinCommand().execute({
  command: "join", args, cwd: "/", env: { LC_ALL: "C" }, fs,
  stdin: toByteSource(stdin), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); combined.push(Buffer.from(bytes)); } },
  stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); combined.push(Buffer.from(bytes)); } },
 });
 return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), combined: Buffer.concat(combined) };
}

for (const [name, left, right, stdout, stderr] of [
 ["left input", "a\nb\na\n", "a\nb\n", "a\n", "join: left:3: is not sorted: a\n"],
 ["buffered output", "a\nb\nc\nb\n", "a\nb\nc\n", "a\nb\n", "join: left:4: is not sorted: b\n"],
 ["empty right record", "head L\n\na\n", "hdr R\n\na x\n", "", "join: right:2: is not sorted: \n"],
 ["sorted duplicate keys", "a L1\na L2\nc L3\n", "a R1\na R2\nb R3\n", "a L1 R1\na L1 R2\na L2 R1\na L2 R2\n", ""],
] as const) {
 test(`join order diagnostic: ${name}`, async () => {
  const result = await run(["--check-order", "left", "right"], left, right);
  assert.equal(result.exitCode, stderr ? 1 : 0);
  assert.deepEqual(result.stdout, Buffer.from(stdout));
  assert.deepEqual(result.stderr, Buffer.from(stderr));
  assert.deepEqual(result.combined, Buffer.from(stdout + stderr));
 });
}

test("join counts headers and preserves the input spelling and full offending record", async () => {
 const result = await run(["--header", "--check-order", "./left", "right"], "key L\nb B\na  A\n", "key R\nb R\n");
 assert.equal(result.exitCode, 1);
 assert.deepEqual(result.stdout, Buffer.from("key L R\n"));
 assert.deepEqual(result.stderr, Buffer.from("join: ./left:3: is not sorted: a  A\n"));
});

test("join reports standard input by its operand", async () => {
 const result = await run(["--check-order", "-", "right"], "", "b R\n", "b B\na A\n");
 assert.equal(result.exitCode, 1);
 assert.deepEqual(result.stderr, Buffer.from("join: -:2: is not sorted: a A\n"));
});

test("join NUL records use record numbers and newline-terminated diagnostics", async () => {
 const result = await run(["-z", "--check-order", "left", "right"], "b B\0a A\0", "b R\0");
 assert.equal(result.exitCode, 1);
 assert.deepEqual(result.stderr, Buffer.from("join: left:2: is not sorted: a A\n"));
});

for (const nul of [false, true]) {
 test(`join reports raw unterminated records, stopping at embedded NUL: ${nul}`, async () => {
  const result = await run(["--check-order", "left", "right"], Buffer.from([98, 32, 66, 10, 97, 32, 255, ...(nul ? [0] : []), 13]), "b R\n");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, Buffer.concat([Buffer.from("join: left:2: is not sorted: a "), Buffer.from(nul ? [255, 10] : [255, 13, 10])]));
 });
}

test("join default checking reports each input once and retains its final summary", async () => {
 const result = await run(["left", "right"], "a\nb\nd\nc\nb\n", "b\ne\nd\n");
 assert.equal(result.exitCode, 1);
 assert.deepEqual(result.stdout, Buffer.from("b\n"));
 assert.deepEqual(result.stderr, Buffer.from("join: left:4: is not sorted: c\njoin: right:3: is not sorted: d\njoin: input is not in sorted order\n"));
});

test("join --nocheck-order suppresses order diagnostics", async () => {
 const result = await run(["--nocheck-order", "left", "right"], "a\nb\na\n", "a\nb\n");
 assert.equal(result.exitCode, 0);
 assert.deepEqual(result.stdout, Buffer.from("a\nb\n"));
 assert.equal(result.stderr.length, 0);
});
