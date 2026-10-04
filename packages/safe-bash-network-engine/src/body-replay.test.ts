import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { type CommandContext } from "safe-bash-contracts";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { createBody } from "./body.js";
import { type CurlArguments } from "./args.js";
import { defaultNetworkLimits } from "./types.js";

test("stdin replay uses caller staging beyond the buffer quota and cleans up", async () => {
 const backing = new MemoryFileSystem();
 let staged = 0;
 let outstanding = 0;
 let peak = 0;
 const fs = new Proxy(backing, { get(target, key) {
 if (key === "readFile") return async () => { throw new Error("payload-wide read forbidden"); };
 if (key === "createStagedFile") return async (...args: Parameters<typeof backing.createStagedFile>) => {
  staged++;
  const result = await target.createStagedFile(...args);
  const write = result.writer!.write.bind(result.writer);
  return { ...result, writer: { ...result.writer!, write: async (...[bytes, options]: Parameters<typeof write>) => {
   outstanding += bytes.length;
   peak = Math.max(peak, outstanding);
   await Promise.resolve();
   await write(bytes, options);
   outstanding -= bytes.length;
  } } };
 };
 const value: unknown = Reflect.get(target, key);
 return typeof value === "function" ? value.bind(target) : value;
 } });
 const signal = new AbortController().signal;
 const stdin = async function* () {
  const reused = new Uint8Array(32768);
  for (let i = 0; i < 16; i++) { reused.fill(i); yield reused; }
 };
 const context: CommandContext = { fs, cwd: "/", stdin: stdin(), signal, command: "curl", args: [], env: {}, stdout: { async write() {} }, stderr: { async write() {} } };
 const body = createBody(context, { data: [], upload: "-" } as unknown as CurlArguments,
  { ...defaultNetworkLimits, maxBufferBytes: 1024 })!;
 for (let attempt = 0; attempt < 3; attempt++) {
  let position = 0;
  for await (const bytes of body.open(signal)) {
   assert.ok(bytes.length <= 16384);
   for (const byte of bytes) assert.equal(byte, Math.floor(position++ / 32768));
   bytes.fill(255);
  }
  assert.equal(position, 16 * 32768);
 }
 assert.equal(staged, 1);
 assert.ok(peak > 0 && peak <= 16384);
 await body.close();
 assert.deepEqual(await fs.readdir("/"), []);
});

function request(fs: CommandContext["fs"], signal = new AbortController().signal) {
 const context: CommandContext = { fs, cwd: "/", signal, stdin: (async function* () { yield new Uint8Array(32768).fill(42); })(), command: "curl", args: [], env: {}, stdout: { async write() {} }, stderr: { async write() {} } };
 return createBody(context, { data: [], upload: "-" } as unknown as CurlArguments, defaultNetworkLimits)!;
}

test("large stdin replay yields to cancellation and releases staging", async () => {
 const fs = new MemoryFileSystem();
 const signal = new AbortController().signal;
 const stdin = async function* () {
  const chunk = new Uint8Array(16384);
  for (let i = 0; i < 512; i++) yield chunk;
 };
 const context: CommandContext = { fs, cwd: "/", signal, stdin: stdin(), command: "curl", args: [], env: {}, stdout: { async write() {} }, stderr: { async write() {} } };
 const body = createBody(context, { data: [], upload: "-" } as unknown as CurlArguments, defaultNetworkLimits)!;
 const controller = new AbortController();
 const reason = new Error("replay cancelled");
 let consumed = 0;
 let scheduled: ReturnType<typeof setImmediate> | undefined;
 try {
  for await (const bytes of body.open(signal)) consumed += bytes.length;
  assert.equal(consumed, 8 * 1024 * 1024);
  consumed = 0;
  scheduled = setImmediate(() => controller.abort(reason));
  await assert.rejects(async () => {
   for await (const bytes of body.open(controller.signal)) consumed += bytes.length;
  }, error => error === reason);
  assert.ok(consumed > 0 && consumed < 8 * 1024 * 1024);
 } finally {
  if (scheduled !== undefined) clearImmediate(scheduled);
  await body.close();
 }
 assert.deepEqual(await fs.readdir("/"), []);
});

test("upload lifetime preserves caller budget checkpoints", async () => {
 const fs = new MemoryFileSystem();
 const signal = new AbortController().signal;
 const exhausted = new Error("upload budget exhausted");
 registerYieldCheckpoint(signal, () => { throw exhausted; });
 const stdin = async function* () {
  for (let i = 0; i < 256; i++) yield new Uint8Array([42]);
 };
 const context: CommandContext = { fs, cwd: "/", signal, stdin: stdin(), command: "curl", args: [], env: {}, stdout: { async write() {} }, stderr: { async write() {} } };
 const body = createBody(context, { data: [], upload: "-" } as unknown as CurlArguments, defaultNetworkLimits)!;
 try {
  await assert.rejects(async () => {
   for await (const bytes of body.open(signal)) void bytes;
  }, error => error === exhausted);
 } finally { await body.close(); }
 assert.deepEqual(await fs.readdir("/"), []);
});

