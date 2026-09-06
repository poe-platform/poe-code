import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../../safe-fs/src/fs/memory/index.js";
import { CommandRegistry, FsError, type FileSystem, type InvocationCleanup } from "../../src/contracts/index.js";
import { openFileOutput } from "../../src/contracts/filesystem-output.js";
import { Shell } from "../../src/shell/index.js";

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 32 && !predicate(); turn++) await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(predicate(), true, "bounded descriptor output checkpoint not reached");
}

function filesystem(overrides: Partial<FileSystem>): FileSystem {
  const backing = new MemoryFileSystem();
  return new Proxy(backing, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    if (key === "access") return async () => {};
    const member: unknown = Reflect.get(target, key, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
}

for (const flag of ["w", "a"] as const) for (const chunkSize of [1, 8]) test(`positive descriptor stream bypasses supplied incremental fallback: ${flag}, 32 bytes/${chunkSize}`, async () => {
  const output: number[] = [];
  let streams = 0;
  let fallbacks = 0;
  let writes = 0;
  const fs = filesystem({
    capabilities: { descriptorWriteStream: true, streamingWrite: true, streamingAppend: true, write: true, append: true },
    async writeStream(_path, source, options) {
      streams++;
      assert.equal(options?.flag, flag);
      for await (const chunk of source) { writes++; output.push(...chunk); }
    },
  });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", flag, async () => {
    fallbacks++;
    return { async write(chunk) { writes++; output.push(...chunk); } };
  });
  const reused = new Uint8Array(chunkSize);
  try {
    for (let offset = 0; offset < 32; offset += chunkSize) {
      for (let index = 0; index < chunkSize; index++) reused[index] = offset + index;
      await target.sink.write(reused);
      reused.fill(255);
    }
    await target.finish();
    assert.equal(streams, 1);
    assert.equal(fallbacks, 0);
    assert.equal(writes, 32 / chunkSize);
    assert.deepEqual(output, Array.from({ length: 32 }, (_, index) => index));
  } finally { await target.abort(new Error("test cleanup")); }
});

for (const descriptorWriteStream of [false, undefined]) test(`nonpositive descriptor capability preserves supplied fallback: ${String(descriptorWriteStream)}`, async () => {
  let streams = 0;
  let fallbacks = 0;
  const output: number[] = [];
  const capabilities = { streamingWrite: true, write: true, append: true, ...(descriptorWriteStream === undefined ? {} : { descriptorWriteStream }) };
  const fs = filesystem({ capabilities, async writeStream() { streams++; assert.fail("unadmitted descriptor stream"); } });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w", async () => {
    fallbacks++;
    return { async write(chunk) { output.push(...chunk); } };
  });
  await target.sink.write(Uint8Array.of(65));
  await target.finish();
  assert.equal(streams, 0);
  assert.equal(fallbacks, 1);
  assert.deepEqual(output, [65]);
});

for (const flag of ["w", "a"] as const) test(`descriptor opt-in does not override disabled ${flag} streaming`, async () => {
  let streams = 0;
  let fallbacks = 0;
  const fs = filesystem({
    capabilities: { descriptorWriteStream: true, streamingWrite: flag === "a", streamingAppend: false, write: true, append: true },
    async writeStream() { streams++; },
  });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", flag, async () => { fallbacks++; return { async write() {} }; });
  await target.finish();
  assert.equal(streams, 0);
  assert.equal(fallbacks, 1);
});

for (const selected of [false, true]) test(`selected path descriptor capability overrides aggregate ${!selected}`, async () => {
  let streams = 0;
  let fallbacks = 0;
  const fs = filesystem({
    capabilities: { descriptorWriteStream: !selected, streamingWrite: true },
    async capabilitiesFor(path) { assert.equal(path, "/out"); return { descriptorWriteStream: selected, streamingWrite: true }; },
    async writeStream(_path, source) { streams++; for await (const chunk of source) assert.equal(chunk.length, 1); },
  });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w", async () => { fallbacks++; return { async write() {} }; });
  await target.sink.write(Uint8Array.of(1));
  await target.finish();
  assert.equal(streams, Number(selected));
  assert.equal(fallbacks, Number(!selected));
});

for (const iteratorOnly of [false, true]) test(`descriptor ENOTSUP before reading permits supplied fallback: iteratorOnly=${iteratorOnly}`, async () => {
  let streams = 0;
  let fallbacks = 0;
  const output: number[] = [];
  const fs = filesystem({
    capabilities: { descriptorWriteStream: true, streamingWrite: true },
    async writeStream(_path, source) { streams++; if (iteratorOnly) source[Symbol.asyncIterator](); throw new FsError("ENOTSUP"); },
  });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w", async () => { fallbacks++; return { async write(chunk) { output.push(...chunk); } }; });
  await target.sink.write(Uint8Array.of(1, 2));
  await target.finish();
  assert.equal(streams, 1);
  assert.equal(fallbacks, 1);
  assert.deepEqual(output, [1, 2]);
});

