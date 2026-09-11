import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem } from "poe-code/safe-fs";
import { FsError } from "../../../../src/contracts/errors.js";
import { createBytePipe } from "../../../../src/contracts/io.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { inputBufferUsage, prepareBytesInput, prepareFileInput, ShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import type { ShellLimits } from "../../../../src/shell/types.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(limits: ShellLimits = {}) {
  const root = new AbortController(), parent = new AbortController(), fs = new MemoryFileSystem();
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000, ...limits }, root.signal);
  const cleanups: (() => void | Promise<void>)[] = [];
  return { root, parent, fs, budget, cleanups,
    context: { fs: fs as FileSystem, signal: parent.signal, registerCleanup: (cleanup: () => void | Promise<void>) => { cleanups.push(cleanup); } },
    async close() {
      try { await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup))); }
      finally { budget.close(); budget.values.close(); }
    },
  };
}

function intercept<Target extends object>(target: Target, overrides: Partial<Target>): Target {
  return new Proxy(target, { get(original, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(original, key, original);
    return typeof value === "function" ? value.bind(original) : value;
  } });
}

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test("source review: cleanup registration retains its original context receiver before any open", async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(65));
  let opens = 0;
  const fs = intercept(subject.fs, { async open(...args) {
    opens++;
    assert.ok(subject.cleanups.length >= 2);
    return subject.fs.open(...args);
  } });
  const context = { ...subject.context, fs,
    registerCleanup(this: { cleanups: typeof subject.cleanups }, cleanup: () => void | Promise<void>) {
      assert.ok(this === context, "registerCleanup must preserve its owner receiver");
      this.cleanups.push(cleanup);
    }, cleanups: subject.cleanups,
  };
  try {
    const prepared = await prepareFileInput(context, "/input", subject.budget);
    await prepared.close();
    assert.equal(opens, 1);
  } finally { await subject.close(); }
});

test("source review: concurrently admitted empty-file reads all observe EOF without EBADF", async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", new Uint8Array());
  let closes = 0;
  const fs = intercept(subject.fs, { async open(...args) {
    const descriptor = await subject.fs.open(...args);
    return intercept(descriptor, { async close() { closes++; await descriptor.close(); } });
  } });
  try {
    const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
    const iterator = prepared.source[Symbol.asyncIterator]();
    const results = await Promise.all([iterator.next(), iterator.next(), iterator.next()]);
    assert.ok(results.every(result => result.done));
    assert.equal((await iterator.next()).done, true);
    await prepared.close();
    assert.equal(closes, 1);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

for (const value of ["", new Uint8Array()]) {
  test(`source review: empty finite ${typeof value} polls EOF without allocation or next`, async () => {
    const subject = fixture({ maxInputBytes: 0, maxExpansionBytes: 0, maxExpansionFields: 0 });
    try {
      const prepared = prepareBytesInput(value, subject.budget);
      const poll = prepared.options.poll!;
      assert.equal(poll.call(undefined), "eof");
      assert.equal(poll.call({}), "eof");
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
      assert.equal(prepared.close(), prepared.close());
      await prepared.close();
    } finally { await subject.close(); }
  });
}

for (const kind of ["input", "allocation"] as const) {
  test(`source review: finite ${kind} admission precedes copying caller bytes`, async () => {
    const bytes = Uint8Array.of(255, 0, 10);
    const subject = fixture(kind === "input" ? { maxInputBytes: 2 } : { maxExpansionBytes: 0, maxExpansionFields: 0 });
    const NativeBytes = Uint8Array;
    const failure = new Error("finite allocation failure");
    let attempts = 0, copies = 0;
    globalThis.Uint8Array = new Proxy(NativeBytes, { construct(target, args, receiver) {
      if (args[0] instanceof NativeBytes && args[0].byteLength) {
        attempts++;
        if (kind === "allocation") {
          assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 3, buffers: 1 });
          throw failure;
        }
        copies++;
      }
      return Reflect.construct(target, args, receiver);
    } });
    try {
      assert.throws(() => prepareBytesInput(bytes, subject.budget), error => kind === "input"
        ? error instanceof FsError && error.code === "EFBIG"
        : error === failure);
      assert.equal(attempts, kind === "input" ? 0 : 1);
      assert.equal(copies, 0);
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
      assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
    } finally { globalThis.Uint8Array = NativeBytes; await subject.close(); }
  });
}

