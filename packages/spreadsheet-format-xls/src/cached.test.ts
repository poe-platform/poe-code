import { expect, test } from "vitest";
import { readCachedBiff, type CachedBiffOptions } from "./cached.js";
import reference from "../../../docs/csvkit/workbook-stress-reference.json" with { type: "json" };

const options: CachedBiffOptions = {
  signal: new AbortController().signal,
  limits: { inputBytes: 100000, workbookNodes: 10000, workbookTextBytes: 10000, cells: 1000, sheets: 10 },
  work() {}, retain() {}
};
function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2), view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return bytes;
}
function record(opcode: number, ...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from([...words(opcode, parts.reduce((size, part) => size + part.length, 0)), ...parts.flatMap(part => [...part])]);
}
function book(...records: Uint8Array[]): Uint8Array {
  return Uint8Array.from([...record(0x809, words(0x600, 0x10)), ...records.flatMap(part => [...part]), ...record(10)]);
}
function formula(row: number, tag?: number, value = 42): Uint8Array {
  const bytes = new Uint8Array(23), view = new DataView(bytes.buffer);
  view.setUint16(0, row, true);
  if (tag === undefined) view.setFloat64(6, value, true);
  else { bytes[6] = tag; bytes[8] = value; bytes[12] = 255; bytes[13] = 255; }
  view.setUint16(20, 1, true); bytes[22] = 255; // Deliberately untranslatable token.
  return record(6, bytes);
}

test("cached BIFF reads formula results without translating tokens, names or formatting-only blanks", () => {
  const input = book(record(0x200, new Uint8Array(14).fill(255)), record(0x18, Uint8Array.of(255)),
    formula(0), formula(1, 3), formula(2, 1, 1), formula(3, 2, 7),
    record(0x201, words(65535, 255, 0)), record(0xbe, words(65535, 0, 0, 0)));
  expect(readCachedBiff(input, options)).toEqual({ date1904: false, sheets: [{ name: "Sheet1", cells: [
    { row: 0, column: 0, type: "n", value: 42, format: 0 },
    { row: 1, column: 0, type: "s", value: "", format: 0 },
    { row: 2, column: 0, type: "b", value: true, format: 0 },
    { row: 3, column: 0, type: "e", value: 7, format: 0 }
  ] }] });
});

test("cached BIFF consumes a continued string cache after an ignored shared formula", () => {
  const input = book(formula(0, 0), record(0x4bc, new Uint8Array(10)),
    record(0x207, words(2), Uint8Array.of(0, 97)), record(0x3c, Uint8Array.of(1, 0xb2, 3)));
  expect(readCachedBiff(input, options).sheets[0]!.cells[0]!.value).toBe("aβ");
});

test("cached BIFF uses explicit legacy encoding over CODEPAGE and Latin-1 when neither exists", () => {
  const bytes = Uint8Array.from(Buffer.from(reference.binary["biff5-codepage"], "base64"));
  for (const [encoding, expected] of [[1252, "café"], [437, "cafΘ"], [28591, "café"]] as const) {
    expect(readCachedBiff(bytes, { ...options, encoding }).sheets[0]!.cells.map(cell => cell.value)).toEqual(["heading", expected]);
  }
  const raw = Uint8Array.from([...record(0x809, words(0x500, 0x10)),
    ...record(0x204, words(0, 0, 0, 1), Uint8Array.of(0x80)), ...record(10)]);
  expect(readCachedBiff(raw, options).sheets[0]!.cells[0]!.value).toBe("\u0080");
});

for (const revision of [2, 3, 4, 5, 8]) test(`cached BIFF${revision} reads raw worksheet text and numeric cells`, () => {
  const bof = revision < 5 ? [9, 0x209, 0x409][revision - 2]! : 0x809;
  const start = revision === 2 ? 7 : 6;
  const number = new Uint8Array(start + 8);
  new DataView(number.buffer).setFloat64(start, 1.5, true);
  const label = revision === 2 ? record(4, words(1, 0), Uint8Array.of(0, 0, 0, 1, 65)) :
    record(0x204, words(1, 0, 0, 1), Uint8Array.from(revision === 8 ? [0, 65] : [65]));
  const bytes = Uint8Array.from([...record(bof, words(revision === 8 ? 0x600 : 0x500, 0x10)),
    ...record(revision === 2 ? 3 : 0x203, number), ...label, ...record(10)]);
  expect(readCachedBiff(bytes, options).sheets[0]!.cells.map(cell => cell.value)).toEqual([1.5, "A"]);
});

