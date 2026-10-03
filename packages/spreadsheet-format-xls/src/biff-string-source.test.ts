import { expect, test } from "vitest";
import { Binary } from "./biff-binary.js";
import { BiffStrings, readBiffStrings } from "./biff-strings.js";

const context = { signal: new AbortController().signal, limits: { inputBytes: 1e6, workbookTextBytes: 1e6 } };

test("decodes shared strings lazily across reused CONTINUE payloads", async () => {
  const bytes = [Uint8Array.of(2, 0, 8, 1, 0, 97), Uint8Array.of(1, 0xb2, 3, 0, 0, 2, 0), Uint8Array.of(1, 0, 0, 99)];
  let reads = 0, closed = false;
  const source = { async *[Symbol.asyncIterator]() {
    const scratch = new Uint8Array(16);
    try { for (const part of bytes) { reads++; scratch.set(part); yield new Binary(scratch.subarray(0, part.length)); } }
    finally { scratch.fill(0); closed = true; }
  } };
  const strings = readBiffStrings(source, 2, context, 1252);
  expect(reads).toBe(0);
  expect((await strings.next()).value).toEqual({ text: "aβ", richText: [{ start: 0, end: 2, attributes: { "biff-font-index": 2 } }] });
  expect(reads).toBe(2);
  expect((await strings.next()).value).toEqual({ text: "c" });
  expect((await strings.next()).done).toBe(true);
  expect(closed).toBe(true);
});

test("matches buffered string decoding at every framing split", async () => {
  // Splits inside string headers, rich-run fields and extensions; character widths switch only at character boundaries.
  const header = [1, 0, 12, 1, 0, 3, 0, 0, 0], tail = [0, 0, 2, 0, 90, 91, 92];
  for (let split = 1; split < header.length; split++) {
    const parts = [new Binary(Uint8Array.from(header.slice(0, split))), new Binary(Uint8Array.from([...header.slice(split), 97, ...tail]))];
    const cursor = new BiffStrings(parts, context, 1252), expected = cursor.unicode(cursor.word());
    const actual = [];
    for await (const string of readBiffStrings((async function* () { yield* parts; })(), 1, context, 1252)) actual.push(string);
    expect(actual).toEqual([expected]);
  }
});

test("closes the active continuation producer on early return, malformed input and cancellation", async () => {
  for (const mode of ["return", "malformed", "abort"] as const) {
    const controller = new AbortController(), failure = new Error("cancelled"), closes: number[] = [];
    const source = { async *[Symbol.asyncIterator]() {
      try {
        yield new Binary(Uint8Array.of(1, 0, mode === "malformed" ? 2 : 0, 97));
        if (mode === "abort") controller.abort(failure);
        yield new Binary(Uint8Array.of(1, 0, 0, 98));
      } finally { closes.push(1); }
    } };
    const strings = readBiffStrings(source, 2, { ...context, signal: controller.signal }, 1252);
    if (mode === "malformed") await expect(strings.next()).rejects.toThrow("flags");
    else {
      expect((await strings.next()).value).toEqual({ text: "a" });
      if (mode === "return") await strings.return();
      else await expect(strings.next()).rejects.toBe(failure);
    }
    expect(closes).toEqual([1]);
  }
});

test("retained BIFF ingestion does not collect shared-string CONTINUE payloads", async () => {
  const { createBiffWriter, readBiff } = await import("./biff.js");
  const { createEngine } = await import("@poe-code/spreadsheet-engine");
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs/core");
  const ctx = { ...context, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 1000, sheets: 5, operations: 100 } };
  const cells = Array.from({ length: 500 }, (_, row) => ({ row, column: 0, value: { kind: "string" as const, value: `${row}:` + "aβ".repeat(100) } }));
  const bytes = await createBiffWriter(8)({ sheets: [{ id: "s", name: "Strings", cells }] }, [], ctx), expected = await readBiff(bytes, ctx);
  const fs = createMemoryFileSystem(), engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, codecs: [{
    id: "fixture", description: "fixture", extensions: [], async readSource(source, ctx) { return readBiff(source, ctx); }
  }] });
  const push = Array.prototype.push;
  Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
    if (items.some(item => item instanceof Binary)) throw new Error("retained CONTINUE payload collection");
    if (items.some(item => item && typeof item === "object" && "text" in item && Object.keys(item).every(key => key === "text" || key === "richText")))
      throw new Error("retained shared string table");
    return push.apply(this, items);
  };
  try {
    const result = await engine.readWorkbook({ kind: "range", source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } } },
      { importType: "fixture" }, { signal: context.signal });
    expect(result.sheets[0]!.cells).toEqual(expected.sheets[0]!.cells);
  } finally { Array.prototype.push = push; await engine.dispose(); }
  expect(await fs.readdir("/")).toEqual([]);
});

test("preserves source and producer cleanup failures together", async () => {
  const readFailure = new Error("source failed"), closeFailure = new Error("close failed");
  const strings = readBiffStrings({ [Symbol.asyncIterator]() { return {
    async next(): Promise<IteratorResult<Binary>> { throw readFailure; },
    async return(): Promise<IteratorResult<Binary>> { throw closeFailure; }
  }; } }, 1, context, 1252);
  await expect(strings.next()).rejects.toMatchObject({ errors: [readFailure, closeFailure] });
});

test("does not acquire an already cancelled continuation producer", async () => {
  const controller = new AbortController(), failure = new Error("cancelled before reading"); controller.abort(failure);
  let acquired = false;
  const strings = readBiffStrings({ [Symbol.asyncIterator]() { acquired = true; throw new Error("unexpected acquisition"); } },
    1, { ...context, signal: controller.signal }, 1252);
  await expect(strings.next()).rejects.toBe(failure);
  expect(acquired).toBe(false);
});
