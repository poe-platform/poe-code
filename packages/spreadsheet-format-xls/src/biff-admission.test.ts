import { expect, test } from "vitest";
import { Binary, readBiffRecords } from "./biff-binary.js";
import { BiffStrings } from "./biff-strings.js";

const base = { signal: new AbortController().signal,
  limits: { inputBytes: 10000, workbookTextBytes: 1000, workbookNodes: 100 } };

test("BIFF records share a caller work budget, including padding scans", () => {
  for (const bytes of [Uint8Array.of(10, 0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0), new Uint8Array(20)]) {
    let remaining = 2;
    expect(() => readBiffRecords(bytes, { ...base, work() {
      if (--remaining < 0) throw new Error("aggregate work exhausted");
    } })).toThrow("aggregate work exhausted");
  }
});

test("BIFF record storage is admitted before materializing the record array", () => {
  expect(() => readBiffRecords(Uint8Array.of(10, 0, 0, 0), { ...base, retain() {
    throw new Error("aggregate storage exhausted");
  } })).toThrow("aggregate storage exhausted");
});

for (const unicode of [false, true]) test(`BIFF ${unicode ? "Unicode" : "legacy"} strings share work and storage budgets`, () => {
  const bytes = unicode ? Uint8Array.of(0, 97, 98, 99) : Uint8Array.of(97, 98, 99);
  for (const budget of ["work", "retain"] as const) {
    let remaining = 2;
    const cursor = new BiffStrings([new Binary(bytes)], { ...base, [budget](amount = 1) {
      remaining -= amount;
      if (remaining < 0) throw new Error(`aggregate ${budget} exhausted`);
    } }, 1252);
    expect(() => unicode ? cursor.unicode(3) : cursor.legacy(3)).toThrow(`aggregate ${budget} exhausted`);
  }
});

test("BIFF admission preserves continued Unicode text and rich runs", () => {
  let work = 0, retained = 0;
  const cursor = new BiffStrings([
    new Binary(Uint8Array.of(8, 1, 0, 97)),
    new Binary(Uint8Array.of(1, 0xb2, 3, 0, 0, 2, 0))
  ], { ...base, work() { work++; }, retain(bytes) { retained += bytes; } }, 1252);
  expect(cursor.unicode(2)).toEqual({ text: "aβ", richText: [
    { start: 0, end: 2, attributes: { "biff-font-index": 2 } }
  ] });
  expect(work).toBeGreaterThan(2);
  expect(retained).toBeGreaterThan(4);
});
