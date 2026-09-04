import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError, type FileSystem, type InvocationCleanup } from "../../src/contracts/index.js";
import { openFileOutput } from "../../src/contracts/filesystem-output.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

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
        capabilities: { streamingAppend, streamingWrite, append: false, write: false },
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
