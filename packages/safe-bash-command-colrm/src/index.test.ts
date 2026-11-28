import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type ByteSource } from "safe-bash-contracts";
import { createColrmCommand, type ColrmCommandsOptions } from "./index.js";

async function run(args: string[], input: string | Uint8Array | ByteSource, options: ColrmCommandsOptions = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createColrmCommand(options).execute({
    command: "colrm", args, cwd: "/", env: { LC_ALL: "C.UTF-8" }, fs: createMemoryFileSystem(),
    stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, signal: new AbortController().signal,
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

for (const [args, input, expected] of [
  [["2", "4"], "abcdef\n", "aef\n"],
  [["2"], "abcdef\nabc", "a\na"],
  [[], "ab\bc\t\n", "ab\bc\t\n"],
  [["0"], "abc\n", "abc\n"],
  [["2", "0"], "abc\n", "a\n"],
  [["20", "30"], "abc\n", "abc\n"],
  [["2", "4"], "a\tZ\n", "a    Z\n"],
  [["2", "4"], "abc\bXdef\n", "aef\n"],
  [["2", "4"], "aé界z\n", "az\n"],
  [["2", "4"], "界a\n", " \n"],
  [["1", "1"], "界a\n", " a\n"],
  [["2", "4"], "\n\n", "\n\n"],
] as const) test(`colrm ${args.join(" ")} ${JSON.stringify(input)}`, async () => {
  assert.deepEqual(await run([...args], input), { exitCode: 0, stdout: Buffer.from(expected), stderr: "" });
});

test("colrm without operands preserves arbitrary bytes", async () => {
  const bytes = Uint8Array.of(255, 0, 128, 10);
  assert.deepEqual((await run([], bytes)).stdout, Buffer.from(bytes));
});

test("colrm handles UTF-8 split across reused chunks", async () => {
  const bytes = Buffer.from("aé界z\n");
  const chunk = new Uint8Array(1);
  const input: ByteSource = { async *[Symbol.asyncIterator]() {
    try { for (const byte of bytes) { chunk[0] = byte; yield chunk; } }
    finally { chunk.fill(0); }
  } };
  assert.equal((await run(["2", "4"], input)).stdout.toString(), "az\n");
});

for (const limits of [{ maxInputBytes: 2 }, { maxOutputBytes: 2 }, { maxSteps: 2 }]) {
  test(`colrm enforces ${JSON.stringify(limits)}`, async () => {
    const result = await run(["8"], "abc\n", { limits });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /limit exceeded/u);
  });
}

test("colrm rejects malformed or excess operands", async () => {
  for (const args of [["-1"], ["x"], ["1.5"], ["1", "2", "3"]]) assert.equal((await run(args, "")).exitCode, 1);
  assert.equal((await run(["--help"], "")).exitCode, 0);
});
