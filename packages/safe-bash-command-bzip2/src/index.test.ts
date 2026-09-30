import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createBzip2Command, createBunzip2Command, createBzcatCommand, createBzip2Commands, bzip2Commands } from "./index.js";

test("bzip2 command roundtrips data through compress and decompress", async () => {
  assert.equal(createBzip2Commands().length, 3);
  assert.equal(bzip2Commands().name, "bzip2-commands");

  const fs = createMemoryFileSystem();
  await fs.writeFile("/hello.txt", new TextEncoder().encode("hello bzip2 world\n"));

  const compressCmd = createBzip2Command();
  const res1 = await compressCmd.execute({
    command: "bzip2",
    args: createCommandArguments(["-k", "/hello.txt"]).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: createBytePipe().writable,
    stderr: createBytePipe().writable,
    signal: new AbortController().signal,
  });
  assert.equal(res1.exitCode, 0);

  const bzcatOut = createBytePipe();
  const bzcatCmd = createBzcatCommand();
  const res2 = await bzcatCmd.execute({
    command: "bzcat",
    args: createCommandArguments(["/hello.txt.bz2"]).args,
    cwd: "/",
    env: {},
    fs,
    stdin: createBytePipe().readable,
    stdout: bzcatOut.writable,
    stderr: createBytePipe().writable,
    signal: new AbortController().signal,
  });
  await bzcatOut.close();
  assert.equal(res2.exitCode, 0);
  const chunks: Uint8Array[] = [];
  for await (const c of bzcatOut.readable) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString("utf8"), "hello bzip2 world\n");
  assert.equal(createBunzip2Command().name, "bunzip2");
});

test("bunzip2 preserves corruption status across later operand errors", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/broken.bz2", new TextEncoder().encode("BZh9broken"));
  const values = createCommandArguments(["-c", "/broken.bz2", "/missing.bz2"]);
  const result = await createBunzip2Command().execute({
    command: "bunzip2", args: values.args, argumentValues: values,
    cwd: "/", env: {}, fs, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 2);
});