for (const failure of ["write", "finish", "read", "identity"] as const) {
 test(`replay ${failure} failure preserves first upload and cleans caller staging`, async () => {
  const backing = new MemoryFileSystem();
  const fs = new Proxy(backing, { get(target, key) {
   if (key === "createStagedFile") return async (...args: Parameters<typeof backing.createStagedFile>) => {
    const stage = await target.createStagedFile(...args);
    return { ...stage, writer: { ...stage.writer!,
     write: async (...params: Parameters<NonNullable<typeof stage.writer>["write"]>) => {
      if (failure === "write") throw new Error("write failed");
      return stage.writer!.write(...params);
     },
     finish: async (...params: Parameters<NonNullable<typeof stage.writer>["finish"]>) => {
      if (failure === "finish") throw new Error("finish failed");
      return stage.writer!.finish(...params);
     },
    } };
   };
   if (key === "openReadFile") return async (...args: Parameters<typeof backing.openReadFile>) => {
    const reader = await target.openReadFile(...args);
    return { ...reader,
     read: async (...params: Parameters<typeof reader.read>) => {
      if (failure === "read") throw new Error("read failed");
      return reader.read(...params);
     },
     stat: async (...params: Parameters<typeof reader.stat>) => {
      const stat = await reader.stat(...params);
      return failure === "identity" ? { ...stat, opaqueIdentity: "replacement", ino: -1 } : stat;
     },
    };
   };
   const value: unknown = Reflect.get(target, key);
   return typeof value === "function" ? value.bind(target) : value;
  } });
  const body = request(fs);
  let bytes = 0;
  for await (const chunk of body.open(new AbortController().signal)) bytes += chunk.length;
  assert.equal(bytes, 32768);
  await assert.rejects(async () => { for await (const chunk of body.open(new AbortController().signal)) void chunk; }, { exitCode: 65 });
  await body.close();
  await body.close();
  assert.deepEqual(await backing.readdir("/"), []);
 });
}

test("partial stdin cannot replay and cancellation removes staging", async () => {
 const fs = new MemoryFileSystem();
 const controller = new AbortController();
 const body = request(fs, controller.signal);
 const iterator = body.open(controller.signal)[Symbol.asyncIterator]();
 await iterator.next();
 await iterator.return?.();
 await assert.rejects(body.open(controller.signal)[Symbol.asyncIterator]().next(), { exitCode: 65 });
 controller.abort(new Error("cancelled"));
 await assert.rejects(body.open(controller.signal)[Symbol.asyncIterator]().next(), /cancelled/);
 await body.close();
 assert.deepEqual(await fs.readdir("/"), []);
});

test("closing an upload suspended at a yield releases its staging", async () => {
 const fs = new MemoryFileSystem();
 const body = request(fs);
 const iterator = body.open(new AbortController().signal)[Symbol.asyncIterator]();
 await iterator.next();
 await body.close();
 assert.deepEqual(await fs.readdir("/"), []);
 assert.equal((await iterator.next()).done, true);
});

test("large generated replay has bounded outstanding bytes without RAM payload storage", async () => {
 const backing = new MemoryFileSystem();
 let storedBytes = 0, outstanding = 0, peak = 0, reads = 0;
 let file = "";
 let sealed: Awaited<ReturnType<typeof backing.stat>>;
 const fs = new Proxy(backing, { get(target, key) {
  if (key === "readFile" || key === "writeFile" || key === "appendFile") return () => { throw new Error("whole payload API forbidden"); };
  if (key === "createStagedFile") return async (...args: Parameters<typeof backing.createStagedFile>) => {
   const stage = await target.createStagedFile(...args);
   file = stage.file.path;
   return { ...stage, writer: {
    async write(bytes: Uint8Array) {
     outstanding += bytes.length;
     peak = Math.max(peak, outstanding);
     assert.ok(bytes.length <= 16384);
     assert.ok(bytes.every(byte => byte === 42));
     await new Promise<void>(resolve => queueMicrotask(resolve));
     storedBytes += bytes.length;
     outstanding -= bytes.length;
    },
    async finish() { sealed = { ...await target.stat(file), size: storedBytes }; return sealed; },
   } };
  };
  if (key === "openReadFile") return async () => ({
   async stat() { return sealed; },
   async read(_position: number, length: number) { reads++; assert.ok(length <= 16384); return new Uint8Array(length).fill(42); },
   async close() {},
  });
  const value: unknown = Reflect.get(target, key);
  return typeof value === "function" ? value.bind(target) : value;
 } });
 const signal = new AbortController().signal;
 const stdin = async function* () { const reused = new Uint8Array(32768).fill(42); for (let i = 0; i < 256; i++) yield reused; };
 const context: CommandContext = { fs, cwd: "/", signal, stdin: stdin(), command: "curl", args: [], env: {}, stdout: { async write() {} }, stderr: { async write() {} } };
 const body = createBody(context, { data: [], upload: "-" } as unknown as CurlArguments, defaultNetworkLimits)!;
 for (let attempt = 0; attempt < 2; attempt++) {
  let consumed = 0;
  for await (const bytes of body.open(signal)) { consumed += bytes.length; await Promise.resolve(); }
  assert.equal(consumed, 8 * 1024 * 1024);
 }
 assert.equal((await backing.stat(file)).size, 0, "fixture must not retain payload bytes in RAM");
 assert.equal(storedBytes, 8 * 1024 * 1024);
 assert.equal(peak, 16384);
 assert.equal(outstanding, 0);
 assert.equal(reads, 512);
 await body.close();
 assert.deepEqual(await backing.readdir("/"), []);
});
