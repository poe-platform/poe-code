import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { shellValueFromBytes } from "safe-bash-contracts/value";
import { createXqCommand } from "./index.js";

test("xq behavior works through the standalone portable factory", async () => {
 const values = createCommandArguments([".root"]);
 let output = "";
 const result = await createXqCommand().execute({
  command: "xq", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource("<root>ok</root>"),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.equal(output, "\"ok\"\n");
});

test("xq preserves output failure identity instead of reporting an XML parse failure", async () => {
  const command = createXqCommand();
  const failure = new SyntaxError("sink failed");
  await assert.rejects(Promise.resolve(command.execute({
    command: "xq", args: ["."], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource("<a/>"),
    stdout: { async write() { throw failure; } },
    stderr: { async write() { assert.fail("output failure must not become an XML diagnostic"); } },
  })), error => error === failure);
});


for (const operand of ["filter", "filename"] as const) test(`xq rejects lossy UTF-8 ${operand} before input reads`, async () => {
  const raw = shellValueFromBytes(Buffer.from(operand === "filter" ? '.["\xff"]' : "/\xff.xml", "latin1"));
  const carrier = createCommandArguments(operand === "filter" ? [raw] : [".", raw]);
  const command = createXqCommand();
  let reads = 0;
  const result = await command.execute({
    command: "xq", args: carrier.args, argumentValues: carrier,
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () { reads++; yield Buffer.from("<a/>"); })(),
    stdout: { async write() { assert.fail("invalid arguments must not emit output"); } },
    stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(reads, 0);
});