for (const reason of [new FsError("ENOTSUP"), undefined, null, false, 0, "", NaN]) test(`descriptor failure after reading never replays or changes identity: ${String(reason)}`, async () => {
  const release = deferred();
  let fallbacks = 0;
  let cleaning = false;
  let joined = false;
  const output: number[] = [];
  const fs = filesystem({
    capabilities: { descriptorWriteStream: true, streamingWrite: true },
    async writeStream(_path, source) {
      try { for await (const chunk of source) { output.push(...chunk); throw reason; } }
      finally { cleaning = true; await release.promise; joined = true; }
    },
  });
  const cleanups: InvocationCleanup[] = [];
  const target = await openFileOutput({ fs, signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); } }, "/out", "w", async () => { fallbacks++; return { async write(chunk) { output.push(...chunk); } }; });
  let settled = false;
  const writing = target.sink.write(Uint8Array.of(65));
  void writing.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => cleaning || settled);
    assert.equal(cleaning, true);
    assert.equal(settled, false);
    release.resolve();
    await assert.rejects(writing, error => Object.is(error, reason));
    await assert.rejects(target.finish(), error => Object.is(error, reason));
    await Promise.all(cleanups.map(cleanup => cleanup()));
    assert.equal(joined, true);
    assert.equal(fallbacks, 0);
    assert.deepEqual(output, [65]);
    assert.equal(cleanups.length, 1);
  } finally { release.resolve(); await writing.catch(() => {}); await target.abort(new Error("test cleanup")); }
});

for (const reason of [undefined, null, false, 0, "", NaN]) test(`descriptor stream caller cancellation joins admitted cleanup: ${String(reason)}`, async () => {
  const controller = new AbortController();
  const release = deferred();
  const entered = deferred();
  let cleanup!: InvocationCleanup;
  let joined = false;
  let streams = 0;
  const fs = filesystem({
    capabilities: { descriptorWriteStream: true, streamingWrite: true },
    async writeStream(_path, source, options) {
      streams++;
      try { for await (const chunk of source) {
        assert.equal(chunk.length, 1);
        const cancelled = new Promise<void>(resolve => { options!.signal!.addEventListener("abort", () => { resolve(); }, { once: true }); });
        entered.resolve();
        await cancelled;
        options!.signal!.throwIfAborted();
      } } finally { await release.promise; joined = true; }
    },
  });
  const target = await openFileOutput({ fs, signal: controller.signal, registerCleanup: callback => { cleanup = callback; } }, "/out", "w", async () => ({ async write() { entered.resolve(); } }));
  const writing = target.sink.write(Uint8Array.of(65));
  void writing.catch(() => {});
  try {
    await entered.promise;
    assert.equal(streams, 1);
    controller.abort(reason);
    let closed = false;
    const closing = Promise.resolve(cleanup()).then(() => { closed = true; });
    await Promise.resolve();
    assert.equal(closed, false);
    assert.equal(joined, false);
    release.resolve();
    await closing;
    await assert.rejects(writing, error => Object.is(error, controller.signal.reason));
    assert.equal(joined, true);
  } finally { controller.abort(reason); release.resolve(); await writing.catch(() => {}); await target.abort(controller.signal.reason); }
});

test("descriptor stream chunk acknowledgement preserves backpressure and producer reuse", async () => {
  const entered = deferred();
  const release = deferred();
  const bytes: number[] = [];
  const fs = filesystem({
    capabilities: { descriptorWriteStream: true, streamingWrite: true },
    async writeStream(_path, source) { for await (const chunk of source) { entered.resolve(); await release.promise; bytes.push(...chunk); } },
  });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w", async () => ({ async write() { entered.resolve(); } }));
  const borrowed = Uint8Array.of(0, 255, 128);
  let settled = false;
  const writing = target.sink.write(borrowed).then(() => { settled = true; });
  try {
    await entered.promise;
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false);
    release.resolve();
    await writing;
    borrowed.fill(1);
    await target.finish();
    assert.deepEqual(bytes, [0, 255, 128]);
  } finally { release.resolve(); await writing.catch(() => {}); await target.abort(new Error("test cleanup")); }
});

