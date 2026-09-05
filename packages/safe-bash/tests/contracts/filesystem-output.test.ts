import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError, type FileSystem, type InvocationCleanup } from "../../src/contracts/index.js";
import { bindFileOutputBudget, openFileOutput } from "../../src/contracts/filesystem-output.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { withFileSystemQuota, FileSystemQuotaError } from "poe-code/safe-fs";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function filesystem(overrides: Partial<FileSystem>): FileSystem {
  const backing = createMemoryFileSystem();
  return new Proxy(backing, {
    get(target, key) {
      if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
      const member: unknown = Reflect.get(target, key);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

for (const reason of [undefined, null, false, 0, "", new FsError("EIO")]) {
  for (const after of [false, true]) {
    test(`output preserves ${String(reason)} failure identity ${after ? "after" : "before"} consumption`, async () => {
      let mutations = 0;
      let active = 0;
      const fs = filesystem({
        async writeStream(_path, source) {
          active++;
          try {
            if (after) { for await (const ignoredChunk of source) throw reason; }
            throw reason;
          } finally { active--; }
        },
        async writeFile() { mutations++; },
        async appendFile() { mutations++; },
      });
      const context = { fs, signal: new AbortController().signal };
      if (after) {
        const target = await openFileOutput(context, "/out", "w");
        await assert.rejects(target.sink.write(Uint8Array.of(1)), error => error === reason);
        await assert.rejects(target.finish(), error => error === reason);
        await target.abort(reason);
      } else await assert.rejects(openFileOutput(context, "/out", "w"), error => error === reason);
      assert.equal(active, 0);
      assert.equal(mutations, 0);
    });
  }
}

test("stream writes are bounded and wait for adapter consumption before advancing", async () => {
  const received = deferred();
  const release = deferred();
  const lengths: number[] = [];
  const fs = filesystem({ async writeStream(_path, source) {
    for await (const chunk of source) {
      lengths.push(chunk.length);
      if (lengths.length === 1) { received.resolve(); await release.promise; }
    }
  } });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w");
  let written = false;
  const writing = target.sink.write(new Uint8Array(200_000)).then(() => { written = true; });
  await received.promise;
  assert.equal(written, false);
  assert.deepEqual(lengths, [65_536]);
  release.resolve();
  await writing;
  await target.finish();
  assert.deepEqual(lengths, [65_536, 65_536, 65_536, 3392]);
});

test("abort and registered cleanup join admitted writer cleanup", async () => {
  const received = deferred();
  const canceled = deferred();
  const release = deferred();
  const controller = new AbortController();
  const reason = new Error("caller aborted");
  let cleanup!: InvocationCleanup;
  let joined = false;
  const fs = filesystem({ async writeStream(_path, source, options) {
    try {
      for await (const ignoredChunk of source) {
        received.resolve();
        await new Promise<void>(resolve => options!.signal!.addEventListener("abort", () => { canceled.resolve(); resolve(); }, { once: true }));
        options!.signal!.throwIfAborted();
      }
    } finally { await release.promise; joined = true; }
  } });
  const target = await openFileOutput({ fs, signal: controller.signal, registerCleanup: callback => { cleanup = callback; } }, "/out", "w");
  const writing = assert.rejects(target.sink.write(Uint8Array.of(1)), error => error === reason);
  await received.promise;
  controller.abort(reason);
  await canceled.promise;
  let closed = false;
  const closing = Promise.resolve(cleanup()).then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  assert.equal(joined, false);
  release.resolve();
  await Promise.all([writing, closing]);
  assert.equal(joined, true);
});

test("unsupported access probe does not reject a supported streaming writer", async () => {
  let received = 0;
  const fs = filesystem({
    async access() { throw new FsError("ENOTSUP"); },
    async writeStream(_path, source) { for await (const chunk of source) received += chunk.length; },
  });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w");
  await target.sink.write(Uint8Array.of(1));
  await target.finish();
  assert.equal(received, 1);
});

test("concurrent writes to a shared descriptor settle and preserve invocation order", { timeout: 1000 }, async () => {
  const bytes: number[] = [];
  const fs = filesystem({ async writeStream(_path, source) { for await (const chunk of source) bytes.push(...chunk); } });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w");
  try {
    await Promise.all([target.sink.write(Uint8Array.of(1)), target.sink.write(Uint8Array.of(2))]);
    await target.finish();
    assert.deepEqual(bytes, [1, 2]);
  } finally { await target.abort(new Error("test cleanup")); }
});

for (const streamingAppend of [true, false, undefined]) {
  for (const streamingWrite of [true, false, undefined]) {
    test(`streaming append admission: append=${streamingAppend}, write=${streamingWrite}`, async () => {
      const bytes: number[] = [];
      let streams = 0;
      const fs = filesystem({
        capabilities: {
          ...(streamingAppend === undefined ? {} : { streamingAppend }),
          ...(streamingWrite === undefined ? {} : { streamingWrite }),
          append: false,
          write: false,
        },
        async writeStream(_path, source, options) {
          streams++;
          assert.equal(options?.flag, "a");
          for await (const chunk of source) bytes.push(...chunk);
        },
        async writeFile() { assert.fail("ordinary writes are forbidden"); },
        async appendFile() { assert.fail("incremental appends are forbidden"); },
      });
      const context = { fs, signal: new AbortController().signal };
      if (streamingAppend === true || streamingAppend === undefined && streamingWrite !== false) {
        const target = await openFileOutput(context, "/out", "a");
        await target.sink.write(Uint8Array.of(195));
        await target.sink.write(Uint8Array.of(169));
        await target.finish();
        assert.equal(streams, 1);
        assert.deepEqual(bytes, [195, 169]);
      } else {
        await assert.rejects(openFileOutput(context, "/out", "a"), error => error instanceof FsError && error.code === "ENOTSUP");
        assert.equal(streams, 0);
        assert.deepEqual(bytes, []);
      }
    });
  }
}

test("incremental append initializes only with appendFile even when writeFile is unsupported", async () => {
  const appended: Uint8Array[] = [];
  const fs = filesystem({
    capabilities: { append: true, write: false, streamingWrite: false },
    async writeFile() { assert.fail("append output must not call writeFile"); },
    async appendFile(_path, bytes) { appended.push(new Uint8Array(bytes)); },
  });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "a");
  await target.sink.write(Uint8Array.of(195));
  await target.sink.write(Uint8Array.of(169));
  await target.finish();
  assert.deepEqual(appended, [new Uint8Array(), Uint8Array.of(195), Uint8Array.of(169)]);
});

test("exclusive stream options forward wx and initial mode with cleanup enrolled first", async () => {
  const backing = createMemoryFileSystem();
  const writeStream = backing.writeStream.bind(backing);
  let cleanup: InvocationCleanup | undefined;
  backing.writeStream = async (path, source, options) => {
    assert.ok(cleanup);
    assert.equal(options?.flag, "wx");
    assert.equal(options.mode, 0o600);
    await writeStream(path, source, options);
  };
  const target = await openFileOutput({ fs: backing, signal: new AbortController().signal,
    registerCleanup: callback => { cleanup = callback; } }, "/out", { flag: "wx", mode: 0o600 });
  await target.sink.write(Uint8Array.of(0, 255, 1));
  await target.finish();
  await cleanup!();
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(0, 255, 1));
  assert.equal((await backing.stat("/out")).mode & 0o777, 0o600);
});

test("exclusive collisions preserve bytes and mode without probing target write access", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/out", Uint8Array.of(7, 8), { mode: 0o444 });
  fs.access = async () => { assert.fail("wx must not require write access to an existing target"); };
  await assert.rejects(openFileOutput({ fs, signal: new AbortController().signal }, "/out", { flag: "wx", mode: 0o600 }), { code: "EEXIST" });
  assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(7, 8));
  assert.equal((await fs.stat("/out")).mode & 0o777, 0o444);
});

