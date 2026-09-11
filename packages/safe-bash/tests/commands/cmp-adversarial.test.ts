import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Shell, ShellLimitError, agentCommands, createMemoryFileSystem, FsError,
  type ByteSource, type FileSystem,
} from "../../src/index.js";
import { cmpCommand } from "../../src/commands/cmp.js";
import type { CommandContext } from "../../src/contracts/command.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function producer(chunks: readonly Uint8Array[], close?: () => Promise<void>) {
  const state = { opened: 0, next: 0, returned: 0, closed: false };
  const slab = new Uint8Array(Math.max(0, ...chunks.map(chunk => chunk.length)));
  const source: ByteSource = { [Symbol.asyncIterator]() {
    state.opened++;
    let offset = 0;
    return {
      async next() {
        state.next++;
        slab.fill(0xee);
        const chunk = chunks[offset++];
        if (!chunk) return { done: true, value: undefined };
        slab.set(chunk);
        return { done: false, value: slab.subarray(0, chunk.length) };
      },
      async return() {
        state.returned++;
        slab.fill(0xdd);
        await close?.();
        state.closed = true;
        return { done: true, value: undefined };
      },
    };
  } };
  return { state, source };
}

async function fixture(overrides: Partial<Record<keyof FileSystem, unknown>> = {}) {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/left", Uint8Array.of(0x80, 0, 0xff, 10, 1, 2));
  await memory.writeFile("/right", Uint8Array.of(0x80, 0, 0xff, 10, 1, 2));
  const fs = new Proxy(memory, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    if (property === "capabilities" && (Object.hasOwn(overrides, "readStream") || Object.hasOwn(overrides, "readFile"))) return { ...target.capabilities, retainedRead: false };
    const member: unknown = Reflect.get(target, property);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const shell = new Shell({ fs }).use(agentCommands());
  return { shell, memory };
}

function streams(left: ByteSource, right: ByteSource): Partial<FileSystem> {
  return {
    readStream(path, options) {
      assert.ok(options?.signal);
      options.signal.throwIfAborted();
      assert.ok(path === "/left" || path === "/right", path);
      return path === "/left" ? left : right;
    },
    async readFile() { assert.fail("admitted streams must not fall back to whole-file reads"); },
  };
}

for (const [leftWidth, rightWidth] of [[1, 3], [4, 1], [2, 5]]) {
  test(`cmp preserves reused binary chunks across empty boundaries ${leftWidth}/${rightWidth}`, async () => {
    const payload = Uint8Array.of(0x80, 0, 0xff, 10, 0x81, 13, 0xc0, 0xaf, 1);
    const split = (width: number) => {
      const chunks: Uint8Array[] = [new Uint8Array()];
      for (let offset = 0; offset < payload.length; offset += width) {
        chunks.push(payload.slice(offset, offset + width), new Uint8Array());
      }
      return chunks;
    };
    const left = producer(split(leftWidth!));
    const right = producer(split(rightWidth!));
    const { shell } = await fixture(streams(left.source, right.source));
    try {
      const result = await shell.exec("cmp /left /right");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(left.state.opened, 1);
      assert.equal(right.state.opened, 1);
    } finally { await shell.dispose(); }
  });
}

test("cmp does not merge distinct invalid UTF-8 bytes with identical decoded text", async () => {
  const left = producer([Uint8Array.of(0, 0x80), Uint8Array.of(10)]);
  const right = producer([Uint8Array.of(0), new Uint8Array(), Uint8Array.of(0x81, 10)]);
  const { shell } = await fixture(streams(left.source, right.source));
  try {
    const result = await shell.exec("cmp -s /left /right");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(left.state.next, 1);
    assert.equal(left.state.returned, 1);
    assert.equal(right.state.returned, 1);
  } finally { await shell.dispose(); }
});

for (const mode of ["difference", "limit"] as const) {
  test(`cmp ${mode} awaits each admitted producer close once without another pull`, async () => {
    const entered = deferred();
    const release = deferred();
    const close = async () => { entered.resolve(); await release.promise; };
    const left = producer([Uint8Array.of(1, 2), Uint8Array.of(99)], close);
    const right = producer([Uint8Array.of(mode === "difference" ? 3 : 1, 2), Uint8Array.of(98)], close);
    const { shell } = await fixture(streams(left.source, right.source));
    let settled = false;
    const running = shell.exec(`cmp ${mode === "limit" ? "-n 1 " : ""}/left /right`);
    void running.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      await Promise.resolve();
      assert.equal(settled, false, "Shell settled before cooperative producer cleanup");
      release.resolve();
      const result = await running;
      assert.equal(result.exitCode, mode === "difference" ? 1 : 0, result.stderr);
      for (const side of [left, right]) assert.deepEqual(side.state, { opened: 1, next: 1, returned: 1, closed: true });
    } finally { release.resolve(); await running.catch(() => {}); await shell.dispose(); }
  });
}