test("cached BIFF admits aggregate resources and rejects truncated records or missing string caches", () => {
  const bytes = book(formula(0));
  for (const budget of ["work", "retain"] as const) expect(() => readCachedBiff(bytes, {
    ...options, [budget]() { throw new Error(`${budget} exhausted`); }
  })).toThrow(`${budget} exhausted`);
  expect(() => readCachedBiff(bytes, { ...options, limits: { ...options.limits, cells: 0 } })).toThrow(/cells limit/);
  expect(() => readCachedBiff(bytes, { ...options, limits: { ...options.limits, sheets: 0 } })).toThrow(/sheets limit/);
  expect(() => readCachedBiff(bytes, { ...options, signal: AbortSignal.abort(new Error("cancelled")) })).toThrow("cancelled");
  expect(() => readCachedBiff(bytes.subarray(0, bytes.length - 1), options)).toThrow();
  expect(() => readCachedBiff(book(formula(0, 0)), options)).toThrow(/STRING/);
});

test("cached BIFF preserves bound-sheet order, shared strings, formats and workbook epoch", () => {
  const bound = (offset: number, name: string) => record(0x85, words(offset, 0),
    Uint8Array.of(0, 0, name.length, 0, ...new TextEncoder().encode(name)));
  const globals = [record(0x809, words(0x600, 5)), record(0x22, words(1)),
    record(0x41e, words(164, 4), Uint8Array.of(0, 121, 121, 121, 121)), record(0xe0, words(0, 164)),
    record(0xfc, words(1, 0, 1, 0, 1), Uint8Array.of(0, 65))];
  const a = book(record(0xfd, words(0, 0, 0, 0, 0)));
  const b = book(record(0x27e, words(0, 0, 0, (125 << 2) | 3, 0)));
  const offset = globals.reduce((sum, bytes) => sum + bytes.length, 0) + bound(0, "B").length + bound(0, "A").length + 4;
  const input = Uint8Array.from([...globals.flatMap(bytes => [...bytes]),
    ...bound(offset + a.length, "B"), ...bound(offset, "A"), ...record(10), ...a, ...b]);
  const decoded = readCachedBiff(input, options);
  expect(decoded).toEqual({ date1904: true, sheets: [
    { name: "B", cells: [{ row: 0, column: 0, type: "n", value: 1.25, format: "yyyy" }] },
    { name: "A", cells: [{ row: 0, column: 0, type: "s", value: "A", format: "yyyy" }] }
  ] });
  expect(readCachedBiff(input, { ...options, namesOnly: true }).sheets).toEqual([
    { name: "B", cells: [] }, { name: "A", cells: [] }
  ]);
});

test("cached BIFF legacy overrides use strict ASCII and UTF-8 without stripping BOM", () => {
  const input = (payload: Uint8Array) => Uint8Array.from([...record(0x809, words(0x500, 0x10)),
    ...record(0x204, words(0, 0, 0, payload.length), payload), ...record(10)]);
  expect(readCachedBiff(input(new TextEncoder().encode("\ufeffcafé")), { ...options, encoding: 65001 }).sheets[0]!.cells[0]!.value).toBe("\ufeffcafé");
  expect(readCachedBiff(input(Uint8Array.of(65)), { ...options, encoding: 20127 }).sheets[0]!.cells[0]!.value).toBe("A");
  expect(() => readCachedBiff(input(Uint8Array.of(128)), { ...options, encoding: 20127 })).toThrow();
  expect(readCachedBiff(input(Uint8Array.of(128)), { ...options, encoding: () => 1252 }).sheets[0]!.cells[0]!.value).toBe("€");
  expect(readCachedBiff(book(record(0x204, words(0, 0, 0, 1), Uint8Array.of(0, 65))), {
    ...options, encoding() { throw new Error("BIFF8 must not resolve a legacy encoding"); }
  }).sheets[0]!.cells[0]!.value).toBe("A");
});

test("cached BIFF4W reads SHEETHDR names and resets per-sheet format tables", () => {
  const sheet = (format: string) => Uint8Array.from([...record(0x409, words(0x400, 0x10)),
    ...record(0x41e, words(0), Uint8Array.of(format.length, ...new TextEncoder().encode(format))),
    ...record(0x443, Uint8Array.of(0, 0)), ...record(0x27e, words(0, 0, 0, 6, 0)), ...record(10)]);
  const a = sheet("yyyy"), b = sheet("0.00");
  const input = Uint8Array.from([...record(0x409, words(0x400, 0x100)),
    ...record(0x85, Uint8Array.of(1, 65)), ...record(0x85, Uint8Array.of(1, 66)),
    ...record(0x8f, words(a.length, 0), Uint8Array.of(1, 65)), ...a,
    ...record(0x8f, words(b.length, 0), Uint8Array.of(1, 66)), ...b, ...record(10)]);
  expect(readCachedBiff(input, options).sheets.map(sheet => [sheet.name, sheet.cells[0]!.format])).toEqual([
    ["A", "yyyy"], ["B", "0.00"]
  ]);
});