for (const exclusiveCreate of [false, undefined]) {
  test(`exclusive streaming requires affirmative capability, received ${exclusiveCreate}`, async () => {
    let attempts = 0;
    const fs = filesystem({ capabilities: { streamingWrite: true, ...(exclusiveCreate === undefined ? {} : { exclusiveCreate }) },
      async writeStream() { attempts++; }, async writeFile() { attempts++; }, async appendFile() { attempts++; } });
    await assert.rejects(openFileOutput({ fs, signal: new AbortController().signal }, "/out", { flag: "wx" }), { code: "ENOTSUP" });
    assert.equal(attempts, 0);
  });
}

for (const missing of [false, true]) {
  test(`exclusive output refuses unavailable streaming without creating then appending: missing=${missing}`, async () => {
    let attempts = 0;
    const backing = filesystem({ capabilities: { exclusiveCreate: true, streamingWrite: missing },
      async writeStream() { attempts++; },
      async writeFile() { attempts++; }, async appendFile() { attempts++; } });
    const fs = new Proxy(backing, { get(target, key) {
      return missing && key === "writeStream" ? undefined : Reflect.get(target, key, target);
    } });
    await assert.rejects(openFileOutput({ fs, signal: new AbortController().signal }, "/out", { flag: "wx", mode: 0o600 }), { code: "ENOTSUP" });
    assert.equal(attempts, 0);
  });
}

test("exclusive ENOTSUP before consumption never downgrades to writeFile plus appendFile", async () => {
  let attempts = 0;
  const fs = filesystem({ capabilities: { exclusiveCreate: true, streamingWrite: true },
    async writeStream() { throw new FsError("ENOTSUP"); },
    async writeFile() { attempts++; }, async appendFile() { attempts++; } });
  await assert.rejects(openFileOutput({ fs, signal: new AbortController().signal }, "/out", { flag: "wx" }), { code: "ENOTSUP" });
  assert.equal(attempts, 0);
});

test("exclusive options use path-specific capabilities rather than unrelated aggregate capabilities", async () => {
  let streams = 0;
  const fs = filesystem({ capabilities: { readOnly: true, exclusiveCreate: false, streamingWrite: false },
    async capabilitiesFor(path) { assert.equal(path, "/out"); return { exclusiveCreate: true, streamingWrite: true }; },
    async writeStream(_path, source, options) {
      streams++; assert.equal(options?.flag, "wx");
      for await (const chunk of source) assert.deepEqual(chunk, Uint8Array.of(2));
    } });
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", { flag: "wx" });
  await target.sink.write(Uint8Array.of(2));
  await target.finish();
  assert.equal(streams, 1);
});