test("source review: string admission counts UTF-8 bytes before encoding", async context => {
  const subject = fixture({ maxInputBytes: 1 });
  let encodings = 0;
  const encode = context.mock.method(TextEncoder.prototype, "encode", () => { encodings++; throw new Error("encoding before admission"); });
  try {
    assert.throws(() => prepareBytesInput("é", subject.budget), { code: "EFBIG" });
    assert.equal(encodings, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { encode.mock.restore(); await subject.close(); }
});

test("source review: finite bytes stay owned across caller mutation and borrowed cursor closure", async () => {
  const subject = fixture();
  const bytes = Uint8Array.of(255, 0, 10, 128, 10);
  const prepared = prepareBytesInput(bytes, subject.budget);
  const input = new ShellInput(prepared.source, subject.budget, subject.budget.signal, prepared.options);
  const borrower = new ShellInput(input, subject.budget);
  try {
    bytes.fill(42);
    assert.equal(input.readiness(), "ready");
    const first = await borrower.record();
    assert.deepEqual(shellValueBytes(first.shellValue), Uint8Array.of(255, 0, 10));
    await borrower.close();
    await first.release();
    assert.equal(input.readiness(), "ready");
    const last = await input.record();
    assert.deepEqual(shellValueBytes(last.shellValue), Uint8Array.of(128, 10));
    await last.release();
    await input.close();
    await prepared.close();
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await borrower.close(); await input.close(); await prepared.close(); await subject.close(); }
});

test("source review: detached pipe readiness does not consume bytes or release a blocked writer", async () => {
  const subject = fixture(), pipe = createBytePipe({ highWaterMark: 1 });
  const poll = pipe.readiness;
  const input = new ShellInput(pipe.readable, subject.budget, subject.budget.signal, { provenance: "stream", poll });
  try {
    assert.equal(poll(), "blocked");
    await pipe.writable.write(new Uint8Array());
    assert.equal(poll(), "blocked");
    await pipe.writable.write(Uint8Array.of(255));
    let settled = false;
    const writing = pipe.writable.write(Uint8Array.of(0)).then(() => { settled = true; });
    await turn();
    assert.equal(settled, false);
    for (let index = 0; index < 4; index++) assert.equal(input.readiness(), "ready");
    assert.equal(settled, false);
    const closing = pipe.close();
    const record = await input.record({ delimiter: 0 });
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0));
    await record.release();
    await Promise.all([writing, closing]);
    assert.equal(poll(), "eof");
  } finally { await input.close(); await pipe.abort(); await subject.close(); }
});

for (const reason of [false, null, 0, -0, "", NaN]) {
  test(`source review: failed pipe polling preserves reason ${String(reason)} negative-zero=${Object.is(reason, -0)}`, async () => {
    const subject = fixture(), pipe = createBytePipe();
    const input = new ShellInput(pipe.readable, subject.budget, subject.budget.signal, { provenance: "stream", poll: pipe.readiness });
    try {
      await pipe.abort(reason);
      assert.throws(() => input.readiness(), error => Object.is(error, reason));
      await assert.rejects(input.record(), error => Object.is(error, reason));
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    } finally { await input.close(); await subject.close(); }
  });
}