test("cmp -n 0 does not pull either producer", async () => {
  const left = producer([Uint8Array.of(1)]);
  const right = producer([Uint8Array.of(2)]);
  const { shell } = await fixture(streams(left.source, right.source));
  try {
    const result = await shell.exec("cmp -n 0 /left /right");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(left.state.next + right.state.next, 0);
  } finally { await shell.dispose(); }
});

for (const reason of [false, 0, "", null]) {
  test(`cmp pending-read cancellation retains ${JSON.stringify(reason)} and awaits admitted cleanup`, async () => {
    const controller = new AbortController();
    const entered = deferred();
    const closing = deferred();
    const release = deferred();
    let opened = 0;
    let returned = 0;
    let closed = 0;
    const { shell } = await fixture({
      readStream(_path: string, options: { signal: AbortSignal }) {
        const source: ByteSource = { [Symbol.asyncIterator]() {
          opened++;
          return {
            next() {
              entered.resolve();
              return new Promise<IteratorResult<Uint8Array>>((_, reject) => {
                if (options.signal.aborted) reject(options.signal.reason);
                else options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
              });
            },
            async return() { returned++; closing.resolve(); await release.promise; closed++; return { done: true, value: undefined }; },
          };
        } };
        return source;
      },
      async readFile() { assert.fail("canceled stream must not fall back"); },
    });
    let settled = false;
    const running = shell.exec("cmp /left /right", { signal: controller.signal });
    const rejected = assert.rejects(running, error => Object.is(error, reason));
    void running.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      const admitted = opened;
      assert.ok(admitted > 0 && admitted <= 2);
      controller.abort(reason);
      await closing.promise;
      await Promise.resolve();
      assert.equal(settled, false, "caller cancellation bypassed producer cleanup");
      release.resolve();
      await rejected;
      assert.equal(opened, admitted);
      assert.equal(returned, admitted);
      assert.equal(closed, admitted);
    } finally { release.resolve(); controller.abort(reason); await running.catch(() => {}); await shell.dispose(); }
  });
}

for (const mode of ["disabled", "missing", "denied"] as const) {
  test(`cmp ${mode} path streaming honors admission and never reads without a finite cap`, async () => {
    let streamCalls = 0;
    const reads: number[] = [];
    const { shell } = await fixture({
      async capabilitiesFor(path: string) {
        assert.ok(path === "/left" || path === "/right");
        return { read: mode !== "denied", streamingRead: mode === "missing" };
      },
      readStream: mode === "missing" ? undefined : () => { streamCalls++; assert.fail("disabled path stream called"); },
      async readFile(_path: string, options: { maxBytes?: number; signal?: AbortSignal }) {
        assert.notEqual(mode, "denied", "disabled read capability called");
        assert.ok(options.signal);
        assert.ok(Number.isSafeInteger(options.maxBytes) && options.maxBytes! > 0 && options.maxBytes! <= 32 * 1024 * 1024);
        reads.push(options.maxBytes!);
        return Uint8Array.of(0x80, 0, 0xff);
      },
    });
    try {
      const result = await shell.exec("cmp /left /right");
      assert.equal(result.exitCode, mode === "denied" ? 2 : 0, result.stderr);
      assert.equal(streamCalls, 0);
      assert.equal(reads.length, mode === "denied" ? 0 : 2);
    } finally { await shell.dispose(); }
  });
}

