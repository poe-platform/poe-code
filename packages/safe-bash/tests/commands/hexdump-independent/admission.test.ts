import assert from "node:assert/strict";
import test from "node:test";
import type { ByteSource, FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createHexdumpCommand } from "../../../src/commands/hexdump/index.js";
import { run } from "../hexdump/helpers.js";

for (const reason of [false, 0, "", null]) {
  test("done getter admission " + JSON.stringify(reason), async () => {
    const caller = new AbortController();
    let values = 0, returned = 0;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { return { get done() { caller.abort(reason); return false as const; }, get value() { values++; return Buffer.from("A"); } }; },
      async return() { returned++; return { done: true, value: undefined }; },
    }; } };
    await assert.rejects(run([], undefined, {}, { stdin, signal: caller.signal }), error => Object.is(error, reason));
    assert.equal(returned, 1);
    assert.equal(values, 0);
  });
  test("value getter admission " + JSON.stringify(reason), async () => {
    const caller = new AbortController();
    let values = 0;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { return { done: false, get value() { values++; caller.abort(reason); return Buffer.from("A"); } }; },
      async return() { return { done: true, value: undefined }; },
    }; } };
    await assert.rejects(run([], undefined, {}, { stdin, signal: caller.signal }), error => Object.is(error, reason));
    assert.equal(values, 1);
  });
  test("stat type admission " + JSON.stringify(reason), async () => {
    const caller = new AbortController();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", Buffer.from("A"));
    const stat = await fs.stat("/file");
    let capabilities = 0;
    fs.stat = async () => ({ ...stat, get type() { caller.abort(reason); return "file" as const; } });
    Object.defineProperty(fs, "capabilitiesFor", { get() { capabilities++; return undefined; } });
    await assert.rejects(run(["file"], undefined, {}, { fs, signal: caller.signal }), error => Object.is(error, reason));
    assert.equal(capabilities, 0);
  });
  test("cwd getter blocks fs getter " + JSON.stringify(reason), async () => {
    const caller = new AbortController();
    const fs = new MemoryFileSystem();
    let filesystem = 0;
    await assert.rejects(async () => createHexdumpCommand().execute({ command: "hexdump", args: ["a"], env: {}, signal: caller.signal,
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} },
      get cwd() { caller.abort(reason); return "/"; }, get fs() { filesystem++; return fs; },
    }), error => Object.is(error, reason));
    assert.equal(filesystem, 0);
  });
  test("stat size getter blocks buffered read getter " + JSON.stringify(reason), async () => {
    const caller = new AbortController();
    const fs: FileSystem = new MemoryFileSystem();
    await fs.writeFile("/file", Buffer.from("A"));
    const stat = await fs.stat("/file");
    let reads = 0;
    fs.stat = async () => ({ ...stat, get size() { caller.abort(reason); return 1; } });
    fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
    Object.defineProperty(fs, "readFile", { get() { reads++; return async () => Buffer.from("A"); } });
    await assert.rejects(run(["file"], undefined, {}, { fs, signal: caller.signal }), error => Object.is(error, reason));
    assert.equal(reads, 0);
  });
}

test("one result-value snapshot binds charged and consumed bytes", async () => {
  let pulls = 0, values = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() {
      if (pulls++) return { done: true, value: undefined };
      return { done: false, get value() { values++; return values < 5 ? Buffer.from("A") : Buffer.from("ABCD"); } };
    },
    async return() { return { done: true, value: undefined }; },
  }; } };
  const result = await run(["-C"], undefined, { limits: { maxInputBytes: 1 } }, { stdin });
  assert.equal(values, 1);
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.from(result.stdout, "hex").toString(), "00000000  41                                                |A|\n00000001\n");
});