test("source review: pipe EOF cannot hide a pending delivered chunk after local timeout", async () => {
  const subject = fixture(), pipe = createBytePipe(), delivery = deferred<void>(), admitted = deferred<void>();
  const iterator = pipe.readable[Symbol.asyncIterator]();
  let now = 0, expire!: () => void, pulls = 0;
  const input = new ShellInput({ [Symbol.asyncIterator]() { return {
    async next() { pulls++; const result = await iterator.next(); admitted.resolve(); await delivery.promise; return result; },
    return: () => iterator.return!(),
  }; } }, subject.budget, subject.budget.signal, {
    provenance: "stream", poll: pipe.readiness,
    clock: { now: () => now, schedule(_delay, callback) { expire = callback; return () => {}; } },
  });
  try {
    const reading = input.line(true, { timeoutMs: 1 });
    await pipe.writable.write(Uint8Array.of(255, 0, 10));
    await admitted.promise;
    await pipe.close();
    assert.equal(pipe.readiness(), "eof");
    now = 1; expire();
    const timed = await reading;
    assert.equal(timed.reason, "timeout");
    await timed.release();
    assert.equal(input.readiness(), "unknown");
    assert.equal(pulls, 1);
    delivery.resolve();
    await turn();
    assert.equal(input.readiness(), "ready");
    const record = await input.record();
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
    await record.release();
    assert.equal(pulls, 1);
  } finally { delivery.resolve(); await input.close(); await pipe.abort(); await subject.close(); }
});

test("source review: stat and reads remain on the opened inode after pathname replacement", async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(255, 0, 10));
  const original = await subject.fs.stat("/input");
  let opens = 0, stats = 0, reads = 0, closes = 0;
  const fs = intercept(subject.fs, {
    async open(...args) {
      opens++;
      const descriptor = await subject.fs.open(...args);
      await subject.fs.rename("/input", "/retained");
      await subject.fs.writeFile("/input", Uint8Array.of(88, 10));
      return intercept(descriptor, {
        async stat(options) { stats++; const metadata = await descriptor.stat(options); assert.equal(metadata.ino, original.ino); return metadata; },
        async read(...readArgs) { reads++; return descriptor.read(...readArgs); },
        async close() { closes++; await descriptor.close(); },
      });
    },
    stat: async () => { throw new Error("pathname stat is not descriptor classification"); },
    readFile: async () => { throw new Error("unexpected path reopen"); },
    readStream: () => { throw new Error("unexpected streaming reopen"); },
  });
  try {
    const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
    assert.equal(prepared.options.provenance, "regular");
    const input = new ShellInput(prepared.source, subject.budget, subject.budget.signal, prepared.options);
    try {
      const record = await input.record();
      assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
      await record.release();
    } finally { await input.close(); await prepared.close(); }
    assert.deepEqual({ opens, stats, reads, closes }, { opens: 1, stats: 1, reads: 1, closes: 1 });
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

for (const source of ["parent", "budget"] as const) {
  test(`source review: ${source} cancellation drains a late open without classifying or reading it`, async () => {
    const subject = fixture(), entered = deferred<void>(), release = deferred<void>();
    await subject.fs.writeFile("/input", Uint8Array.of(65));
    let closes = 0, stats = 0;
    const fs = intercept(subject.fs, { async open(...args) {
      const descriptor = await subject.fs.open(...args);
      entered.resolve(); await release.promise;
      return intercept(descriptor, {
        async stat(options) { stats++; return descriptor.stat(options); },
        async close() { closes++; await descriptor.close(); },
      });
    } });
    try {
      const opening = prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
      let settled = false;
      const rejected = assert.rejects(opening, reason => reason === false).then(() => { settled = true; });
      await entered.promise;
      (source === "parent" ? subject.parent : subject.root).abort(false);
      await turn();
      assert.equal(settled, false);
      release.resolve();
      await rejected;
      assert.deepEqual({ closes, stats }, { closes: 1, stats: 0 });
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    } finally { release.resolve(); await subject.close(); }
  });
}

for (const reason of [false, null, { code: "ENOTSUP" }, new FsError("EACCES")]) {
  test(`source review: noncanonical open failure never grants fallback: ${String(reason)}`, async () => {
    const subject = fixture();
    let fallbacks = 0;
    const fs = intercept(subject.fs, {
      open: async () => { throw reason; },
      readStream: () => { fallbacks++; throw new Error("unauthorized fallback"); },
      readFile: async () => { fallbacks++; throw new Error("unauthorized fallback"); },
    });
    try {
      await assert.rejects(prepareFileInput({ ...subject.context, fs }, "/input", subject.budget), error => error === reason);
      assert.equal(fallbacks, 0);
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    } finally { await subject.close(); }
  });
}

test("source review: retained ENOTSUP fallback keeps unknown provenance despite pathname stat metadata", async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(255, 0, 10));
  let opens = 0, retainedOpens = 0, stats = 0, streams = 0;
  const fs: FileSystem = intercept<FileSystem>(subject.fs, {
    capabilities: { ...subject.fs.capabilities, open: false },
    open: async () => { opens++; throw new FsError("ENOTSUP"); },
    openReadFile: async () => { retainedOpens++; throw new FsError("ENOTSUP"); },
    stat: async (...args) => { stats++; return subject.fs.stat(...args); },
    readStream(...args) { assert.equal(this, fs); streams++; return subject.fs.readStream(...args); },
  });
  try {
    const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
    assert.equal(prepared.options.provenance, "unknown");
    assert.equal(prepared.options.stat?.type, "file");
    assert.equal(prepared.options.seek, undefined);
    assert.equal(prepared.options.poll, undefined);
    const input = new ShellInput(prepared.source, subject.budget, subject.budget.signal, prepared.options);
    try {
      assert.equal(input.readiness(), "unknown");
      await assert.rejects(input.line(true, { timeoutMs: 1 }), /provenance/);
      const record = await input.record();
      assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
      await record.release();
    } finally { await input.close(); await prepared.close(); }
    assert.deepEqual({ opens, retainedOpens, stats, streams }, { opens: 0, retainedOpens: 1, stats: 1, streams: 1 });
  } finally { await subject.close(); }
});

