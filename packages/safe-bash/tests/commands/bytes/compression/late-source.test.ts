import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { run, wrap, deferred } from "./helpers.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { CommandRegistry } from "../../../../src/contracts/index.js";
import { createCompressionCommands } from "../../../../src/commands/bytes/compression/index.js";

for (const cancellation of ["iterator factory", "readStream"] as const) test(`actual Shell retires source returned after ${cancellation} cancels with false`, { timeout: 3000 }, async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("hello\n"));
  const controller = new AbortController();
  const retiring = deferred();
  const release = deferred();
  let acquired = 0;
  let nextCalls = 0;
  let returnCalls = 0;
  const fs = wrap(memory, {
    readStream() {
      if (cancellation === "readStream") controller.abort(false);
      return {
        [Symbol.asyncIterator]() {
          acquired++;
          if (cancellation === "iterator factory") controller.abort(false);
          return {
            async next() { nextCalls++; return { done: true as const, value: undefined }; },
            async return() { returnCalls++; retiring.resolve(); await release.promise; return { done: true as const, value: undefined }; },
          };
        },
      };
    },
  });
  const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(createCompressionCommands()) });
  let settled = false;
  let disposed = false;
  const executing = shell.exec("bzip2 -k input", { signal: controller.signal }).then(value => ({ value }), reason => ({ reason }));
  void executing.then(() => { settled = true; });
  let disposing: Promise<void> | undefined;
  try {
    await retiring.promise;
    disposing = shell.dispose();
    void disposing.then(() => { disposed = true; }, () => { disposed = true; });
    for (let turn = 0; turn < 5; turn++) await setImmediate();
    const beforeRelease = { settled, disposed };
    release.resolve();
    const outcome = await executing;
    await disposing;
    context.diagnostic("LATE_SOURCE " + JSON.stringify({ beforeRelease, acquired, nextCalls, returnCalls, outcome }));
    assert.deepEqual(beforeRelease, { settled: false, disposed: false });
    assert.deepEqual(outcome, { reason: false });
    assert.equal(acquired, 1);
    assert.equal(nextCalls, 0);
    assert.equal(returnCalls, 1);
    assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["input"]);
  } finally { release.resolve(); await executing; await (disposing ?? shell.dispose()).catch(() => {}); }
});

test("direct host retires a source returned after readStream cancels", { timeout: 3000 }, async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("hello\n"));
  const controller = new AbortController();
  const release = deferred();
  let factories = 0;
  let returns = 0;
  let nextCalls = 0;
  let settled = false;
  const fs = wrap(memory, {
    readStream() {
      controller.abort(false);
      return { [Symbol.asyncIterator]() {
        factories++;
        return {
          async next() { nextCalls++; return { done: true as const, value: undefined }; },
          async return() { returns++; await release.promise; return { done: true as const, value: undefined }; },
        };
      } };
    },
  });
  const executing = run("bzip2", ["-k", "input"], undefined, { fs, signal: controller.signal }).then(value => ({ value }), reason => ({ reason }));
  void executing.then(() => { settled = true; });
  try {
    for (let turn = 0; turn < 5; turn++) await setImmediate();
    const beforeRelease = { settled, factories, returns, nextCalls };
    release.resolve();
    const outcome = await executing;
    context.diagnostic("LATE_SOURCE " + JSON.stringify({ beforeRelease, outcome }));
    assert.deepEqual(beforeRelease, { settled: false, factories: 1, returns: 1, nextCalls: 0 });
    assert.deepEqual(outcome, { reason: false });
  } finally { release.resolve(); await executing; }
});
