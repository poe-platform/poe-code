import assert from "node:assert/strict";
import test from "node:test";
import type { ByteSource } from "../../../../src/contracts/index.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { ShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

function chunks(bytes: Uint8Array, size = bytes.length || 1): ByteSource {
  return { async *[Symbol.asyncIterator]() {
    for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
  } };
}

function fixture(source: ByteSource, controller = new AbortController(), limits: Partial<typeof defaultLimits> = {}) {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000, ...limits }, controller.signal);
  const input = new ShellInput(source, budget);
  return { budget, input, async close() {
    try { await input.close(); } finally { budget.close(); budget.values.close(); }
  } };
}

const rawCases = [
  { name: "empty EOF", hex: "", delimiter: 10, records: [["eof", ""]] },
  { name: "empty delimited record", hex: "0a", delimiter: 10, records: [["delimiter", "0a"], ["eof", ""]] },
  { name: "embedded NUL boundary", hex: "6100620a630a", delimiter: 10, records: [["delimiter", "6100620a"], ["delimiter", "630a"], ["eof", ""]] },
  { name: "raw escapes and invalid UTF8", hex: "ff5c0afe5c00", delimiter: 10, records: [["delimiter", "ff5c0a"], ["eof", "fe5c00"]] },
  { name: "consecutive NUL records", hex: "0061000062", delimiter: 0, records: [["delimiter", "00"], ["delimiter", "6100"], ["delimiter", "00"], ["eof", "62"]] },
  { name: "custom ASCII delimiter", hex: "613a623a3a7461696c", delimiter: 58, records: [["delimiter", "613a"], ["delimiter", "623a"], ["delimiter", "3a"], ["eof", "7461696c"]] },
  { name: "invalid byte delimiter", hex: "61ff62ff", delimiter: 255, records: [["delimiter", "61ff"], ["delimiter", "62ff"], ["eof", ""]] },
  { name: "delimiter inside multibyte UTF8", hex: "c3a9c3a9", delimiter: 169, records: [["delimiter", "c3a9"], ["delimiter", "c3a9"], ["eof", ""]] },
] as const;

for (const entry of rawCases) for (const size of [1, 2, 7]) test(`raw record ${entry.name}, chunk size ${size}`, async () => {
  const subject = fixture(chunks(Buffer.from(entry.hex, "hex"), size));
  try {
    for (const [reason, hex] of entry.records) {
      const record = await subject.input.record({ delimiter: entry.delimiter });
      assert.equal(Object.isFrozen(record), true);
      assert.equal(record.reason, reason);
      assert.equal(Buffer.from(shellValueBytes(record.shellValue)).toString("hex"), hex);
      const releasing = record.release();
      assert.equal(record.release(), releasing);
      await releasing;
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    }
  } finally { await subject.close(); }
});

test("VFS raw records and read share the cursor without changing read's NUL semantics", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/input", Buffer.from("a\0b\nc\0d\ntail\n"));
  const subject = fixture(filesystem.readStream("/input", { chunkSize: 2 }));
  const borrowed = new ShellInput(subject.input, subject.budget);
  try {
    const record = await subject.input.record();
    assert.deepEqual(Buffer.from(shellValueBytes(record.shellValue)), Buffer.from("a\0b\n"));
    const line = await borrowed.line(true);
    assert.equal(line.reason, "delimiter");
    assert.deepEqual(Buffer.from(shellValueBytes(line.shellValue)), Buffer.from("cd"));
    assert.deepEqual(Buffer.from((await subject.input.sourceLine())!), Buffer.from("tail\n"));
    assert.equal(await subject.input.sourceLine(), undefined);
    await record.release();
    await line.release();
  } finally { await borrowed.close(); await subject.close(); }
});

