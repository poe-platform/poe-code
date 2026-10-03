import { expect, test } from "vitest";
import type { CapabilityContext, WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";
import { createBiffSharedStrings } from "./biff-shared-strings.js";

function fixture() {
  const cleanup: (() => unknown)[] = [], data: Uint8Array[] = [], scratch = new Uint8Array(16384);
  let writes = 0, reads = 0, closed = 0;
  const context: CapabilityContext = {
    signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 10000, sheets: 10, operations: 100 },
    own(fn) { cleanup.push(fn); },
    createWorkingStorage() {
      expect(cleanup.length).toBeGreaterThan(0);
      const bytes = new Uint8Array(2e6); data.push(bytes); let end = 0;
      return { allocate(length) { const position = end; end += length; return position; },
        async read(position, length) { reads++; expect(length).toBeLessThanOrEqual(16384); scratch.set(bytes.subarray(position, position + length)); return scratch.subarray(0, length); },
        async write(position, chunk) { expect(chunk.length).toBeLessThanOrEqual(16384); writes += chunk.length; await Promise.resolve(); bytes.set(chunk, position); },
        async close() { closed++; }
      } satisfies WorkingStorage;
    }
  };
  return { context, data, cleanup, get reads() { return reads; }, get writes() { return writes; }, get closed() { return closed; } };
}

test("stores shared text and rich runs in bounded caller transfers with random access", async () => {
  const f = fixture(), strings = createBiffSharedStrings(f.context);
  const values = Array.from({ length: 1000 }, (_, i) => ({ text: `${i}:aβ\ud800\udfff`, ...(i % 2 ? { richText: [{ start: 0, end: 2, attributes: { "biff-font-index": 3 } }] } : {}) }));
  for (const value of values) await strings.append(value);
  const large = { text: "aβ".repeat(32767), richText: [{ start: 1, end: 65534, attributes: { "biff-font-index": 65535 } }] };
  await strings.append(large);
  for (const i of [999, 0, 501, 1, 1000, 3]) expect(await strings.get(i)).toEqual(i === 1000 ? large : values[i]);
  expect(await strings.get(1001)).toBeUndefined();
  expect(await strings.get(-1)).toBeUndefined();
  expect(f.writes).toBeLessThan(300000);
  for (const close of f.cleanup) await close();
  expect(f.closed).toBe(2);
  await expect(strings.get(0)).rejects.toThrow("closed");
});

test("registers disposal before acquisition and does not acquire after immediate disposal", () => {
  const f = fixture(); let acquired = false;
  expect(() => createBiffSharedStrings({ ...f.context, own(close) { void close(); }, createWorkingStorage() { acquired = true; throw new Error("acquired"); } })).toThrow("closed");
  expect(acquired).toBe(false);
});

test("preserves borrowed values across staging and interleaved reads", async () => {
  const f = fixture(), strings = createBiffSharedStrings(f.context);
  const value = { text: "first", richText: [{ start: 0, end: 3, attributes: { "biff-font-index": 1 } }] };
  await strings.append(value); value.text = "changed"; value.richText[0]!.attributes["biff-font-index"] = 4;
  expect(await strings.get(0)).toEqual({ text: "first", richText: [{ start: 0, end: 3, attributes: { "biff-font-index": 1 } }] });
  await strings.append({ text: "second" });
  expect(await strings.get(1)).toEqual({ text: "second" });
  expect((await strings.get(0))!.text).toBe("first");
  for (const close of f.cleanup) await close();
});

 test("keeps sequential shared-string lookup within fixed read windows", async () => {
  const f = fixture(), strings = createBiffSharedStrings(f.context);
  for (let i = 0; i < 1000; i++) await strings.append({ text: `${i}: aβ` });
  for (let i = 0; i < 1000; i++) expect((await strings.get(i))!.text).toBe(`${i}: aβ`);
  expect(f.reads).toBeLessThan(10);
  for (const close of f.cleanup) await close();
});

test("revokes failed staging and erases borrowed scratch bytes", async () => {
  const f = fixture(), failure = new Error("write failed"), borrowed: Uint8Array[] = [];
  const strings = createBiffSharedStrings({ ...f.context, createWorkingStorage() {
    const store = f.context.createWorkingStorage!();
    return { ...store, async write(_position, chunk) { borrowed.push(chunk); throw failure; } };
  } });
  await expect(strings.append({ text: "private".repeat(5000) })).rejects.toBe(failure);
  expect(borrowed.length).toBeGreaterThan(0);
  expect(borrowed.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
  await expect(strings.get(0)).rejects.toThrow("closed");
  for (const close of f.cleanup) await close();
  expect(f.closed).toBe(2);
});

test("checks cancellation after backing reads and closes both stores on cleanup failure", async () => {
  const f = fixture(), controller = new AbortController(), failure = new Error("cancelled"), first = new Error("first close"), second = new Error("second close");
  let ordinal = 0;
  const strings = createBiffSharedStrings({ ...f.context, signal: controller.signal, createWorkingStorage() {
    const store = f.context.createWorkingStorage!(), error = ordinal++ ? second : first;
    return { ...store, async read(position, length) { const result = await store.read(position, length); controller.abort(failure); return result; },
      async close() { await store.close(); throw error; } };
  } });
  await strings.append({ text: "private" });
  await expect(strings.get(0)).rejects.toBe(failure);
  await expect(f.cleanup[0]!()).rejects.toMatchObject({ errors: [first, second] });
  expect(f.closed).toBe(2);
});

test("preserves rich runs across storage and cache windows", async () => {
  const f = fixture(), strings = createBiffSharedStrings(f.context);
  const value = { text: "aβ", richText: Array.from({ length: 1500 }, (_, i) => ({ start: 0, end: 2, attributes: { "biff-font-index": i } })) };
  await strings.append(value);
  expect(await strings.get(0)).toEqual(value);
  for (const close of f.cleanup) await close();
});
