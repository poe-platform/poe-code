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

async function observeTaskSubscriptions(action: (subscriptions: () => number) => Promise<void>): Promise<void> {
  const raceDescriptor = Object.getOwnPropertyDescriptor(Promise, "race")!;
  const thenDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, "then")!;
  let task: Promise<unknown> | undefined;
  let subscriptions = 0;
  Object.defineProperty(Promise, "race", { ...raceDescriptor, value: function(this: PromiseConstructor, values: Iterable<unknown>) {
    const entries = [...values];
    if (!task) {
      assert.equal(entries.length, 2);
      assert.ok(entries[1] instanceof Promise);
      task = entries[1];
    }
    return Reflect.apply(raceDescriptor.value, this, [entries]);
  } });
  Object.defineProperty(Promise.prototype, "then", { ...thenDescriptor, value: function(this: Promise<unknown>, ...handlers: Parameters<Promise<unknown>["then"]>) {
    if (this === task) subscriptions++;
    return Reflect.apply(thenDescriptor.value, this, handlers);
  } });
  try {
    await action(() => {
      assert.ok(task, "the startup race identifies the writer task without subscribing to it");
      return subscriptions;
    });
  } finally {
    Object.defineProperty(Promise, "race", raceDescriptor);
    Object.defineProperty(Promise.prototype, "then", thenDescriptor);
  }
}

for (const streaming of [true, false]) {
  for (const byteCount of [8, 16]) {
    for (const chunkSize of [1, byteCount]) {
      test(`writer task subscriptions stay constant: streaming=${streaming}, bytes=${byteCount}, chunk=${chunkSize}`, async () => {
        await observeTaskSubscriptions(async subscriptions => {
          const received: number[] = [];
          let writerReturned = false;
          const fs = filesystem({
            capabilities: { streamingWrite: streaming, write: true, append: true },
            async writeFile(_path, bytes) { assert.equal(bytes.length, 0); },
            async appendFile(_path, bytes) { received.push(...bytes); },
            async writeStream(_path, source) {
              assert.equal(streaming, true);
              try { for await (const bytes of source) received.push(...bytes); }
              finally { writerReturned = true; }
            },
          });
          const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w");
          try {
            const initial = subscriptions();
            assert.equal(initial, 1);
            const borrowed = new Uint8Array(chunkSize).fill(65);
            for (let offset = 0; offset < byteCount; offset += chunkSize) await target.sink.write(borrowed);
            borrowed.fill(0);
            assert.deepEqual(received, Array<number>(byteCount).fill(65));
            assert.equal(writerReturned, false);
            assert.equal(subscriptions() - initial, 0, "writes must not subscribe to the pending writer task");
            await target.finish();
            assert.equal(writerReturned, streaming);
          } finally { await target.abort(new Error("test cleanup")); }
        });
      });
    }
  }

  test(`slice boundary retains acknowledgment backpressure without task reactions: streaming=${streaming}`, async () => {
    await observeTaskSubscriptions(async subscriptions => {
      const received = deferred();
      const release = deferred();
      const lengths: number[] = [];
      const consume = async (bytes: Uint8Array): Promise<void> => {
        lengths.push(bytes.length);
        if (lengths.length === 1) { received.resolve(); await release.promise; }
        assert.equal(bytes[0], 65);
        assert.equal(bytes.at(-1), 65);
      };
      const fs = filesystem({
        capabilities: { streamingWrite: streaming, write: true, append: true },
        async writeFile() {},
        appendFile: (_path, bytes) => consume(bytes),
        async writeStream(_path, source) { for await (const bytes of source) await consume(bytes); },
      });
      const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w");
      const initial = subscriptions();
      const borrowed = new Uint8Array(65_537).fill(65);
      let written = false;
      const writing = target.sink.write(borrowed).then(() => { written = true; });
      try {
        await received.promise;
        assert.equal(written, false);
        assert.deepEqual(lengths, [65_536]);
        release.resolve();
        await writing;
        borrowed.fill(0);
        assert.deepEqual(lengths, [65_536, 1]);
        assert.equal(subscriptions() - initial, 0);
        await target.finish();
      } finally { release.resolve(); await target.abort(new Error("test cleanup")); }
    });
  });

  for (const reason of [undefined, null, false, 0, "", new FsError("EIO")]) {
    test(`parent cancellation joins held writer cleanup: streaming=${streaming}, reason=${String(reason)}`, async () => {
      const controller = new AbortController();
      const received = deferred();
      const canceled = deferred();
      const release = deferred();
      let cleanup!: InvocationCleanup;
      let joined = false;
      const consume = async (signal: AbortSignal): Promise<void> => {
        try {
          const aborted = new Promise<void>(resolve => signal.addEventListener("abort", () => { canceled.resolve(); resolve(); }, { once: true }));
          received.resolve();
          await aborted;
          signal.throwIfAborted();
        } finally { await release.promise; joined = true; }
      };
      const fs = filesystem({
        capabilities: { streamingWrite: streaming, write: true, append: true },
        async writeFile() {},
        appendFile: (_path, _bytes, options) => consume(options!.signal!),
        async writeStream(_path, source, options) { for await (const bytes of source) { assert.equal(bytes.length, 1); await consume(options!.signal!); } },
      });
      const target = await openFileOutput({ fs, signal: controller.signal, registerCleanup: callback => { cleanup = callback; } }, "/out", "w");
      const writing = assert.rejects(target.sink.write(Uint8Array.of(65)), error => error === controller.signal.reason);
      await received.promise;
      controller.abort(reason);
      await canceled.promise;
      let closed = false;
      const closing = Promise.all([cleanup(), target.abort(controller.signal.reason)]).then(() => { closed = true; });
      try {
        await Promise.resolve();
        assert.equal(closed, false);
        assert.equal(joined, false);
      } finally { release.resolve(); }
      await Promise.all([writing, closing]);
      assert.equal(joined, true);
      await assert.rejects(target.finish(), error => error === controller.signal.reason);
    });
  }

  test(`finish joins queued writes and empty writes: streaming=${streaming}`, async () => {
    const bytes: number[] = [];
    const fs = filesystem({
      capabilities: { streamingWrite: streaming, write: true, append: true },
      async writeFile() {},
      async appendFile(_path, chunk) { bytes.push(...chunk); },
      async writeStream(_path, source) { for await (const chunk of source) bytes.push(...chunk); },
    });
    const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/out", "w");
    const first = target.sink.write(Uint8Array.of(1));
    const empty = target.sink.write(new Uint8Array());
    const second = target.sink.write(Uint8Array.of(2));
    await Promise.all([first, empty, second, target.finish()]);
    assert.deepEqual(bytes, [1, 2]);
    await assert.rejects(target.sink.write(Uint8Array.of(3)));
  });
}

