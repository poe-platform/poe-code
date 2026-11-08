import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { run, wrap, deferred } from "./helpers.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { CommandRegistry, FsError, type InvocationCleanup } from "../../../../src/contracts/index.js";
import { createCompressionCommands } from "../../../../src/commands/bytes/compression/index.js";

async function turns(): Promise<void> { for (let turn = 0; turn < 5; turn++) await setImmediate(); }

for (const phase of ["acquisition", "write", "cleanup"] as const) test(`actual Shell exec/dispose drains held ${phase} with false cancellation`, { timeout: 3000 }, async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("hello\n"));
  const entered = deferred();
  const release = deferred();
  let held = false;
  let iteratorReturns = 0;
  let stage = "";
  const fs = wrap(memory, {
    readStream(path, options) {
      const source = memory.readStream(path, options);
      if (phase !== "acquisition") return source;
      return {
        [Symbol.asyncIterator]() {
          const iterator = source[Symbol.asyncIterator]();
          return {
            async next() {
              if (!held) { held = true; entered.resolve(); await release.promise; }
              return iterator.next();
            },
            async return() { iteratorReturns++; await release.promise; return iterator.return ? await iterator.return() : { done: true as const, value: undefined }; },
          };
        },
      };
    },
    async writeStream(path, source, options) {
      stage = path.slice(0, path.lastIndexOf("/"));
      await memory.writeStream(path, source, options);
      if (phase === "write") { held = true; entered.resolve(); await release.promise; }
    },
    async rm(path, options) {
      if (phase === "cleanup" && options?.recursive) { held = true; entered.resolve(); await release.promise; }
      await memory.rm(path, options);
    },
    async rmdir(path, options) {
      if (phase === "cleanup") { held = true; entered.resolve(); await release.promise; }
      await memory.rmdir(path, options);
    },
  });
  const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(createCompressionCommands()) });
  const controller = new AbortController();
  let executionSettled = false;
  let disposalSettled = false;
  const execution = shell.exec("bzip2 -k input", { signal: controller.signal }).then(value => ({ returned: true as const, value }), reason => ({ returned: false as const, reason }));
  void execution.then(() => { executionSettled = true; });
  let disposal: Promise<void> | undefined;
  try {
    await entered.promise;
    controller.abort(false);
    disposal = shell.dispose();
    void disposal.then(() => { disposalSettled = true; }, () => { disposalSettled = true; });
    await turns();
    const beforeRelease = { executionSettled, disposalSettled };
    release.resolve();
    const outcome = await execution;
    await disposal;
    const stageSurvives = stage ? await memory.lstat(stage).then(() => true, () => false) : false;
    context.diagnostic("OWNERSHIP " + JSON.stringify({ phase, beforeRelease, outcome, iteratorReturns, stageSurvives }));
    assert.deepEqual(beforeRelease, { executionSettled: false, disposalSettled: false });
    assert.equal(outcome.returned, false);
    if (!outcome.returned) assert.equal(outcome.reason, false);
    assert.equal(stageSurvives, false, "known owned stage must retire even after the invocation FS scope closes");
    if (phase === "acquisition") assert.equal(iteratorReturns, 1);
  } finally { release.resolve(); await execution; await (disposal ?? shell.dispose()).catch(() => {}); }
});

test("registered close stops admission before the first stage resource", async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("hello\n"));
  let acquisitions = 0;
  const closes: Promise<void>[] = [];
  const fs = wrap(memory, { async mkdir(path, options) { acquisitions++; await memory.mkdir(path, options); } });
  await run("bzip2", ["-k", "input"], undefined, { fs, registerCleanup(cleanup) { closes.push(Promise.resolve(cleanup())); } });
  await Promise.all(closes);
  context.diagnostic("OWNERSHIP " + JSON.stringify({ probe: "close-before-admission", acquisitions, registered: closes.length }));
  assert.ok(closes.length > 0);
  assert.equal(acquisitions, 0);
});

test("registered close drains an admitted writer and blocks publication without aborting caller", { timeout: 3000 }, async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("hello\n"));
  const entered = deferred();
  const release = deferred();
  const callbacks: InvocationCleanup[] = [];
  let publications = 0;
  const fs = wrap(memory, {
    async writeStream(path, source, options) { await memory.writeStream(path, source, options); entered.resolve(); await release.promise; },
    async rename(source, destination, options) { publications++; await memory.rename(source, destination, options); },
    async copyFile(source, destination, options) { publications++; await memory.copyFile(source, destination, options); },
  });
  const controller = new AbortController();
  const executing = run("bzip2", ["-k", "input"], undefined, { fs, signal: controller.signal, registerCleanup: callback => { callbacks.push(callback); } });
  try {
    await entered.promise;
    let closed = false;
    const closing = Promise.all(callbacks.map(callback => callback())).then(() => { closed = true; });
    await turns();
    const closedBeforeRelease = closed;
    release.resolve();
    await executing;
    await closing;
    context.diagnostic("OWNERSHIP " + JSON.stringify({ probe: "registered-close-held-write", callbacks: callbacks.length, closedBeforeRelease, publications }));
    assert.ok(callbacks.length > 0);
    assert.equal(closedBeforeRelease, false);
    assert.equal(publications, 0);
    assert.equal(controller.signal.aborted, false);
    assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["input"]);
  } finally { release.resolve(); await executing; }
});

test("capability rejection preserves original input and target under shared gzip path", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("hello\n"));
  const capabilities = { ...memory.capabilities, atomicRename: false, atomicRenameNoReplace: false };
  let acquisitions = 0;
  const fs = wrap(memory, { capabilities, async capabilitiesFor() { return capabilities; }, async mkdir() { acquisitions++; throw new FsError("EIO"); } });
  const result = await run("gzip", ["-k", "input"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(acquisitions, 0);
  assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["input"]);
});