test("cmp canceled path admission never opens a late producer", async () => {
  const controller = new AbortController();
  const entered = deferred();
  const left = producer([Uint8Array.of(1)]);
  const right = producer([Uint8Array.of(1)]);
  const { shell } = await fixture({
    ...streams(left.source, right.source),
    async capabilitiesFor(path: string, options: { signal: AbortSignal }) {
      if (path === "/right") {
        entered.resolve();
        await new Promise<void>((_, reject) => {
          if (options.signal.aborted) reject(options.signal.reason);
          else options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
        });
      }
      return { read: true, streamingRead: true };
    },
  });
  const running = shell.exec("cmp /left /right", { signal: controller.signal });
  const rejected = assert.rejects(running, error => error === false);
  try {
    await entered.promise;
    const admitted = left.state.opened;
    controller.abort(false);
    await rejected;
    assert.equal(right.state.opened, 0);
    assert.equal(left.state.opened, admitted);
    assert.equal(left.state.returned, admitted);
    assert.equal(left.state.closed, admitted === 1);
  } finally { controller.abort(false); await running.catch(() => {}); await shell.dispose(); }
});

test("cmp output budget rejection closes both inputs without consuming later chunks", async () => {
  const entered = deferred();
  const release = deferred();
  const close = async () => { entered.resolve(); await release.promise; };
  const left = producer([Uint8Array.of(1), Uint8Array.of(3)], close);
  const right = producer([Uint8Array.of(2), Uint8Array.of(4)], close);
  const { shell } = await fixture(streams(left.source, right.source));
  const running = shell.exec("cmp /left /right", { limits: { maxOutputBytes: 1 } });
  const rejected = assert.rejects(running, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  let settled = false;
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    await Promise.resolve();
    assert.equal(settled, false, "output refusal bypassed cooperative input cleanup");
    release.resolve();
    await rejected;
    for (const side of [left, right]) assert.deepEqual(side.state, { opened: 1, next: 1, returned: 1, closed: true });
  } finally { release.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

test("cmp refuses an oversized incoming chunk before copying and closes its producer", async () => {
  const oversized = new Uint8Array(32 * 1024 * 1024 + 1);
  let closed = false;
  const source: ByteSource = { async *[Symbol.asyncIterator]() { try { yield oversized; assert.fail("read beyond over-budget chunk"); } finally { closed = true; } } };
  const right = producer([Uint8Array.of(0)]);
  const { shell } = await fixture(streams(source, right.source));
  const NativeUint8Array = Uint8Array;
  const nativeSlice = NativeUint8Array.prototype.slice;
  let copies = 0;
  globalThis.Uint8Array = new Proxy(NativeUint8Array, { construct(target, args) {
    if (args[0] === oversized) copies++;
    return Reflect.construct(target, args);
  } });
  NativeUint8Array.prototype.slice = function (start, end) {
    if (this === oversized) copies++;
    return nativeSlice.call(this, start, end);
  };
  try {
    const result = await shell.exec("cmp /left /right");
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(closed, true);
    assert.equal(copies, 0);
  } finally { globalThis.Uint8Array = NativeUint8Array; NativeUint8Array.prototype.slice = nativeSlice; await shell.dispose(); }
});

test("cmp never retries a partially consumed failed stream as a buffered read", async () => {
  let closed = false;
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    try { yield Uint8Array.of(1); throw new FsError("ENOTSUP"); }
    finally { closed = true; }
  } };
  const right = producer([Uint8Array.of(1), Uint8Array.of(2)]);
  const { shell } = await fixture(streams(source, right.source));
  try {
    const result = await shell.exec("cmp /left /right");
    assert.equal(result.exitCode, 2);
    assert.equal(closed, true);
    assert.equal(right.state.returned, right.state.opened);
  } finally { await shell.dispose(); }
});

test("cmp yields during zero-byte pulls so queued cancellation runs before the finite producer cutoff", async () => {
  const controller = new AbortController();
  const reason = new Error("empty-chunk task-turn cancellation");
  let handle: ReturnType<typeof setImmediate> | undefined;
  let pulls = 0;
  let returns = 0;
  let turnRan = false;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() {
      if (++pulls === 1) handle = setImmediate(() => { turnRan = true; controller.abort(reason); });
      assert.ok(pulls <= 2048, "zero-byte pulls starved the queued cancellation turn");
      return { done: false, value: new Uint8Array() };
    },
    async return() { returns++; return { done: true, value: undefined }; },
  }; } };
  const right = producer([Uint8Array.of(0)]);
  const { shell } = await fixture(streams(source, right.source));
  try {
    await assert.rejects(shell.exec("cmp /left /right", { signal: controller.signal }), error => error === reason);
    assert.equal(turnRan, true);
    assert.ok(pulls > 0 && pulls <= 2048);
    assert.equal(returns, 1);
    assert.equal(right.state.next, 0);
  } finally { clearImmediate(handle); controller.abort(reason); await shell.dispose(); }
});