for (const reason of [undefined, null, false, 0, "", new FsError("EIO")]) {
  for (const after of [false, true]) {
    test(`fallback task failure preserves ${String(reason)} ${after ? "after" : "before"} consumption`, async () => {
      let closed = false;
      const fs = filesystem({
        capabilities: { streamingWrite: false, write: true, append: true },
        async writeFile() { if (!after) { closed = true; throw reason; } },
        async appendFile(_path, bytes) {
          assert.equal(bytes.length, 1);
          try { throw reason; } finally { closed = true; }
        },
      });
      const context = { fs, signal: new AbortController().signal };
      if (!after) await assert.rejects(openFileOutput(context, "/out", "w"), error => error === reason);
      else {
        const target = await openFileOutput(context, "/out", "w");
        await assert.rejects(target.sink.write(Uint8Array.of(65)), error => error === reason);
        await assert.rejects(target.finish(), error => error === reason);
        await target.abort(reason);
      }
      assert.equal(closed, true);
    });
  }
}

for (const after of [false, true]) {
  test(`early streaming task fulfillment rejects ${after ? "after" : "before"} consumption`, async () => {
    let closed = false;
    const fs = filesystem({
      async writeStream(_path, source) {
        try { if (after) for await (const bytes of source) { assert.equal(bytes.length, 1); break; } }
        finally { closed = true; }
      },
    });
    const context = { fs, signal: new AbortController().signal };
    const early = (error: unknown): boolean => error instanceof FsError && error.code === "EIO";
    if (!after) await assert.rejects(openFileOutput(context, "/out", "w"), early);
    else {
      const target = await openFileOutput(context, "/out", "w");
      await assert.rejects(target.sink.write(Uint8Array.of(65)), early);
      await assert.rejects(target.finish(), early);
      await target.abort(new Error("test cleanup"));
    }
    assert.equal(closed, true);
  });
}