test("source review: unconsumed finite input releases admitted storage before cursor construction", async () => {
  const subject = fixture();
  try {
    const prepared = prepareBytesInput(Uint8Array.of(255, 0, 10), subject.budget);
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 3, buffers: 1 });
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    const close = prepared.close();
    assert.equal(prepared.close(), close);
    await close;
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
    assert.throws(() => prepared.options.poll!(), /closed/);
  } finally { await subject.close(); }
});

test("source review: canonical buffer allocation failure precedes descriptor read and still closes it", async context => {
  const subject = fixture({ maxInputBytes: 3, maxExpansionBytes: 0, maxExpansionFields: 0 });
  await subject.fs.writeFile("/input", Uint8Array.of(255, 0, 10));
  let reads = 0, closes = 0;
  const fs = intercept(subject.fs, { async open(...args) {
    const descriptor = await subject.fs.open(...args);
    return intercept(descriptor, {
      async read(...readArgs) { reads++; return descriptor.read(...readArgs); },
      async close() { closes++; await descriptor.close(); },
    });
  } });
  try {
    const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
    const NativeBytes = Uint8Array;
    const failure = new Error("canonical buffer allocation failure");
    let attempts = 0;
    context.mock.method(globalThis, "Uint8Array", new Proxy(NativeBytes, { construct(target, args, receiver) {
      if (typeof args[0] === "number") {
        attempts++;
        assert.equal(args[0], 3);
        assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 3, buffers: 1 });
        throw failure;
      }
      return Reflect.construct(target, args, receiver);
    } }));
    await assert.rejects(prepared.source[Symbol.asyncIterator]().next(), error => error === failure);
    assert.equal(attempts, 1);
    assert.equal(reads, 0);
    assert.equal(closes, 1);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
  } finally { context.mock.restoreAll(); await subject.close(); }
});