test("concurrent borrowed record operations serialize and restore the same fragment remainder", async () => {
  const subject = fixture(chunks(Buffer.from("one\ntwo\nthree\n")));
  const borrowed = new ShellInput(subject.input, subject.budget);
  try {
    const records = await Promise.all([subject.input.record(), borrowed.record(), subject.input.record()]);
    assert.deepEqual(records.map(record => Buffer.from(shellValueBytes(record.shellValue)).toString()), ["one\n", "two\n", "three\n"]);
    await Promise.all(records.map(record => record.release()));
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await borrowed.close(); await subject.close(); }
});

test("retained values survive producer buffer reuse and consumer byte mutation", async () => {
  const buffer = Uint8Array.of(255, 0, 10);
  const subject = fixture({ async *[Symbol.asyncIterator]() {
    yield buffer;
    buffer.set([254, 92, 10]);
    yield buffer;
    buffer.fill(65);
  } });
  try {
    const first = await subject.input.record();
    const second = await subject.input.record();
    const eof = await subject.input.record();
    shellValueBytes(first.shellValue).fill(90);
    assert.deepEqual(shellValueBytes(first.shellValue), Uint8Array.of(255, 0, 10));
    assert.deepEqual(shellValueBytes(second.shellValue), Uint8Array.of(254, 92, 10));
    assert.equal(eof.reason, "eof");
    await first.release();
    await second.release();
    await eof.release();
  } finally { await subject.close(); }
});