test("exclusive and mode-bearing requests cannot silently use an uninformed incremental callback", async () => {
  const fs = createMemoryFileSystem();
  for (const options of [{ flag: "wx" }, { flag: "w", mode: 0o600 }, { flag: "a", mode: 0o600 }] as const) {
    let attempts = 0;
    await assert.rejects(openFileOutput({ fs, signal: new AbortController().signal }, "/out", options,
      async () => { attempts++; return { async write() {} }; }), { code: "ENOTSUP" });
    assert.equal(attempts, 0);
    await assert.rejects(fs.stat("/out"), { code: "ENOENT" });
  }
});

for (const flag of ["w", "a"] as const) {
  for (const streamingWrite of [true, false]) {
    test(`ordinary options preserve ${flag} mode in streaming=${streamingWrite} path`, async () => {
      const fs = createMemoryFileSystem();
      const scoped = new Proxy(fs, { get(target, key) {
        if (key === "capabilities") return { ...target.capabilities, streamingWrite, streamingAppend: streamingWrite };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const target = await openFileOutput({ fs: scoped, signal: new AbortController().signal }, "/out", { flag, mode: 0o600 });
      await target.sink.write(Uint8Array.of(3));
      await target.finish();
      assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(3));
      assert.equal((await fs.stat("/out")).mode & 0o777, 0o600);
    });
  }
}

test("exclusive stream still charges the same enrolled sink budget before payload consumption", async () => {
  let received = 0, reserved = 0;
  const reason = new Error("shared output allowance exhausted");
  const fs = filesystem({ capabilities: { exclusiveCreate: true, streamingWrite: true },
    async writeStream(_path, source) { for await (const chunk of source) received += chunk.length; } });
  const cleanups: InvocationCleanup[] = [];
  const context = { fs, signal: new AbortController().signal, registerCleanup: (cleanup: InvocationCleanup) => { cleanups.push(cleanup); } };
  bindFileOutputBudget(context, sink => ({ async write(chunk) {
    if (reserved + chunk.length > 2) throw reason;
    reserved += chunk.length;
    await sink.write(chunk);
  } }));
  const target = await openFileOutput(context, "/out", { flag: "wx", mode: 0o600 });
  await target.sink.write(Uint8Array.of(1, 2));
  await assert.rejects(target.sink.write(Uint8Array.of(3)), error => error === reason);
  await target.abort(reason);
  for (const cleanup of cleanups) await cleanup();
  assert.equal(received, 2);
  assert.equal(reserved, 2);
});

test("exclusive stream keeps quota enforcement and does not require canonical descriptors", async () => {
  const backing = createMemoryFileSystem();
  const fs = withFileSystemQuota(backing, { maxBytes: 2 });
  assert.equal(fs.capabilities.open, false);
  const context = { fs, signal: new AbortController().signal };
  const target = await openFileOutput(context, "/out", { flag: "wx", mode: 0o600 });
  await target.sink.write(Uint8Array.of(1, 2));
  await target.finish();
  assert.equal((await backing.stat("/out")).mode & 0o777, 0o600);
  const excessive = await openFileOutput(context, "/extra", { flag: "wx", mode: 0o600 });
  await assert.rejects(excessive.sink.write(Uint8Array.of(3)), FileSystemQuotaError);
  await assert.rejects(excessive.finish(), FileSystemQuotaError);
  await excessive.abort(new Error("finished failed output"));
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(1, 2));
  assert.equal((await backing.stat("/extra")).size, 0);
});

test("exclusive stream cancellation preserves falsey reason and joins admitted provider cleanup", async () => {
  const entered = deferred(), aborted = deferred(), release = deferred();
  const controller = new AbortController();
  let cleanup!: InvocationCleanup;
  let released = false;
  const fs = filesystem({ capabilities: { exclusiveCreate: true, streamingWrite: true },
    async writeStream(_path, source, options) {
      assert.ok(cleanup);
      assert.equal(options?.flag, "wx");
      try {
        for await (const chunk of source) {
          assert.deepEqual(chunk, Uint8Array.of(9));
          entered.resolve();
          await new Promise<void>(resolve => options.signal!.addEventListener("abort", () => { aborted.resolve(); resolve(); }, { once: true }));
          options.signal!.throwIfAborted();
        }
      } finally { await release.promise; released = true; }
    } });
  const target = await openFileOutput({ fs, signal: controller.signal, registerCleanup: callback => { cleanup = callback; } }, "/out", { flag: "wx", mode: 0o600 });
  const writing = assert.rejects(target.sink.write(Uint8Array.of(9)), reason => reason === 0);
  await entered.promise;
  controller.abort(0);
  await aborted.promise;
  let settled = false;
  const closing = Promise.resolve(cleanup()).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(released, false);
  release.resolve();
  await Promise.all([writing, closing]);
  assert.equal(released, true);
});
