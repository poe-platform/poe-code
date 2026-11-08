import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext, type InvocationCleanup } from "safe-bash-contracts";
import { settings } from "safe-bash-io-engine/commands/archive/internal";
import { ZipScope, spoolZipSource } from "./zip/safety.js";

for (const end of ["abort", "cleanup"] as const) test(`ZIP spool drains admitted source before ${end} settlement`, async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  const context: CommandContext = { command: "zip", args: [], cwd: "/", env: {}, fs,
    signal: controller.signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  };
  const scope = new ZipScope(context, settings({}));
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let retired = false, settled = false;
  const source = (async function* () { try { enter(); await held; yield Uint8Array.of(1); } finally { retired = true; } })();
  const pending = spoolZipSource(scope, "/", source, 1024).then(value => { settled = true; return value; }, error => { settled = true; return error; });
  await entered;
  let closing: Promise<unknown> | undefined;
  try {
    if (end === "abort") controller.abort(false);
    else {
      assert.ok(cleanups.length > 1, "spool owns registered cleanup before acquisition");
      closing = Promise.all(cleanups.map(cleanup => cleanup()));
    }
    await setImmediate();
    assert.equal(settled, false);
    assert.equal(retired, false);
  } finally { release(); }
  const result = await pending;
  if (end === "abort") assert.equal(result, false);
  await closing;
  await scope.close();
  assert.equal(retired, true);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("ZIP spool cleanup drains a retained range before closing its handle", async () => {
  const fs = createMemoryFileSystem();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let reading = false, closed = false;
  const view = new Proxy(fs, { get(target, key) {
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...args);
      return { ...handle, async read(...args: Parameters<typeof handle.read>) {
        reading = true; enter(); await held;
        try { return await handle.read(...args); } finally { reading = false; }
      }, async close() { assert.equal(reading, false); closed = true; await handle.close(); } };
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scope = new ZipScope({ command: "zip", args: [], cwd: "/", env: {}, fs: view,
    signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
  }, settings({}));
  const spool = await spoolZipSource(scope, "/", toByteSource(Uint8Array.of(1)), 1);
  const read = spool.source.read(0, 1).catch(error => error);
  await entered;
  let settled = false;
  const cleanup = spool.close().then(() => { settled = true; });
  await setImmediate();
  assert.equal(closed, false); assert.equal(settled, false);
  release();
  await read; await cleanup; await scope.close();
  assert.equal(closed, true);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("ZIP spool bounds aggregate bytes and removes staging after admission failure", async () => {
  const fs = createMemoryFileSystem();
  const scope = new ZipScope({ command: "zip", args: [], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
  }, settings({ limits: { chunkSize: 1024 } }));
  let retired = false;
  const source = (async function* () { try { yield new Uint8Array(1024); yield Uint8Array.of(1); } finally { retired = true; } })();
  await assert.rejects(spoolZipSource(scope, "/", source, 1024), /spool byte limit/);
  assert.equal(retired, true);
  assert.deepEqual(await fs.readdir("/"), []);
  await scope.close();
});

test("ZIP member spools retain no per-member cleanup history", async () => {
  const fs = createMemoryFileSystem();
  const cleanups: InvocationCleanup[] = [];
  const scope = new ZipScope({ command: "unzip", args: [], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  }, settings({}));
  for (let index = 0; index < 100; index++) {
    const spool = await spoolZipSource(scope, "/", toByteSource(Uint8Array.of(index)), 1);
    await spool.close();
  }
  assert.equal(cleanups.length, 2);
  assert.deepEqual(await fs.readdir("/"), []);
  await Promise.all(cleanups.map(cleanup => cleanup()));
});
