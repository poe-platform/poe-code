import assert from "node:assert/strict";
import test from "node:test";
import type { ByteSource, CommandContext } from "../../../src/contracts/index.js";
import { Reader } from "../../../src/commands/text-programs/awk-reader.js";
import { AwkRetention } from "../../../src/commands/text-programs/awk-retention.js";
import { Budget } from "../../../src/commands/text-programs/shared.js";

const originalSet = Uint8Array.prototype.set;

function budget(maxBufferBytes = 64, signal = new AbortController().signal): Budget {
  return new Budget({ signal } as CommandContext, { maxBufferBytes });
}

function source(chunks: Uint8Array[], close?: () => Promise<void>) {
  let pulls = 0, returns = 0;
  const stream: ByteSource = { [Symbol.asyncIterator]() {
    return {
      async next() { const chunk = chunks[pulls++]; return chunk === undefined ? { done: true, value: undefined } : { done: false, value: chunk }; },
      async return() { returns++; await close?.(); return { done: true, value: undefined }; },
    };
  } };
  return { stream, pulls: () => pulls, returns: () => returns };
}

test("awk readers share retained capacity and admit before copying rejected bytes", async context => {
  const retention = new AwkRetention(8);
  const first = new Reader(source([Buffer.from("a\nxxxx")]).stream, budget(), retention);
  const rejected = Buffer.from("b\nzz");
  const secondSource = source([rejected]);
  const second = new Reader(secondSource.stream, budget(), retention);
  context.after(async () => { await first.close(); await second.close(); });
  assert.equal(await first.read("\n"), "a");
  assert.equal(retention.retainedBytes, 6, "consumed prefixes keep their block capacity charged");
  let copied = false;
  const set = Uint8Array.prototype.set;
  context.mock.method(Uint8Array.prototype, "set", function (this: Uint8Array, bytes: ArrayLike<number>, offset?: number) {
    if (bytes === rejected) copied = true;
    return set.call(this, bytes, offset);
  });
  await assert.rejects(second.read("\n"), /retained text limit/u);
  assert.equal(copied, false);
  assert.equal(secondSource.pulls(), 1);
  new Uint8Array(rejected.length).set(rejected);
  assert.equal(copied, true, "the copy observer must recognize its source");
  await first.close();
  assert.equal(retention.retainedBytes, 0);
});

test("awk reader copy observer restores the original method", () => {
  assert.equal(Uint8Array.prototype.set, originalSet);
});

test("awk reader releases exact-capacity blocks at consumption and retains EOF cursors", async () => {
  const retention = new AwkRetention(4), input = source([Buffer.from("a\nb\n")]);
  const reader = new Reader(input.stream, budget(4), retention);
  assert.equal(await reader.read("\n"), "a"); assert.equal(retention.retainedBytes, 4);
  assert.equal(await reader.read("\n"), "b"); assert.equal(retention.retainedBytes, 0);
  assert.equal(await reader.read("\n"), undefined);
  assert.equal(await reader.read("\n"), undefined);
  assert.equal(input.pulls(), 2);
  await reader.close();
});

test("awk reader preserves arbitrary separator changes, paragraph boundaries and raw bytes", async () => {
  const retention = new AwkRetention(64);
  const reader = new Reader(source([Buffer.from("\n\na\nb:c\n"), Buffer.from("\n\nd\n"), Uint8Array.of(255, 0)]).stream, budget(), retention);
  assert.equal(await reader.read(""), "a\nb:c");
  assert.equal(await reader.read("\n"), "d");
  assert.equal(await reader.read(":"), "\xff\x00");
  assert.equal(await reader.read(""), undefined);
  assert.equal(retention.retainedBytes, 0);
  await reader.close();
});

test("awk reader releases capacity and closes exactly once even for falsey return failures", async () => {
  for (const reason of [false, null, 0, ""]) {
    const retention = new AwkRetention(8), input = source([Buffer.from("a\ntail")], async () => { throw reason; });
    const reader = new Reader(input.stream, budget(), retention);
    assert.equal(await reader.read("\n"), "a");
    await assert.rejects(reader.close(), error => Object.is(error, reason));
    await assert.rejects(reader.close(), error => Object.is(error, reason));
    assert.equal(retention.retainedBytes, 0);
    assert.equal(input.returns(), 1);
    assert.equal(await reader.read("\n"), undefined);
  }
});

test("awk reader concurrent close prevents late input publication", async () => {
  let deliver!: (value: IteratorResult<Uint8Array>) => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => { deliver = resolve; });
  let returns = 0;
  const input: ByteSource = { [Symbol.asyncIterator]() { return { next: () => pending, async return() { returns++; return { done: true, value: undefined }; } }; } };
  const retention = new AwkRetention(8), reader = new Reader(input, budget(), retention);
  const reading = reader.read("\n");
  const closing = reader.close(), again = reader.close();
  deliver({ done: false, value: Buffer.from("a\ntail") });
  assert.equal(await reading, undefined);
  await Promise.all([closing, again]);
  assert.equal(retention.retainedBytes, 0); assert.equal(returns, 1);
});

