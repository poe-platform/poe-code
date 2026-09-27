import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createNumfmtCommand, createNumfmtCommands, numfmtCommands } from "./index.js";

test("numfmt formats numbers to iec and si", async () => {
  assert.equal(createNumfmtCommands().length, 1);
  assert.equal(numfmtCommands().name, "numfmt-commands");
  const cmd = createNumfmtCommand();
  const out = createBytePipe();
  const res = await cmd.execute({
    command: "numfmt",
    args: createCommandArguments(["--to=iec", "1048576"]).args,
    cwd: "/",
    env: {},
    fs: createMemoryFileSystem(),
    stdin: createBytePipe().readable,
    stdout: out.writable,
    stderr: createBytePipe().writable,
    signal: new AbortController().signal,
  });
  await out.close();
  assert.equal(res.exitCode, 0);
  const chunks: Uint8Array[] = [];
  for await (const c of out.readable) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString("utf8"), "1.0M\n");
});

test("numfmt scales zero with --to=iec, --to=si, and --to=iec-i without (error)", async () => {
  const cmd = createNumfmtCommand();
  for (const [scale, expected] of [
    ["iec", "0\n"],
    ["si", "0\n"],
    ["iec-i", "0\n"],
  ] as const) {
    const out = createBytePipe();
    const res = await cmd.execute({
      command: "numfmt",
      args: createCommandArguments([`--to=${scale}`, "0", "1024"]).args,
      cwd: "/",
      env: {},
      fs: createMemoryFileSystem(),
      stdin: createBytePipe().readable,
      stdout: out.writable,
      stderr: createBytePipe().writable,
      signal: new AbortController().signal,
    });
    await out.close();
    assert.equal(res.exitCode, 0);
    const chunks: Uint8Array[] = [];
    for await (const c of out.readable) chunks.push(c);
    const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n");
    assert.equal(lines[0], expected.trim());
    assert.ok(!lines[0].includes("error"));
  }
});


test("numfmt admits input chunks larger than the former 32 MiB ceiling", async () => {
  const input = new Uint8Array(32 * 1024 * 1024 + 1);
  input.set(new TextEncoder().encode("1\n"));
  const stop = new Error("stop after verifying the first output");
  const errors: Uint8Array[] = [];
  await assert.rejects(async () => createNumfmtCommand().execute({
    command: "numfmt", args: createCommandArguments([]).args, cwd: "/", env: {},
    fs: createMemoryFileSystem(),
    stdin: { async *[Symbol.asyncIterator]() { yield input; } },
    stdout: { write: async chunk => {
      assert.equal(new TextDecoder().decode(chunk), "1\n");
      throw stop;
    } },
    stderr: { write: async chunk => { errors.push(chunk); } },
    signal: new AbortController().signal,
  }), error => error === stop);
  assert.equal(Buffer.concat(errors).toString(), "");
});