test("cmp shares its 32 MiB input admission across both operands", async () => {
  const chunk = new Uint8Array(16 * 1024 * 1024 + 1);
  const closed: string[] = [];
  const source = (name: string): ByteSource => ({ async *[Symbol.asyncIterator]() {
    try { yield chunk; assert.fail("read after aggregate input rejection"); }
    finally { closed.push(name); }
  } });
  const { shell } = await fixture(streams(source("left"), source("right")));
  try {
    const result = await shell.exec("cmp /left /right");
    assert.equal(result.exitCode, 2, result.stderr);
    assert.deepEqual(closed.sort(), ["left", "right"]);
  } finally { await shell.dispose(); }
});

test("cmp skips reused chunks on metadata-free streams while retaining the bounded comparison prefix", async () => {
  const left = producer([Uint8Array.of(1), new Uint8Array(), Uint8Array.of(2, 128), Uint8Array.of(255, 3)]);
  const right = producer([Uint8Array.of(9, 8, 7, 128, 255), Uint8Array.of(4)]);
  const { shell } = await fixture({ ...streams(left.source, right.source), capabilities: { read: true, streamingRead: true, stat: false } });
  try {
    const result = await shell.exec("cmp -i2:3 -n2 /left /right");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "", ""]);
    assert.equal(right.state.next, 1);
    for (const side of [left, right]) assert.equal(side.state.returned, 1);
  } finally { await shell.dispose(); }
});

test("cmp cancellation during ignored stdin still awaits cooperative retirement", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel ignored input");
  let pulls = 0;
  let returned = 0;
  let handle: ReturnType<typeof setImmediate> | undefined;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() {
      if (++pulls === 1) handle = setImmediate(() => controller.abort(reason));
      assert.ok(pulls <= 2048, "skip starved queued cancellation");
      return { done: false, value: Uint8Array.of(0) };
    },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  const { shell } = await fixture();
  try {
    await assert.rejects(shell.exec("cmp -i9223372036854775807:0 - /right", { stdin: source, signal: controller.signal }), error => error === reason);
    assert.equal(returned, 1);
  } finally { clearImmediate(handle); controller.abort(reason); await shell.dispose(); }
});

