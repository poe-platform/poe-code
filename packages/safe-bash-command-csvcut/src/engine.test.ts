import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsvRecords, CsvBudget, resolveColumns, serializeRow, generatedHeaders } from "./index.js";

test("csvcut record capability reads bytes and retires producer on early return", async () => {
  const ac = new AbortController();
  let retired = 0;
  const source = async function* (signal: AbortSignal): AsyncGenerator<Uint8Array> {
    assert.equal(signal, ac.signal);
    try { yield new TextEncoder().encode('a,b\n"x\ny",z\n'); }
    finally { retired++; }
  };
  const stream = parseCsvRecords(source, { signal: ac.signal });
  assert.deepEqual((await stream.next()).value, { cells: ["a", "b"], line: 1 });
  await stream.return();
  assert.equal(retired, 1);
});
test("engine preserves every individual byte chunk including BOM and UTF-8", async () => {
  const source = async function* (): AsyncGenerator<Uint8Array> {
    for (const byte of new TextEncoder().encode('\ufeffa,b,\r\n"é\nq","a""b",\r\n')) yield Uint8Array.of(byte);
  };
  const rows = [];
  for await (const row of parseCsvRecords(source, { signal: new AbortController().signal })) rows.push(row);
  assert.deepEqual(rows, [{ cells: ["a", "b", ""], line: 1 }, { cells: ["é\nq", 'a"b', ""], line: 3 }]);
});
test("cancellation and quota errors retire producer; new invocations remain independent", async () => {
  for (const cancel of [false, true]) {
    const ac = new AbortController();
    let retired = false;
    const source = async function* (): AsyncGenerator<Uint8Array> {
      try { if (cancel) ac.abort(false); yield Uint8Array.of(97); }
      finally { retired = true; }
    };
    let caught: unknown = "missing";
    try { for await (const row of parseCsvRecords(source, { signal: ac.signal, limits: { inputBytes: 0 } })) void row; }
    catch (error) { caught = error; }
    if (cancel) assert.equal(caught, false);
    else assert.equal((caught as { code: string }).code, "LIMIT");
    assert.equal(retired, true);
  }
  const source = async function* (): AsyncGenerator<Uint8Array> { yield Uint8Array.of(97); };
  assert.deepEqual((await parseCsvRecords(source, { signal: new AbortController().signal }).next()).value, { cells: ["a"], line: 1 });
});
test("pure selector, headers and writer share canonical engine contracts", () => {
  const b = new CsvBudget({}, new AbortController().signal);
  assert.deepEqual(resolveColumns({ include: "3,1,3" }, ["id", "name", "note"], b), [2, 0, 2]);
  assert.deepEqual(generatedHeaders(29, b).slice(25), ["z", "aa", "bb", "cc"]);
  assert.equal(serializeRow(["a\r\nb", ""], b), '"a\n\nb",\n');
});
test("pending cooperative reads receive cancellation and retire", async () => {
  const ac = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let retired = false;
  const source = async function* (signal: AbortSignal): AsyncGenerator<Uint8Array> {
    try {
      started();
      await new Promise<void>((_, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
      yield Uint8Array.of(97);
    } finally { retired = true; }
  };
  const stream = parseCsvRecords(source, { signal: ac.signal });
  const pending = stream.next();
  await ready;
  ac.abort(null);
  let reason: unknown = "missing";
  try { await pending; } catch (error) { reason = error; }
  assert.equal(reason, null);
  assert.equal(retired, true);
});
test("producer reuse and malformed records do not leak parser state", async () => {
  const bytes = new Uint8Array(2);
  const source = async function* (): AsyncGenerator<Uint8Array> {
    bytes.set([97, 44]); yield bytes;
    bytes.set([98, 10]); yield bytes;
  };
  const rows = [];
  for await (const row of parseCsvRecords(source, { signal: new AbortController().signal })) rows.push(row);
  assert.deepEqual(rows, [{ cells: ["a", "b"], line: 1 }]);
  let retired = false;
  const invalid = async function* (): AsyncGenerator<Uint8Array> {
    try { yield new TextEncoder().encode('"a"b\n'); }
    finally { retired = true; }
  };
  await assert.rejects(parseCsvRecords(invalid, { signal: new AbortController().signal }).next(), { code: "INPUT" });
  assert.equal(retired, true);
});
test("stream captures invocation signal before handing authority to producer", async () => {
  const original = new AbortController();
  const replacement = new AbortController();
  replacement.abort(false);
  const options = { signal: original.signal };
  const source = async function* (signal: AbortSignal): AsyncGenerator<Uint8Array> {
    assert.equal(signal, original.signal);
    options.signal = replacement.signal;
    yield new TextEncoder().encode("a\n");
  };
  const rows = [];
  for await (const row of parseCsvRecords(source, options)) rows.push(row);
  assert.deepEqual(rows, [{ cells: ["a"], line: 1 }]);
});
test("an undefined profile from a JavaScript caller retains the strict default", async () => {
  const source = async function* (): AsyncGenerator<Uint8Array> { yield new TextEncoder().encode('"unfinished'); };
  await assert.rejects(parseCsvRecords(source, {
    signal: new AbortController().signal, dialect: { profile: undefined } as never
  }).next(), { code: "INPUT" });
});

test("rejected custom producer reads retire once and preserve falsey primary failures", async () => {
  for (const synchronous of [false, true]) for (const reason of [false, 0, "", null, undefined]) {
    let retired = 0;
    const source = (): AsyncIterable<Uint8Array> => ({
      [Symbol.asyncIterator]() {
        return {
          async next() { throw reason; },
          return(): Promise<IteratorResult<Uint8Array>> {
            retired++;
            const error = new Error("cleanup failure");
            if (synchronous) throw error;
            return Promise.reject(error);
          }
        };
      }
    });
    let caught: unknown = "missing";
    try { await parseCsvRecords(source, { signal: new AbortController().signal }).next(); }
    catch (error) { caught = error; }
    assert.equal(caught, reason);
    assert.equal(retired, 1);
  }
});

test("custom producers retire on EOF and early return, reporting cleanup-only failures", async () => {
  for (const early of [false, true]) for (const reason of [false, 0, "", null, undefined]) {
    let reads = 0;
    let retired = 0;
    const source = (): AsyncIterable<Uint8Array> => ({
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            return ++reads === 1 ? { done: false, value: new TextEncoder().encode("a\n") } : { done: true, value: undefined };
          },
          async return() { retired++; throw reason; }
        };
      }
    });
    const stream = parseCsvRecords(source, { signal: new AbortController().signal });
    assert.deepEqual((await stream.next()).value, { cells: ["a"], line: 1 });
    let caught: unknown = "missing";
    try { if (early) await stream.return(); else await stream.next(); }
    catch (error) { caught = error; }
    assert.equal(caught, reason);
    assert.equal(reads, early ? 1 : 2);
    assert.equal(retired, 1);
  }
});

test("record iteration captures the producer next method and preserves its receiver", async () => {
  let reads = 0;
  let retired = 0;
  const producer: AsyncIterator<Uint8Array> = {
    async next() {
      assert.equal(this, producer);
      producer.next = async () => { throw new Error("replacement next must not run"); };
      return ++reads === 1 ? { done: false, value: new TextEncoder().encode("a\n") } : { done: true, value: undefined };
    },
    async return() { retired++; return { done: true, value: undefined }; }
  };
  const source = (): AsyncIterable<Uint8Array> => ({ [Symbol.asyncIterator]: () => producer });
  const rows = [];
  for await (const row of parseCsvRecords(source, { signal: new AbortController().signal })) rows.push(row);
  assert.deepEqual(rows, [{ cells: ["a"], line: 1 }]);
  assert.equal(reads, 2);
  assert.equal(retired, 1);
});
