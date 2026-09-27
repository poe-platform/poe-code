import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { snapshotWorkbook, type Workbook } from "../workbook.js";
import { readBiff, createBiffWriter } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";
import { resizeWorkbookReferences } from "../workbook/resize.js";
import { createEngine } from "../engine.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };
const words = (...values: number[]) => values.flatMap(value => [value & 255, value >> 8]);
const record = (id: number, bytes: number[]) => [...words(id, bytes.length), ...bytes];
const payload = words(2, 1, 4, 2, 3, 2, 3, 2, 2, 1, 5, 6, 7, 9);
function source(data = payload, lookup?: number): Uint8Array {
  return Uint8Array.from([
    ...record(0x809, words(0x600, 5)), ...(lookup === undefined ? [] : record(0x160, words(lookup))), ...record(10, []),
    ...record(0x809, words(0x600, 16)), ...record(0x15f, data), ...record(10, [])
  ]);
}
const expected = [
  { axis: "row", labels: { startRow: 1, endRow: 4, startColumn: 2, endColumn: 3 },
    data: { startRow: 1, endRow: 4, startColumn: 4, endColumn: 255 } },
  { axis: "row", labels: { startRow: 2, endRow: 3, startColumn: 2, endColumn: 2 },
    data: { startRow: 2, endRow: 3, startColumn: 3, endColumn: 255 } },
  { axis: "column", labels: { startRow: 5, endRow: 6, startColumn: 7, endColumn: 9 },
    data: { startRow: 7, endRow: 65535, startColumn: 7, endColumn: 9 } }
];

it("imports ordered overlapping label/data pairs with explicit BIFF worksheet limits", async () => {
  const diagnostics: string[] = [];
  const book = await readBiff(source(), { ...context, async diagnostic(d) { diagnostics.push(d.message); } });
  expect(book.sheets[0]!.labelRanges).toEqual(expected);
  expect(diagnostics).toEqual([]);
  expect(book.sheets[0]!.cells).toEqual([]);
  expect(snapshotWorkbook(book, context.limits).sheets[0]!.labelRanges).toEqual(expected);
});

it("writes native LABELRANGES without narrowing multi-column row labels or reordering overlaps", async () => {
  const book = await readBiff(source(), context);
  const messages: string[] = [];
  const bytes = await createBiffWriter(8)(book, [], { ...context, async diagnostic(d) { messages.push(d.message); } });
  const stream = readCfb(bytes, context).get("Workbook")!;
  const ranges = readBiffRecords(stream, context).filter(record => record.opcode === 0x15f);
  expect(ranges.map(record => [...record.data.bytes])).toEqual([payload]);
  expect((await readBiff(bytes, context)).sheets[0]!.labelRanges).toEqual(expected);
  expect(messages).toEqual([]);
});

for (const enabled of [false, true]) it(`preserves the workbook natural-language lookup setting ${enabled}`, async () => {
  const book = await readBiff(source(words(0, 0), Number(enabled)), context);
  expect(book.automaticLabelLookup).toBe(enabled);
  const bytes = await createBiffWriter(8)(book, [], context);
  expect((await readBiff(bytes, context)).automaticLabelLookup).toBe(enabled);
});

it("defaults missing USESELFS to disabled and ignores worksheet-scoped occurrences", async () => {
  const book = await readBiff(source(words(0, 0)), context);
  expect(book.automaticLabelLookup).toBe(false);
  const bytes = Uint8Array.from([...record(0x809, words(0x600, 16)), ...record(0x160, words(1)), ...record(10, [])]);
  expect((await readBiff(bytes, context)).automaticLabelLookup).toBe(false);
});

it("uses left/up data at worksheet edges and keeps full-axis labels in place", async () => {
  const bytes = source(words(2, 1, 2, 254, 255, 3, 4, 0, 255, 1, 65534, 65535, 1, 2));
  expect((await readBiff(bytes, context)).sheets[0]!.labelRanges?.map(pair => pair.data)).toEqual([
    { startRow: 1, endRow: 2, startColumn: 0, endColumn: 253 },
    { startRow: 3, endRow: 4, startColumn: 0, endColumn: 255 },
    { startRow: 0, endRow: 65533, startColumn: 1, endColumn: 2 }
  ]);
});

