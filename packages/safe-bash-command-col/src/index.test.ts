import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type ByteSource } from "safe-bash-contracts";
import { createColCommand, type ColCommandsOptions } from "./index.js";

async function run(args: string[], input: string | ByteSource, options: ColCommandsOptions = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createColCommand(options).execute({
    command: "col", args, cwd: "/", env: { LC_ALL: "C.UTF-8" }, fs: createMemoryFileSystem(),
    stdin: typeof input === "string" ? toByteSource(input) : input,
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, signal: new AbortController().signal,
  });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

for (const [args, input, expected] of [
  [["-b"], "ab\bc\n", "ac\n"],
  [["-bx"], "ab\bc\tZ\n", "ac      Z\n"],
  [[], "ab\bc\n", "ab\bc\n"],
  [["-b"], "abc\rX\n", "Xbc\n"],
  [["-b"], "a\nb\vc\n", "ac\nb\n"],
  [["-b"], "        x   \n", "\tx\n"],
  [["-b"], "plain", "plain\n"],
  [["-b"], "\n\n", "\n\n"],
  [["-b"], "", ""],
  [["-b"], "aé\bZ\n", "aZ\n"],
  [["-bx"], "界\tZ\n", "界      Z\n"],
  [["--no-backspaces", "--spaces"], "a\ta\bX\n", "a       X\n"],
  [["-x", "-h"], "a\tZ\n", "a\tZ\n"],
  [["-p"], "a\x01b\n", "a\x01b\n"],
] as const) test(`col ${JSON.stringify(args)} ${JSON.stringify(input)}`, async () => {
  assert.deepEqual(await run([...args], input), { exitCode: 0, stdout: expected, stderr: "" });
});

test("col carries UTF-8 and cursor state across reused input chunks", async () => {
  const bytes = Buffer.from("aé\bZ\tX\n");
  const chunk = new Uint8Array(1);
  const input: ByteSource = { async *[Symbol.asyncIterator]() {
    try { for (const byte of bytes) { chunk[0] = byte; yield chunk; } }
    finally { chunk.fill(0); }
  } };
  assert.equal((await run(["-bx"], input)).stdout, "aZ      X\n");
});

for (const limits of [{ maxInputBytes: 2 }, { maxOutputBytes: 2 }, { maxRecordBytes: 2 }, { maxSteps: 2 }]) {
  test(`col enforces ${JSON.stringify(limits)}`, async () => {
    const result = await run(["-b"], "abc\n", { limits });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /limit exceeded/u);
  });
}

test("col rejects unsupported arguments and describes its supported flags", async () => {
  for (const args of [["--bad"], ["file"]]) assert.equal((await run(args, "")).exitCode, 1);
  const help = await run(["--help"], "");
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /--no-backspaces/u);
});