async function memoryTraffic(chunkSize: number, admitted: boolean) {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/out", new Uint8Array());
  const calls = { stat: 0, appendFile: 0, writeFile: 0, writeStream: 0 };
  const fs = new Proxy(memory, { get(target, key) {
    if (key === "capabilities" && !admitted) return { ...target.capabilities, descriptorWriteStream: false };
    const member: unknown = Reflect.get(target, key, target);
    if (typeof member !== "function") return member;
    return (...args: unknown[]) => {
      if (Object.hasOwn(calls, key)) calls[key as keyof typeof calls]++;
      return Reflect.apply(member, target, args);
    };
  } });
  const borrowed = new Uint8Array(chunkSize);
  const commands = new CommandRegistry([{ name: "emit", async execute(context) {
    for (let offset = 0; offset < 32; offset += chunkSize) {
      for (let index = 0; index < chunkSize; index++) borrowed[index] = offset + index;
      await context.stdout.write(borrowed);
      borrowed.fill(255);
    }
    return { exitCode: 0 };
  } }]);
  const shell = new Shell({ fs, commands });
  const NativeUint8Array = Uint8Array;
  const nativeSet = NativeUint8Array.prototype.set;
  const nativeSlice = NativeUint8Array.prototype.slice;
  let copiedBytes = 0;
  globalThis.Uint8Array = new Proxy(NativeUint8Array, { construct(target, args) {
    if (args[0] instanceof NativeUint8Array) copiedBytes += args[0].byteLength;
    return Reflect.construct(target, args);
  } });
  NativeUint8Array.prototype.set = function (source, offset) { copiedBytes += source.length; nativeSet.call(this, source, offset); };
  NativeUint8Array.prototype.slice = function (start, end) { const result = nativeSlice.call(this, start, end); copiedBytes += result.byteLength; return result; };
  try {
    const result = await shell.exec("emit > /out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
  } finally { globalThis.Uint8Array = NativeUint8Array; NativeUint8Array.prototype.set = nativeSet; NativeUint8Array.prototype.slice = nativeSlice; await shell.dispose(); }
  assert.deepEqual(await memory.readFile("/out"), Uint8Array.from({ length: 32 }, (_, index) => index));
  return { calls, copiedBytes };
}

for (const chunkSize of [1, 8]) test(`genuine Memory Shell descriptor avoids per-chunk EOF probes and mirror copies: 32/${chunkSize}`, async context => {
  const legacy = await memoryTraffic(chunkSize, false);
  const descriptor = await memoryTraffic(chunkSize, true);
  assert.equal(legacy.calls.stat - descriptor.calls.stat, 32 / chunkSize);
  assert.equal(legacy.calls.appendFile, 32 / chunkSize);
  assert.equal(legacy.calls.writeFile, 1);
  assert.equal(legacy.calls.writeStream, 0);
  assert.equal(descriptor.calls.appendFile, 0);
  assert.equal(descriptor.calls.writeFile, 0);
  assert.equal(descriptor.calls.writeStream, 1);
  assert.ok(descriptor.copiedBytes < legacy.copiedBytes, `descriptor copies ${descriptor.copiedBytes}, legacy ${legacy.copiedBytes}`);
  context.diagnostic(JSON.stringify({ chunkSize, legacy, descriptor }));
});

for (const flag of [">", ">>"]) test(`actual Shell ${flag} descriptor pins its resource and respects external append/truncate`, async () => {
  const fs = new MemoryFileSystem();
  const encode = (text: string) => new TextEncoder().encode(text);
  await fs.writeFile("/out", encode("seed"));
  const commands = new CommandRegistry([{ name: "interleave", async execute(context) {
    await context.stdout.write(encode("ab"));
    assert.equal(new TextDecoder().decode(await fs.readFile("/out")), flag === ">" ? "ab" : "seedab");
    await fs.appendFile("/out", encode("XY"));
    await context.stdout.write(encode("c"));
    assert.equal(new TextDecoder().decode(await fs.readFile("/out")), flag === ">" ? "abcY" : "seedabXYc");
    await fs.truncate("/out", 1);
    await context.stdout.write(encode("d"));
    assert.deepEqual(await fs.readFile("/out"), flag === ">" ? Uint8Array.of(97, 0, 0, 100) : encode("sd"));
    await fs.rename("/out", "/old");
    await fs.writeFile("/out", encode("replacement"));
    await context.stdout.write(encode("e"));
    assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "replacement");
    assert.deepEqual(await fs.readFile("/old"), flag === ">" ? Uint8Array.of(97, 0, 0, 100, 101) : encode("sde"));
    return { exitCode: 0 };
  } }]);
  const shell = new Shell({ fs, commands });
  try {
    const result = await shell.exec(`interleave ${flag} /out`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("actual Shell descriptor duplicates share offsets while nested opens retain independent offsets", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/out", new Uint8Array());
  const commands = new CommandRegistry([{ name: "put", async execute(context) { await context.stdout.write(new TextEncoder().encode(context.args[0])); return { exitCode: 0 }; } }]);
  const shell = new Shell({ fs, commands });
  try {
    const result = await shell.exec("{ put abc >&3; put XY > /out; put Z >&4; } 3> /out 4>&3");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(88, 89, 0, 90));
  } finally { await shell.dispose(); }
});

for (const chunkSize of [1, 8]) test(`randomAccessWrite false remains generic streaming without EOF-probe traffic: 32/${chunkSize}`, async () => {
  const output: number[] = [];
  let stats = 0;
  let streams = 0;
  const fs = filesystem({
    capabilities: { randomAccessWrite: false, descriptorWriteStream: false, streamingWrite: true },
    async stat() { stats++; return { type: "directory", size: 0, mode: 0o755, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 }; },
    async writeFile() { assert.fail("generic stream must not use positional overwrite"); },
    async appendFile() { assert.fail("generic stream must not use per-chunk append"); },
    async writeStream(_path, source) { streams++; for await (const chunk of source) output.push(...chunk); },
  });
  const commands = new CommandRegistry([{ name: "emit", async execute(context) {
    const borrowed = new Uint8Array(chunkSize).fill(65);
    for (let offset = 0; offset < 32; offset += chunkSize) await context.stdout.write(borrowed);
    return { exitCode: 0 };
  } }]);
  const shell = new Shell({ fs, commands });
  try {
    const result = await shell.exec("emit > /out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(streams, 1);
    assert.ok(stats <= 1);
    assert.deepEqual(output, Array<number>(32).fill(65));
  } finally { await shell.dispose(); }
});

for (const reason of [new FsError("EPIPE"), false, 0]) test(`descriptor writer failure closes its downstream capability between writes: ${String(reason)}`, async () => {
  const release = deferred();
  let fallbacks = 0;
  const fs = filesystem({
    capabilities: { descriptorWriteStream: true, streamingWrite: true },
    async writeStream(_path, source) {
      const iterator = source[Symbol.asyncIterator]();
      assert.equal((await iterator.next()).done, false);
      const pending = iterator.next();
      void pending.catch(() => {});
      await release.promise;
      throw reason;
    },
  });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w", async () => { fallbacks++; return { async write() {} }; });
  try {
    await target.sink.write(Uint8Array.of(65));
    release.resolve();
    await until(() => target.sink.ownedOutput!.consumerClosed.aborted);
    assert.equal(target.sink.ownedOutput!.consumerClosed.reason, reason);
    await assert.rejects(target.sink.write(Uint8Array.of(66)), error => error === reason);
    await assert.rejects(target.finish(), error => error === reason);
    assert.equal(fallbacks, 0);
  } finally { release.resolve(); await target.abort(new Error("test cleanup")); }
});

test("descriptor opt-in preserves one startup task subscription and no per-chunk reactions", async () => {
  const race = Object.getOwnPropertyDescriptor(Promise, "race")!;
  const then = Object.getOwnPropertyDescriptor(Promise.prototype, "then")!;
  let task: Promise<unknown> | undefined;
  let subscriptions = 0;
  Object.defineProperty(Promise, "race", { ...race, value: function (this: PromiseConstructor, values: Iterable<unknown>) {
    const entries = Array.from(values);
    if (!task) { assert.equal(entries.length, 2); task = entries[1] as Promise<unknown>; }
    return Reflect.apply(race.value, this, [entries]);
  } });
  Object.defineProperty(Promise.prototype, "then", { ...then, value: function (this: Promise<unknown>, ...handlers: Parameters<Promise<unknown>["then"]>) {
    if (this === task) subscriptions++;
    return Reflect.apply(then.value, this, handlers);
  } });
  let target: Awaited<ReturnType<typeof openFileOutput>> | undefined;
  let writes = 0;
  try {
    const fs = filesystem({ capabilities: { descriptorWriteStream: true, streamingWrite: true }, async writeStream(_path, source) { for await (const chunk of source) { assert.equal(chunk.length, 1); writes++; } } });
    target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w", async () => ({ async write() { assert.fail("descriptor fallback"); } }));
    const initial = subscriptions;
    assert.equal(initial, 1);
    for (let index = 0; index < 32; index++) await target.sink.write(Uint8Array.of(index));
    assert.equal(subscriptions, initial);
    assert.equal(writes, 32);
    await target.finish();
  } finally { Object.defineProperty(Promise, "race", race); Object.defineProperty(Promise.prototype, "then", then); await target?.abort(new Error("test cleanup")); }
});