for (const [name, bytes] of [
  ["missing second count", words(0)], ["truncated range", words(1, 0, 1)],
  ["reversed rows", words(1, 4, 1, 2, 3, 0)], ["reversed columns", words(1, 1, 4, 3, 2, 0)],
  ["invalid column", words(0, 1, 0, 1, 0, 256)], ["trailing bytes", words(0, 0, 1)]
] as const) it(`rejects malformed LABELRANGES: ${name}`, async () => {
  await expect(readBiff(source(bytes), context)).rejects.toMatchObject({ code: "io" });
});

it("validates label metadata in caller-owned snapshots", () => {
  const book = { sheets: [{ id: "S", name: "S", cells: [], labelRanges: [{ ...expected[0], axis: "diagonal" }] }] };
  expect(() => snapshotWorkbook(book as unknown as Workbook, context.limits)).toThrow("Invalid label range axis");
});

it("bounds imported label metadata without materializing label or data cells", async () => {
  await expect(readBiff(source(), { ...context, limits: { ...context.limits, workbookWork: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("refuses data endpoints that native LABELRANGES cannot encode", async () => {
  const book = await readBiff(source(), context);
  const changed: Workbook = { ...book, sheets: [{ ...book.sheets[0]!, labelRanges: [{
    ...book.sheets[0]!.labelRanges![0]!, data: { ...book.sheets[0]!.labelRanges![0]!.data, endColumn: 8 }
  }] }] };
  await expect(createBiffWriter(8)(changed, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});

it("refuses BIFF7 label loss", async () => {
  const book = await readBiff(source(), context);
  await expect(createBiffWriter(7)(book, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});

it("clips label and data rectangles on resize, removing bindings whose data disappears", async () => {
  const book = await readBiff(source(words(2, 1, 2, 1, 1, 3, 4, 127, 127, 0)), context);
  const resized = resizeWorkbookReferences(book, book.sheets[0]!.id, { rows: 128, columns: 128 }, context);
  expect(resized.sheets[0]!.labelRanges).toEqual([{ axis: "row",
    labels: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 1 },
    data: { startRow: 1, endRow: 2, startColumn: 2, endColumn: 127 }
  }]);
  expect(book.sheets[0]!.labelRanges).toHaveLength(2);
});

it("round-trips ranges spanning native continuation records with no data-cell allocation", async () => {
  const ranges = Array.from({ length: 1100 }, (_, i) => words(i, i, 0, 0)).flat();
  const first = [...words(1100), ...ranges, ...words(0)];
  const bytes = Uint8Array.from([...record(0x809, words(0x600, 16)), ...record(0x15f, first.slice(0, 8224)),
    ...record(0x3c, first.slice(8224)), ...record(10, [])]);
  const book = await readBiff(bytes, context);
  expect(book.sheets[0]!.labelRanges).toHaveLength(1100);
  const written = await createBiffWriter(8)(book, [], context);
  expect((await readBiff(written, context)).sheets[0]!.labelRanges).toEqual(book.sheets[0]!.labelRanges);
  expect(book.sheets[0]!.cells).toEqual([]);
});

it("warns through the public engine when another exporter omits label semantics", async () => {
  const engine = createEngine({ codecs: [], limits: context.limits, environment: context.environment });
  const diagnostics: string[] = [];
  try {
    const book = await engine.readWorkbook({ kind: "stream", source: [source()] }, {}, context);
    const result = await engine.writeWorkbook(book, { kind: "stream", sink: { async write() {} } },
      { exportType: "Gnumeric_Excel:xlsx" }, { ...context, async diagnostic(d) { diagnostics.push(d.code); } });
    expect(result.exitCode).toBe(0);
    expect(diagnostics).toContain("label-range-loss-warning");
  } finally { await engine.dispose(); }
});