test("cmp -s retains read failures and closes every opened producer", async () => {
  const left: ByteSource = { [Symbol.asyncIterator]() { return {
    async next(): Promise<IteratorResult<Uint8Array>> { throw new FsError("EIO"); },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  let returned = 0;
  const right = producer([Uint8Array.of(0)]);
  const { shell } = await fixture(streams(left, right.source));
  try {
    const result = await shell.exec("cmp -s /left /right");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [2, "", "cmp: /left: Input/output error\n"]);
    assert.equal(returned, 1);
    assert.equal(right.state.opened, 0);
  } finally { await shell.dispose(); }
});

test("cmp does not read same-name admitted files", async () => {
  let streamsOpened = 0;
  const { shell } = await fixture({ readStream() { streamsOpened++; assert.fail("same-name input was read"); } });
  try {
    for (const args of ["/left /left", "-s /left /left", "-i2 /left /left", "-n0 /left /left"]) {
      const result = await shell.exec(`cmp ${args}`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "", ""]);
    }
    assert.equal(streamsOpened, 0);
  } finally { await shell.dispose(); }
});

for (const limit of ["1", "18446744073709551615"]) test(`cmp requests bounded stdin reads for -n${limit} without retiring borrowed input`, async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/right", Uint8Array.of(1, 2));
  let position = 0;
  const requests: number[] = [];
  const output: Uint8Array[] = [];
  const context: CommandContext = {
    command: "cmp", args: [`-n${limit}`, "-", "/right"], cwd: "/", env: { LC_ALL: "C" }, fs: memory,
    signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { assert.fail("cmp bypassed bounded stdin input"); } },
    stdinInput: {
      get position() { return position; },
      async read(maxBytes, signal) {
        signal.throwIfAborted();
        requests.push(maxBytes);
        assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 4096);
        if (position === 2) return { done: true, value: undefined };
        const value = Uint8Array.of(1, 2).slice(position, position + maxBytes);
        position += value.length;
        return { done: false, value };
      },
    },
    stdout: { async write(bytes) { output.push(bytes); } },
    stderr: { async write(bytes) { output.push(bytes); } },
  };
  const result = await cmpCommand().execute(context);
  assert.equal(result.exitCode, 0);
  assert.equal(output.length, 0);
  assert.equal(position, limit === "1" ? 1 : 2);
  assert.equal(requests[0], limit === "1" ? 1 : 4096);
});

test("cmp closes late retained input admission before canceled execution settles", async () => {
  const controller = new AbortController();
  const entered = deferred();
  const acquisition = deferred();
  const closing = deferred();
  const retirement = deferred();
  let opened = 0;
  let closed = 0;
  const { shell } = await fixture({
    async openReadFile() {
      opened++;
      entered.resolve();
      await acquisition.promise;
      return {
        async stat() { assert.fail("metadata read after cancellation"); },
        async read() { assert.fail("content read after cancellation"); },
        async close() { closed++; closing.resolve(); await retirement.promise; },
      };
    },
  });
  const running = shell.exec("cmp /left /right", { signal: controller.signal });
  const rejected = assert.rejects(running, error => error === false);
  let settled = false;
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    controller.abort(false);
    acquisition.resolve();
    await closing.promise;
    await Promise.resolve();
    assert.equal(settled, false);
    retirement.resolve();
    await rejected;
    assert.deepEqual([opened, closed], [1, 1]);
  } finally { acquisition.resolve(); retirement.resolve(); controller.abort(false); await running.catch(() => {}); await shell.dispose(); }
});

test("cmp rejects a retained handle's oversized response and closes both admitted handles once", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/file", Uint8Array.of(0));
  const stat = await memory.stat("/file");
  let closed = 0;
  let reads = 0;
  let opened = 0;
  const { shell } = await fixture({
    async openReadFile() {
      const identity = ++opened;
      return {
        async stat() { return { ...stat, ino: identity }; },
        async read(_position: number, maximum: number) { reads++; assert.equal(maximum, 1); return new Uint8Array(2); },
        async close() { closed++; },
      };
    },
  });
  try {
    const result = await shell.exec("cmp -n1 /left /right");
    assert.deepEqual([result.exitCode, result.stderr], [2, "cmp: /left: Input/output error\n"]);
    assert.deepEqual([reads, closed], [1, 2]);
  } finally { await shell.dispose(); }
});