test("awk reader copies borrowed views before producer reuse without eager pulls", async () => {
  const retention = new AwkRetention(16), backing = Uint8Array.of(255, 195);
  let pulls = 0;
  const input = (async function* () { pulls++; yield backing; backing.set([169, 0]); pulls++; yield backing; backing.fill(120); })();
  const reader = new Reader(input, budget(), retention);
  assert.equal(await reader.read("\n"), "\xff\xc3\xa9\0");
  assert.equal(pulls, 2); assert.equal(retention.retainedBytes, 0);
  await reader.close();
});

test("awk reader keeps per-reader admission independent of aggregate room", async context => {
  const retention = new AwkRetention(64), rejected = Buffer.from("de");
  const input = source([Buffer.from("abc"), rejected, Buffer.from("\n")]);
  const reader = new Reader(input.stream, budget(4), retention);
  context.after(() => reader.close());
  let copied = false;
  context.mock.method(Uint8Array.prototype, "set", function (this: Uint8Array, bytes: ArrayLike<number>, offset?: number) {
    if (bytes === rejected) copied = true;
    return originalSet.call(this, bytes, offset);
  });
  await assert.rejects(reader.read("\n"), /text buffer limit/u);
  assert.equal(copied, false); assert.equal(input.pulls(), 2); assert.equal(retention.retainedBytes, 3);
  await reader.close(); assert.equal(retention.retainedBytes, 0);
});

test("awk reader ignores empty chunks and does not acquire input when closed unused", async () => {
  const retention = new AwkRetention(0), input = source([new Uint8Array(), new Uint8Array()]);
  const reader = new Reader(input.stream, budget(), retention);
  assert.equal(await reader.read("\n"), undefined);
  assert.equal(retention.retainedBytes, 0); assert.equal(input.pulls(), 3);
  await reader.close();
  let acquired = false;
  const unused = new Reader({ [Symbol.asyncIterator]() { acquired = true; throw new Error("unused source acquired"); } }, budget(), retention);
  await unused.close(); assert.equal(await unused.read("\n"), undefined); assert.equal(acquired, false);
});

test("awk reader close shares settlement while releasing storage before a pending return", async () => {
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const retention = new AwkRetention(8), input = source([Buffer.from("a\ntail")], async () => { entered(); await pending; });
  const reader = new Reader(input.stream, budget(), retention);
  await reader.read("\n");
  let settled = false;
  const closing = reader.close();
  const observed = closing.then(() => { settled = true; });
  assert.equal(reader.close(), closing);
  try {
    await started;
    assert.equal(settled, false); assert.equal(retention.retainedBytes, 0); assert.equal(input.returns(), 1);
    assert.equal(await reader.read("\n"), undefined);
  } finally { release(); }
  await observed;
});

for (const reason of [false, null, 0, ""]) {
  test(`awk reader preserves falsey cancellation before acquisition and after a chunk: ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController(), retention = new AwkRetention(8, caller.signal);
    const input = source([Buffer.from("a\ntail")]);
    const reader = new Reader(input.stream, budget(64, caller.signal), retention);
    assert.equal(await reader.read("\n"), "a");
    caller.abort(reason);
    await assert.rejects(reader.read("\n"), error => Object.is(error, reason));
    await reader.close();
    assert.equal(retention.retainedBytes, 0); assert.equal(input.pulls(), 1); assert.equal(input.returns(), 1);
    const untouched = source([Buffer.from("x")]);
    const preAborted = new Reader(untouched.stream, budget(64, caller.signal), retention);
    await assert.rejects(preAborted.read("too long"), error => Object.is(error, reason));
    await preAborted.close(); assert.equal(untouched.pulls(), 0);
  });
}

test("awk reader observes late rejected host reads after cancellation without publishing storage", async () => {
  let reject!: (reason: unknown) => void, entered!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>((_resolve, fail) => { reject = fail; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const caller = new AbortController(), retention = new AwkRetention(8, caller.signal);
  let returns = 0;
  const input: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { entered(); return pending; },
    async return() { returns++; return { done: true, value: undefined }; },
  }; } };
  const reader = new Reader(input, budget(64, caller.signal), retention);
  const reading = assert.rejects(reader.read("\n"), error => Object.is(error, false));
  await started;
  caller.abort(false);
  try {
    await reading; await reader.close();
    assert.equal(retention.retainedBytes, 0); assert.equal(returns, 1);
  } finally { reject(new Error("late host failure")); }
  await Promise.resolve();
});

test("awk reader preserves retained suffixes across many small block releases", async () => {
  const retention = new AwkRetention(1024);
  const data = `${"a".repeat(300)}\n${"b\n".repeat(300)}`;
  const reader = new Reader(source([...Buffer.from(data)].map(byte => Uint8Array.of(byte))).stream, budget(1024), retention);
  assert.equal(await reader.read("\n"), "a".repeat(300));
  for (let index = 0; index < 300; index++) assert.equal(await reader.read("\n"), "b");
  assert.equal(await reader.read("\n"), undefined); assert.equal(retention.retainedBytes, 0);
  await reader.close();
});
