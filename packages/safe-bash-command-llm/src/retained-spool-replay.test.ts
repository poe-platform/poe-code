import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createLlmSpool } from "./retained-spool.js";

test("retained spool supports repeated reads and early-return ownership release", async () => {
 const fs = new MemoryFileSystem();
 const spool = await createLlmSpool(fs, "/", new AbortController().signal);
 const input = new Uint8Array(40000).fill(42);
 try {
  await spool.write(input);
  const first = spool.replay()[Symbol.asyncIterator]();
  assert.equal((await first.next()).value?.length, 16384);
  await assert.rejects(spool.replay()[Symbol.asyncIterator]().next(), { code: "EBUSY" });
  await first.return?.();
  for (let pass = 0; pass < 2; pass++) {
   const chunks = [];
   for await (const chunk of spool.replay()) chunks.push(chunk);
   assert.deepEqual(Buffer.concat(chunks), Buffer.from(input));
  }
  await assert.rejects(spool.write(Uint8Array.of(1)), { code: "EBADF" });
 } finally { await spool.close(); }
 assert.deepEqual(await fs.readdir("/"), []);
});

test("sealing excludes writes and caches finish failures", async () => {
 const backing = new MemoryFileSystem();
 let entered!: () => void, release!: () => void, finishes = 0;
 const started = new Promise<void>(resolve => { entered = resolve; });
 const barrier = new Promise<void>(resolve => { release = resolve; });
 const fs = new Proxy(backing, { get(target, key) {
  if (key === "createStagedFile") return async (...args: Parameters<typeof backing.createStagedFile>) => {
   const staged = await target.createStagedFile(...args);
   return { ...staged, writer: { write: staged.writer!.write.bind(staged.writer),
    async finish() { finishes++; entered(); await barrier; throw new Error("finish failed"); },
   } };
  };
  const value: unknown = Reflect.get(target, key);
  return typeof value === "function" ? value.bind(target) : value;
 } });
 const spool = await createLlmSpool(fs, "/", new AbortController().signal);
 try {
  await spool.write(Uint8Array.of(42));
  const pending = spool.replay()[Symbol.asyncIterator]().next();
  await started;
  await assert.rejects(spool.write(Uint8Array.of(1)), { code: "EBADF" });
  await assert.rejects(spool.replay()[Symbol.asyncIterator]().next(), { code: "EBUSY" });
  release();
  await assert.rejects(pending, /finish failed/);
  await assert.rejects(spool.replay()[Symbol.asyncIterator]().next(), /finish failed/);
  assert.equal(finishes, 1);
 } finally { release(); await spool.close(); }
 assert.deepEqual(await backing.readdir("/"), []);
});

test("replay retains one reader and validates identity on every pass", async () => {
 const backing = new MemoryFileSystem();
 let opens = 0, closes = 0, changed = false;
 const fs = new Proxy(backing, { get(target, key) {
  if (key === "openReadFile") return async (...args: Parameters<typeof backing.openReadFile>) => {
   opens++;
   const reader = await target.openReadFile(...args);
   return { read: reader.read.bind(reader),
    async stat(options: Parameters<typeof reader.stat>[0]) {
     const stat = await reader.stat(options);
     return changed ? { ...stat, mtimeMs: stat.mtimeMs + 1 } : stat;
    },
    async close() { closes++; await reader.close(); },
   };
  };
  const value: unknown = Reflect.get(target, key);
  return typeof value === "function" ? value.bind(target) : value;
 } });
 const spool = await createLlmSpool(fs, "/", new AbortController().signal);
 try {
  await spool.write(Uint8Array.of(42));
  for (let pass = 0; pass < 2; pass++) {
   for await (const chunk of spool.replay()) assert.deepEqual(chunk, Uint8Array.of(42));
  }
  assert.equal(opens, 1);
  changed = true;
  await assert.rejects(spool.replay()[Symbol.asyncIterator]().next(), { code: "EBUSY" });
 } finally { await spool.close(); await spool.close(); }
 assert.equal(closes, 1);
 await assert.rejects(spool.replay()[Symbol.asyncIterator]().next(), { code: "EBADF" });
 assert.deepEqual(await backing.readdir("/"), []);
});

test("an active write excludes sealing and concurrent writes", async () => {
 const backing = new MemoryFileSystem();
 let entered!: () => void, release!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; });
 const barrier = new Promise<void>(resolve => { release = resolve; });
 const fs = new Proxy(backing, { get(target, key) {
  if (key === "createStagedFile") return async (...args: Parameters<typeof backing.createStagedFile>) => {
   const staged = await target.createStagedFile(...args);
   const writer = staged.writer!;
   return { ...staged, writer: { finish: writer.finish.bind(writer),
    async write(...writeArgs: Parameters<typeof writer.write>) { entered(); await barrier; await writer.write(...writeArgs); },
   } };
  };
  const value: unknown = Reflect.get(target, key);
  return typeof value === "function" ? value.bind(target) : value;
 } });
 const spool = await createLlmSpool(fs, "/", new AbortController().signal);
 try {
  const pending = spool.write(Uint8Array.of(42));
  await started;
  await assert.rejects(spool.write(Uint8Array.of(1)), { code: "EBUSY" });
  await assert.rejects(spool.replay()[Symbol.asyncIterator]().next(), { code: "EBUSY" });
  release(); await pending;
  for await (const chunk of spool.replay()) assert.deepEqual(chunk, Uint8Array.of(42));
 } finally { release(); await spool.close(); }
});