test("cmp -s admits and closes huge unequal regular files without reading their contents", async () => {
  const size = 17 * 1024 * 1024;
  const memory = createMemoryFileSystem({ maxFileBytes: size + 1, maxRetainedBytes: 40 * 1024 * 1024 });
  await memory.writeFile("/left", new Uint8Array());
  await memory.writeFile("/right", new Uint8Array());
  await memory.truncate("/left", size);
  await memory.truncate("/right", size + 1);
  let opened = 0;
  let closed = 0;
  let contentReads = 0;
  let streamReads = 0;
  const fs = new Proxy(memory, { get(target, property) {
    if (property === "readStream") return () => { streamReads++; assert.fail("size inequality consumed a stream"); };
    if (property === "openReadFile") return async (...args: Parameters<typeof target.openReadFile>) => {
      const handle = await target.openReadFile(...args);
      opened++;
      return {
        ...handle,
        read(...readArgs: Parameters<typeof handle.read>) { contentReads++; return handle.read(...readArgs); },
        close() { closed++; return handle.close(); },
      };
    };
    const member: unknown = Reflect.get(target, property);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    for (const flags of ["-s", `-s -n${size + 1}`, "-s -i1:0"]) {
      const result = await shell.exec(`cmp ${flags} /left /right`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [1, "", ""]);
    }
    assert.deepEqual([opened, closed, contentReads, streamReads], [6, 6, 0, 0]);
    await memory.chmod("/left", 0);
    const denied = await shell.exec("cmp -s /left /right");
    assert.deepEqual([denied.exitCode, denied.stdout, denied.stderr], [2, "", ""]);
    assert.deepEqual([opened, closed, contentReads, streamReads], [6, 6, 0, 0]);
  } finally { await shell.dispose(); }
});

for (const mode of ["limit boundary", "equal remaining sizes", "unknown metadata", "character metadata"] as const) {
  test(`cmp -s does not use size inequality for ${mode}`, async () => {
    let reads = 0;
    const { shell, memory } = await fixture({
      capabilities: { read: true, streamingRead: true, retainedRead: false, stat: mode !== "unknown metadata" },
      async stat(path: string) {
        assert.notEqual(mode, "unknown metadata");
        const stat = await memory.stat(path);
        return mode === "character metadata" ? { ...stat, type: "character" } : stat;
      },
      readStream() { reads++; throw new FsError("EIO"); },
    });
    await memory.writeFile("/left", new Uint8Array(2));
    await memory.writeFile("/right", new Uint8Array(3));
    try {
      const flags = mode === "limit boundary" ? "-n2" : mode === "equal remaining sizes" ? "-i1:2" : "";
      const result = await shell.exec(`cmp -s ${flags} /left /right`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [2, "", "cmp: /left: Input/output error\n"]);
      assert.equal(reads, 1);
    } finally { await shell.dispose(); }
  });
}

for (const phase of ["stat", "read"] as const) {
  for (const reason of [undefined, false, 0, "", null]) {
    for (const mode of reason === undefined ? ["failure", "close failure"] as const : ["failure", "abort", "close failure"] as const) {
      test(`cmp direct retained ${phase} ${mode} ${String(reason)} drains work before close and preserves the primary outcome`, async () => {
        const memory = createMemoryFileSystem();
        await memory.writeFile("/left", Uint8Array.of(1));
        await memory.writeFile("/right", Uint8Array.of(1));
        const stats = new Map([
          ["/left", await memory.stat("/left")],
          ["/right", await memory.stat("/right")],
        ]);
        const controller = new AbortController();
        const entered = deferred();
        const releaseOperation = deferred();
        const closeEntered = deferred();
        const releaseClose = deferred();
        const events: string[] = [];
        const errors: unknown[] = [];
        let cleanup: (() => void | Promise<void>) | undefined;
        let operationFinished = false;
        let leftCloseStarted = false;
        let opened = 0;
        let closed = 0;
        const delayedOperation = async (signal: AbortSignal | undefined): Promise<void> => {
          assert.ok(signal);
          entered.resolve();
          await releaseOperation.promise;
          operationFinished = true;
          events.push("operation finished");
          if (mode === "failure") throw reason;
          signal.throwIfAborted();
        };
        const fs = new Proxy(memory, { get(target, property) {
          if (property === "openReadFile") return async (path: string) => {
            assert.ok(cleanup, "cleanup must be registered before retained acquisition");
            opened++;
            return {
              async stat(options?: { signal?: AbortSignal }) {
                if (path === "/left" && phase === "stat") await delayedOperation(options?.signal);
                return stats.get(path)!;
              },
              async read(_position: number, maximum: number, options?: { signal?: AbortSignal }) {
                assert.equal(maximum, 1);
                if (path === "/left" && phase === "read") await delayedOperation(options?.signal);
                return Uint8Array.of(1);
              },
              async close() {
                if (path === "/left") {
                  leftCloseStarted = true;
                  events.push("left close started");
                  closeEntered.resolve();
                }
                await releaseClose.promise;
                closed++;
                throw mode === "close failure" ? reason : reason === false ? 0 : false;
              },
            };
          };
          const member: unknown = Reflect.get(target, property);
          return typeof member === "function" ? member.bind(target) : member;
        } });
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        const context: CommandContext = {
          command: "cmp", args: ["-n1", "/left", "/right"], cwd: "/", env: { LC_ALL: "C" }, fs,
          signal: controller.signal, stdin: producer([]).source,
          stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
          stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
          registerCleanup(callback) { assert.equal(cleanup, undefined); cleanup = callback; },
          onInternalError(error) { errors.push(error); },
        };
        let settled = false;
        let cleanupSettled = false;
        let closing: Promise<void> | undefined;
        const running = Promise.resolve(cmpCommand().execute(context));
        const outcome = running.then(result => ({ result }), (error: unknown) => ({ error }));
        void outcome.then(() => { settled = true; });
        try {
          await entered.promise;
          if (mode === "abort") {
            controller.abort(reason);
            closing = Promise.resolve(cleanup!());
            void closing.then(() => { cleanupSettled = true; });
            await new Promise<void>(resolve => setImmediate(resolve));
            assert.equal(operationFinished, false);
            assert.equal(leftCloseStarted, false, "retained handle closed while its operation was still pending");
            assert.equal(cleanupSettled, false);
            assert.equal(settled, false);
          }
          releaseOperation.resolve();
          await closeEntered.promise;
          closing ??= Promise.resolve(cleanup!());
          await Promise.resolve();
          assert.equal(operationFinished, true);
          assert.equal(settled, false, "execution settled while retained close was pending");
          releaseClose.resolve();
          const observed = await outcome;
          await closing;
          assert.deepEqual(events, ["operation finished", "left close started"]);
          assert.equal(closed, opened);
          assert.equal(opened, phase === "stat" && mode !== "close failure" ? 1 : 2);
          assert.equal(stdout.length, 0);
          if (mode === "abort") {
            assert.ok("error" in observed);
            assert.ok(Object.is(observed.error, reason));
            assert.deepEqual(errors, []);
            assert.equal(stderr.length, 0);
          } else {
            assert.deepEqual(observed, { result: { exitCode: 2 } });
            assert.deepEqual(errors, [reason]);
            assert.equal(Buffer.concat(stderr).toString(), "cmp: internal error\n");
          }
        } finally {
          releaseOperation.resolve();
          releaseClose.resolve();
          await outcome;
          await closing;
          await cleanup?.();
        }
      });
    }
  }
}
