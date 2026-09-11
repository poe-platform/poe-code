import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { run, wrap, deferred } from "./helpers.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { CommandRegistry } from "../../../../src/contracts/index.js";
import { createCompressionCommands } from "../../../../src/commands/bytes/compression/index.js";

test("actual Shell exec/dispose drains an admitted planning stat", { timeout: 3000 }, async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("hello\n"));
  const entered = deferred();
  const release = deferred();
  let acquisitions = 0;
  const fs = wrap(memory, {
    async lstat(path, options) {
      const stat = await memory.lstat(path, options);
      if (path === "/input") { entered.resolve(); await release.promise; }
      return stat;
    },
    async mkdir(path, options) { acquisitions++; await memory.mkdir(path, options); },
  });
  const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(createCompressionCommands()) });
  const controller = new AbortController();
  let settled = false;
  let disposed = false;
  const executing = shell.exec("bzip2 -k input", { signal: controller.signal }).then(value => ({ value }), reason => ({ reason }));
  void executing.then(() => { settled = true; });
  let disposing: Promise<void> | undefined;
  try {
    await entered.promise;
    controller.abort(false);
    disposing = shell.dispose();
    void disposing.then(() => { disposed = true; }, () => { disposed = true; });
    for (let turn = 0; turn < 5; turn++) await setImmediate();
    const beforeRelease = { settled, disposed };
    release.resolve();
    const outcome = await executing;
    await disposing;
    context.diagnostic("PLANNING " + JSON.stringify({ beforeRelease, outcome, acquisitions }));
    assert.deepEqual(beforeRelease, { settled: false, disposed: false });
    assert.deepEqual(outcome, { reason: false });
    assert.equal(acquisitions, 0);
  } finally { release.resolve(); await executing; await (disposing ?? shell.dispose()).catch(() => {}); }
});

for (const phase of ["capabilitiesFor", "readStream"] as const) test(`${phase} getter cancellation blocks method admission`, async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("hello\n"));
  const controller = new AbortController();
  let calls = 0;
  const fs = new Proxy(memory, {
    get(target, key) {
      if (key === phase) {
        controller.abort(false);
        if (phase === "capabilitiesFor") return async () => { calls++; return memory.capabilities; };
        return () => { calls++; return memory.readStream("/input"); };
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const outcome = await run("bzip2", ["-k", "input"], undefined, { fs, signal: controller.signal }).then(value => ({ value }), reason => ({ reason }));
  context.diagnostic("PLANNING " + JSON.stringify({ phase, calls, outcome }));
  assert.deepEqual(outcome, { reason: false });
  assert.equal(calls, 0);
});
