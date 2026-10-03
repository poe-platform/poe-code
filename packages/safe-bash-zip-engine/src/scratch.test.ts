import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext, type FileSystem, type InvocationCleanup } from "safe-bash-contracts";
import { settings } from "safe-bash-io-engine/commands/archive/internal";
import { ZipScope } from "./zip/safety.js";
import { createZipScratchFactory } from "./zip/scratch.js";

function fixture(fs: FileSystem, cleanups: InvocationCleanup[] = [], maxArchiveBytes?: number) {
  const context: CommandContext = { command: "zip", args: [], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  };
  return new ZipScope(context, settings({ limits: { chunkSize: 1024, ...(maxArchiveBytes === undefined ? {} : { maxArchiveBytes }) } }));
}

test("ZIP metadata scratch seals immutable ranges, bounds writes and releases early runs", async () => {
  const memory = createMemoryFileSystem();
  let largest = 0, active = 0, peak = 0;
  const fs = new Proxy(memory, { get(target, key) {
    if (key === "readFile") return () => { throw new Error("whole-file read"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      const stage = await memory.createStagedFile!(...args);
      active++; peak = Math.max(peak, active);
      return { ...stage, writer: { ...stage.writer!, async write(...args: Parameters<NonNullable<typeof stage.writer>["write"]>) {
        largest = Math.max(largest, args[0].length); await stage.writer!.write(...args);
      } }, cleanup: { async close() { await stage.cleanup!.close(); }, async remove() { await stage.cleanup!.remove(); active--; } } };
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const cleanups: InvocationCleanup[] = [];
  const scope = fixture(fs, cleanups);
  const factory = createZipScratchFactory(scope, "/");
  for (let run = 0; run < 100; run++) {
    const scratch = await factory();
    const bytes = new Uint8Array(10003).fill(run);
    await scratch.append(bytes);
    bytes.fill(255);
    const source = await scratch.finish();
    assert.equal(source.size, 10003);
    assert.deepEqual(await source.read(997, 29), new Uint8Array(29).fill(run));
    await assert.rejects(scratch.append(Uint8Array.of(1)), /sealed|closed/);
    await scratch.close();
    await assert.rejects(source.read(0, 1));
  }
  assert.equal(cleanups.length, 2, "one scope callback and one factory callback, independent of run count");
  assert.equal(peak, 2); assert.equal(active, 1); assert.ok(largest <= 1024);
  await factory.close();
  assert.equal(active, 0);
  assert.deepEqual(await memory.readdir("/"), []);
  await scope.close();
});

test("ZIP metadata scratch cleanup drains a staged writer and rejects further admission", async () => {
  const memory = createMemoryFileSystem();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let writing = false, removed = false;
  const fs = new Proxy(memory, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      const stage = await memory.createStagedFile!(...args);
      return { ...stage, writer: { ...stage.writer!, async write(...args: Parameters<NonNullable<typeof stage.writer>["write"]>) {
        writing = true; enter(); await held;
        try { await stage.writer!.write(...args); } finally { writing = false; }
      } }, cleanup: { async close() { await stage.cleanup!.close(); }, async remove() { assert.equal(writing, false); removed = true; await stage.cleanup!.remove(); } } };
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scope = fixture(fs);
  const factory = createZipScratchFactory(scope, "/");
  const scratch = await factory();
  const write = scratch.append(Uint8Array.of(1)).catch(error => error);
  await entered;
  let done = false;
  const closing = factory.close().then(() => { done = true; });
  await setImmediate();
  assert.equal(done, false); assert.equal(removed, false);
  await assert.rejects(factory());
  release(); await write; await closing;
  assert.equal(removed, true);
  assert.deepEqual(await memory.readdir("/"), []);
  await scope.close();
});

test("ZIP metadata scratch rejects an externally changed sealed run", async () => {
  const memory = createMemoryFileSystem();
  const scope = fixture(memory);
  const factory = createZipScratchFactory(scope, "/");
  const scratch = await factory();
  await scratch.append(Uint8Array.of(1));
  const source = await scratch.finish();
  const directory = (await memory.readdir("/"))[0]!.name;
  const run = (await memory.readdir(`/${directory}`)).find(entry => entry.type === "directory")!.name;
  await memory.writeFile(`/${directory}/${run}/run`, Uint8Array.of(2));
  await assert.rejects(source.read(0, 1), /changed/);
  await assert.rejects(scratch.close(), { code: "EAGAIN" });
  await assert.rejects(factory.close(), { code: "ENOTEMPTY" });
  await scope.close();
});

test("ZIP metadata factory cleanup drains late staging acquisition", async () => {
  const memory = createMemoryFileSystem();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const fs = new Proxy(memory, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      const stage = await memory.createStagedFile!(...args);
      enter(); await held;
      return stage;
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scope = fixture(fs);
  const factory = createZipScratchFactory(scope, "/");
  const pending = factory().catch(error => error);
  await entered;
  let settled = false;
  const closing = factory.close().then(() => { settled = true; });
  await setImmediate();
  assert.equal(settled, false);
  release(); await pending; await closing;
  assert.deepEqual(await memory.readdir("/"), []);
  await scope.close();
});


test("ZIP scratch run creation does not invalidate a streaming source directory", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/first", Uint8Array.of(1));
  await fs.writeFile("/.zip-metadata-user", Uint8Array.of(2));
  await fs.writeFile("/last", Uint8Array.of(3));
  const scope = fixture(fs);
  const factory = createZipScratchFactory(scope, "/");
  await factory.initialize();
  const seen: string[] = [];
  for await (const entry of fs.iterateDirectory!("/")) {
    if (factory.ownsPath(`/${entry.name}`)) continue;
    seen.push(entry.name);
    const run = await factory();
    await run.append(Uint8Array.of(4));
    await run.finish();
    await run.close();
  }
  assert.deepEqual(seen.sort(), [".zip-metadata-user", "first", "last"]);
  await factory.close();
  for (const entry of await fs.readdir("/")) assert.equal(factory.ownsPath(`/${entry.name}`), false);
  await scope.close();
});


test("ZIP metadata overhead is independent of the archive byte limit", async () => {
  const fs = createMemoryFileSystem();
  const scope = fixture(fs, [], 1024);
  const factory = createZipScratchFactory(scope, "/");
  try {
    const run = await factory();
    await assert.rejects(run.append({ length: Number.MAX_SAFE_INTEGER + 1 } as Uint8Array), /overflow/);
    await run.append(new Uint8Array(2049).fill(7));
    const source = await run.finish();
    assert.equal(source.size, 2049);
    assert.deepEqual(await source.read(2040, 9), new Uint8Array(9).fill(7));
  } finally { await factory.close(); await scope.close(); }
});
