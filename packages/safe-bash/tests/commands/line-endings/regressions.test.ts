import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/node.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { FsError, toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { createDos2unixCommand, createUnix2dosCommand } from "../../../src/commands/line-endings/index.js";

for (const create of [createDos2unixCommand, createUnix2dosCommand]) {
  const command = create();
  async function run(stdin: ByteSource, args: string[] = [], fs = new MemoryFileSystem(), events: string[] = []) {
    const result = await command.execute({ command: command.name, args, fs, cwd: "/", env: { LC_ALL: "C.UTF-8" }, signal: new AbortController().signal, stdin,
      stdout: { async write(bytes) { events.push(`out:${Buffer.from(bytes).toString()}`); } },
      stderr: { async write(bytes) { events.push(`err:${Buffer.from(bytes).toString()}`); } } });
    return { ...result, events };
  }
  for (const hex of ["fffe00d8", "feffd800", "fffe00d84100", "ff"]) test(`${command.name} stdin rejects malformed UTF-16/BOM ${hex}`, async () => {
    assert.equal((await run(toByteSource(Buffer.from(hex, "hex")))).exitCode, 1);
  });
  for (const hex of ["fffe00d8", "fffe00d84100"]) test(`${command.name} preserves invalid file and isolates next file ${hex}`, async () => {
    const fs = new MemoryFileSystem();
    const invalid = Buffer.from(hex, "hex");
    await fs.writeFile("/invalid", invalid);
    await fs.writeFile("/valid", Buffer.from("fffe61000d000a00", "hex"));
    const result = await run(toByteSource(""), ["/invalid", "-r", "/valid"], fs);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(Buffer.from(await fs.readFile("/invalid")), invalid);
    assert.equal(Buffer.from(await fs.readFile("/valid")).toString(), command.name === "dos2unix" ? "a\n" : "a\r\n");
  });
  test(`${command.name} reports surrogate before CRLF on its original line`, async () => {
    const result = await run(toByteSource(Buffer.from("fffe61000a0000d80d000a00", "hex")));
    assert.equal(result.exitCode, 1);
    assert.ok(result.events.join("").includes("error occurred on line 2."));
  });
  test(`${command.name} flushes output before requesting the next chunk`, async () => {
    const events: string[] = [];
    const stdin = { async *[Symbol.asyncIterator]() {
      yield Buffer.from("abc\n");
      assert.ok(events.some(event => event.startsWith("out:abc")), "producer waits for converted output");
      yield Buffer.from("def\n");
    } };
    assert.equal((await run(stdin, ["-r"], undefined, events)).exitCode, 0);
  });
  test(`${command.name} flushes converted bytes before binary diagnostics`, async () => {
    const result = await run(toByteSource("abc\0"), ["-r"]);
    assert.equal(result.events[0], "out:abc");
    assert.ok(result.events[1]?.includes("Binary symbol"));
  });
  test(`${command.name} keeps converted output on read failure`, async () => {
    const events: string[] = [];
    const error = new FsError("EIO", { syscall: "read", path: "/stdin" });
    const stdin = { async *[Symbol.asyncIterator]() { yield Buffer.from("abc"); throw error; } };
    await assert.rejects(run(stdin, ["-r"], undefined, events), reason => reason === error);
    assert.deepEqual(events, ["out:abc"]);
  });
}

test("Node Shell without options reaches portable validation", () => {
  assert.throws(() => new Shell(), error => error instanceof TypeError && error.message === "Shell requires an explicit filesystem");
});