test("a retained consumer value remains charged after its record is released", async () => {
  const subject = fixture(chunks(Uint8Array.of(255, 0, 10)));
  const consumer = subject.budget.values.scope();
  try {
    const record = await subject.input.record();
    const held = consumer.hold(record.shellValue);
    await record.release();
    assert.ok(subject.budget.values.usage.bytes > 0);
    assert.deepEqual(shellValueBytes(held.value), Uint8Array.of(255, 0, 10));
    consumer.close();
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { consumer.close(); await subject.close(); }
});

for (const delimiter of [-1, 256, 0.5, NaN, Infinity]) test(`invalid raw delimiter is refused without pulling: ${String(delimiter)}`, async () => {
  let pulls = 0;
  const subject = fixture({ async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(10); } });
  try {
    await assert.rejects(subject.input.record({ delimiter }), RangeError);
    assert.equal(pulls, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("delimiter selection is captured before producer-controlled mutation", async () => {
  const options = { delimiter: 58 };
  const subject = fixture({ async *[Symbol.asyncIterator]() { options.delimiter = 10; yield Buffer.from("a:b\n"); } });
  try {
    const record = await subject.input.record(options);
    assert.equal(Buffer.from(shellValueBytes(record.shellValue)).toString(), "a:");
    await record.release();
  } finally { await subject.close(); }
});

for (const limits of [{ maxOutputBytes: 3 }, { maxExpansionBytes: 128 }, { maxExpansionFields: 1 }]) {
  test(`raw record admission enforces existing limits: ${JSON.stringify(limits)}`, async () => {
    const subject = fixture(chunks(Buffer.from("a\0b\n")), new AbortController(), limits);
    let failure: unknown;
    try {
      await assert.rejects(subject.input.record(), error => {
        failure = error;
        return error instanceof ShellLimitError && error.limit === Object.keys(limits)[0];
      });
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    } finally { await subject.close().catch(error => { assert.equal(error, failure); }); }
  });
}

test("short records do not duplicate the entire unread producer fragment", async () => {
  const bytes = new Uint8Array(1_048_576);
  bytes.set([255, 0, 10]);
  const subject = fixture(chunks(bytes), new AbortController(), { maxOutputBytes: 3, maxExpansionBytes: 1024 });
  const NativeBytes = Uint8Array;
  let fullCopies = 0;
  globalThis.Uint8Array = new Proxy(NativeBytes, {
    construct(target, argumentsList, newTarget) {
      const input: unknown = argumentsList[0];
      if (input instanceof NativeBytes && input.byteLength >= bytes.byteLength) fullCopies++;
      return Reflect.construct(target, argumentsList, newTarget);
    },
  });
  try {
    const record = await subject.input.record();
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
    assert.ok(subject.budget.values.usage.bytes <= 1024);
    assert.equal(fullCopies, 0);
    await record.release();
  } finally { globalThis.Uint8Array = NativeBytes; await subject.close(); }
});

test("a long raw record spans bounded buffers and releases all reservations", async () => {
  const bytes = new Uint8Array(16_389);
  bytes.fill(255);
  bytes[0] = 0;
  bytes[bytes.length - 1] = 10;
  const subject = fixture(chunks(bytes, 127));
  try {
    const record = await subject.input.record();
    assert.deepEqual(shellValueBytes(record.shellValue), bytes);
    await record.release();
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

for (const reason of [false, 0, "", null, NaN]) test(`falsey raw-read cancellation retains its identity: ${String(reason)}`, async () => {
  const controller = new AbortController();
  const subject = fixture({ [Symbol.asyncIterator]() { return {
    next: () => new Promise<IteratorResult<Uint8Array>>(() => {}),
    return: async () => ({ done: true as const, value: undefined }),
  }; } }, controller);
  try {
    const pending = subject.input.record();
    controller.abort(reason);
    await assert.rejects(pending, error => Object.is(error, reason));
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close().catch(() => {}); }
});

test("empty producers yield cooperatively without fabricating EOF", { timeout: 2000 }, async () => {
  let pulls = 0;
  const controller = new AbortController();
  const subject = fixture({ async *[Symbol.asyncIterator]() { while (true) { pulls++; yield new Uint8Array(); } } }, controller);
  const timer = setImmediate(() => controller.abort(false));
  try {
    await assert.rejects(subject.input.record(), error => error === false);
    assert.ok(pulls > 0 && pulls <= 256);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { clearImmediate(timer); await subject.close().catch(() => {}); }
});

test("closing a borrowed raw reader retains its pending pull for the owner", async () => {
  let pulls = 0;
  let returns = 0;
  let send!: (result: IteratorResult<Uint8Array>) => void;
  const subject = fixture({ [Symbol.asyncIterator]() { return {
    next() { pulls++; return new Promise<IteratorResult<Uint8Array>>(resolve => { send = resolve; }); },
    async return() { returns++; return { done: true as const, value: undefined }; },
  }; } });
  const borrowed = new ShellInput(subject.input, subject.budget);
  try {
    const pending = borrowed.record();
    const rejected = assert.rejects(pending, /closed/);
    await new Promise<void>(resolve => setImmediate(resolve));
    await borrowed.close();
    await rejected;
    assert.equal(returns, 0);
    send({ done: false, value: Uint8Array.of(255, 0, 10) });
    const record = await subject.input.record();
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
    assert.equal(pulls, 1);
    await record.release();
  } finally { await borrowed.close(); await subject.close(); }
});

test("owning close drains active and queued raw operations and releases completed records", async () => {
  let returns = 0;
  let pulls = 0;
  const subject = fixture({ [Symbol.asyncIterator]() { return {
    next() {
      if (pulls++ === 0) return Promise.resolve({ done: false as const, value: Uint8Array.of(10) });
      return new Promise<IteratorResult<Uint8Array>>(() => {});
    },
    async return() { returns++; return { done: true as const, value: undefined }; },
  }; } });
  try {
    const record = await subject.input.record();
    const active = assert.rejects(subject.input.record(), /closed/);
    const queued = assert.rejects(subject.input.record(), /closed/);
    await new Promise<void>(resolve => setImmediate(resolve));
    const closing = subject.input.close();
    assert.equal(subject.input.close(), closing);
    await closing;
    await Promise.all([active, queued, record.release()]);
    assert.equal(returns, 1);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("raw records consume the retained pending pull after a timed read without dropping NUL bytes", async () => {
  let pulls = 0;
  let now = 0;
  let expire!: () => void;
  let send!: (result: IteratorResult<Uint8Array>) => void;
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 });
  const input = new ShellInput({ [Symbol.asyncIterator]() { return {
    next() { pulls++; return new Promise<IteratorResult<Uint8Array>>(resolve => { send = resolve; }); },
    async return() { return { done: true as const, value: undefined }; },
  }; } }, budget, budget.signal, {
    provenance: "stream", clock: { now: () => now, schedule(_delay, callback) { expire = callback; return () => {}; } },
  });
  try {
    const pending = input.line(true, { timeoutMs: 1 });
    await new Promise<void>(resolve => setImmediate(resolve));
    now = 1;
    expire();
    const timed = await pending;
    assert.equal(timed.reason, "timeout");
    await timed.release();
    send({ done: false, value: Uint8Array.of(255, 0, 10) });
    const record = await input.record();
    assert.equal(pulls, 1);
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
    await record.release();
  } finally { await input.close(); budget.close(); budget.values.close(); }
});

for (const reason of [false, null]) test(`a late falsey producer failure releases a partial raw record: ${String(reason)}`, async () => {
  const subject = fixture({ async *[Symbol.asyncIterator]() { yield Uint8Array.of(255, 0); throw reason; } });
  try {
    await assert.rejects(subject.input.record(), error => error === reason);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("delimiter getter cancellation wins over malformed delimiter validation", async () => {
  const controller = new AbortController();
  let pulls = 0;
  const subject = fixture({ async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(10); } }, controller);
  try {
    await assert.rejects(subject.input.record({ get delimiter() { controller.abort(false); return -1; } }), error => error === false);
    assert.equal(pulls, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close().catch(() => {}); }
});

const nativeCases = [
  { name: "embedded NUL", input: "a\0b\nc\n", delimiter: 10, flag: "" },
  { name: "NUL-first nonempty raw record", input: "\0b\n\n", delimiter: 10, flag: "" },
  { name: "empty input", input: "", delimiter: 10, flag: "" },
  { name: "unterminated record", input: "a\nlast", delimiter: 10, flag: "" },
  { name: "NUL delimiter", input: "one\0\0two\0tail", delimiter: 0, flag: "-d ''" },
  { name: "first byte delimiter", input: "a:b::tail", delimiter: 58, flag: "-d '::'" },
  { name: "literal backslashes", input: "a\\\nb\\c\n", delimiter: 10, flag: "" },
] as const;

for (const entry of nativeCases) for (const trim of [false, true]) test(`mapfile projection witness: ${entry.name}, trim=${trim}`, nativeOptions(), async () => {
  const native = runNative(`mapfile ${trim ? "-t" : ""} ${entry.flag} records; printf '%s:%s\\n' "$?" "\${#records[@]}"; for value in "\${records[@]}"; do printf '%s\\0' "$value"; done`, entry.input);
  assert.equal(native.status, 0);
  assert.equal(native.stderr.length, 0);
  for (const size of [1, 7]) {
    const subject = fixture(chunks(Buffer.from(entry.input), size));
    try {
      const values: Uint8Array[] = [];
      while (true) {
        const record = await subject.input.record({ delimiter: entry.delimiter });
        try {
          const bytes = shellValueBytes(record.shellValue);
          if (record.reason === "eof" && !bytes.length) break;
          const nul = bytes.indexOf(0);
          let end = nul < 0 ? bytes.length : nul;
          if (trim && end > 0 && bytes[end - 1] === entry.delimiter) end--;
          values.push(bytes.slice(0, end));
          if (record.reason === "eof") break;
        } finally { await record.release(); }
      }
      const output = Buffer.concat([Buffer.from(`0:${values.length}\n`), ...values.flatMap(value => [value, Uint8Array.of(0)])]);
      assert.deepEqual(output, native.stdout);
    } finally { await subject.close(); }
  }
});
