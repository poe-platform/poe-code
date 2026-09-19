import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { FsError } from "../../src/contracts/index.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

for (const named of [false, true]) test(`csvcut cancellation preserves ${named ? "registered named cleanup barrier" : "borrowed stdin cancellation boundary"}`, async () => {
  const effects: string[] = [];
  let announceRead!: () => void, releaseRead!: () => void;
  const admitted = new Promise<void>(resolve => { announceRead = resolve; });
  const reading = new Promise<IteratorResult<Uint8Array>>(resolve => { releaseRead = () => resolve({ done: true, value: undefined }); });
  let announceReturn!: () => void, releaseReturn!: () => void;
  const returning = new Promise<void>(resolve => { releaseReturn = resolve; });
  const returnAdmitted = new Promise<void>(resolve => { announceReturn = resolve; });
  const source = { [Symbol.asyncIterator]() {
    effects.push("iterator");
    return {
      next() { effects.push("next"); announceRead(); return reading; },
      async return() {
        effects.push("return-start"); announceReturn(); releaseRead();
        await returning; effects.push("return-end");
        return { done: true as const, value: undefined };
      }
    };
  } };
  const fs = new MemoryFileSystem();
  if (named) Object.assign(fs, {
    readStream(path: string) { assert.equal(path, "/owned.csv"); return source; },
    async readFile() { assert.fail("stream input must not bulk-read"); }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  const caller = new AbortController();
  const reason = new Error("cancel delayed input return");
  let settled = false;
  const execution = shell.exec(`csvcut${named ? " /owned.csv" : ""}`, {
    signal: caller.signal,
    stdin: named ? { async *[Symbol.asyncIterator]() { assert.fail("named input must not acquire stdin"); yield new Uint8Array(); } } : source
  });
  const rejected = assert.rejects(execution, caught => caught === reason).then(() => { settled = true; });
  try {
    await admitted; caller.abort(reason); await returnAdmitted;
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, !named, named
      ? "registered named input cleanup must drain before public settlement"
      : "borrowed opaque stdin return keeps the existing interruptible cancellation boundary");
    assert.deepEqual(effects, ["iterator", "next", "return-start"]);
    releaseReturn(); await rejected;
    assert.deepEqual(effects, ["iterator", "next", "return-start", "return-end"]);
    await shell.dispose();
    assert.equal(effects.length, 4, "input is released only once, including disposal");
  } finally { releaseRead(); releaseReturn(); await rejected; await shell.dispose(); }
});

test("csvcut named source EOF cleanup failure cannot become successful output", async () => {
  const fs = new MemoryFileSystem();
  const failure = new Error("named source return failed");
  let returned = 0;
  Object.assign(fs, { readStream() {
    return { [Symbol.asyncIterator]() {
      let read = false;
      return {
        async next() {
          if (read) return { done: true as const, value: undefined };
          read = true;
          return { done: false as const, value: new TextEncoder().encode("a\nx\n") };
        },
        async return() { returned++; throw failure; }
      };
    } };
  } });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec("csvcut /owned.csv");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "a\nx\n", stderr: "shell: line 1: internal error\n"
    });
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
  assert.equal(returned, 1);
});

for (const synchronous of [false, true]) test(`csvcut ${synchronous ? "synchronous" : "asynchronous"} named read failure wins over failing cleanup`, async () => {
  const fs = new MemoryFileSystem();
  const readFailure = new FsError("EACCES", { path: "/private.csv" });
  let returned = 0;
  Object.assign(fs, {
    readStream(path: string) {
      assert.equal(path, "/private.csv");
      return { [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<Uint8Array>> {
            if (synchronous) throw readFailure;
            return Promise.reject(readFailure);
          },
          async return() { returned++; throw new Error("secondary source cleanup failed"); }
        };
      } };
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec("csvcut private.csv", {
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("named read failure must not acquire stdin"); yield new Uint8Array(); } }
    });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "", stderr: "PermissionError: [Errno 13] Permission denied: 'private.csv'\n"
    });
    assert.equal(returned, 1);
  } finally { await shell.dispose(); }
  assert.equal(returned, 1, "disposal must not retry failed iterator cleanup");
});

test("csvcut synchronous named iterator acquisition failure does not acquire borrowed stdin", async () => {
  const fs = new MemoryFileSystem();
  let acquired = 0;
  Object.assign(fs, { readStream() {
    return { [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      acquired++;
      throw new FsError("ENOTDIR", { path: "/file/child.csv" });
    } };
  } });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec("csvcut file/child.csv", {
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("failed named acquisition must not acquire stdin"); yield new Uint8Array(); } }
    });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "", stderr: "NotADirectoryError: [Errno 20] Not a directory: 'file/child.csv'\n"
    });
    assert.equal(acquired, 1);
  } finally { await shell.dispose(); }
});
