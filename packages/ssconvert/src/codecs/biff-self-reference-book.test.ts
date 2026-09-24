import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { biffString } from "./biff-write.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const word = (value: number) => [value & 255, value >>> 8 & 255];
const record = (id: number, data: readonly number[] = []) => [...word(id), ...word(data.length), ...data];

function fixture(marker: readonly number[], raw = 0x3a, first = 1, last = first) {
  const name = record(0x18, [0, 0, 0, 4, 3, 0, 0, 0, 2, 0, 0, 0, 0, 0,
    0, 82, 97, 116, 101, 0x1e, 23, 0]);
  const kind = raw & 0x1f;
  const tokens = [raw, 0, 0, ...(kind === 0x19 ? [1, 0, 0, 0] :
    kind === 0x1b ? [0, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0]), 0x1e, 1, 0, 3];
  const formula = new Uint8Array(22 + tokens.length), view = new DataView(formula.buffer);
  view.setUint16(0, 2, true); view.setFloat64(6, 999, true);
  view.setUint16(20, tokens.length, true); formula.set(tokens, 22);
  const number = new Uint8Array(14); new DataView(number.buffer).setFloat64(6, 41, true);
  return Uint8Array.from([...record(0x809, [0, 6, 5, 0]), ...name,
    ...record(0x1ae, [2, 0, ...marker, ...biffString("Worksheet", 8, context), ...biffString("Worksheet2", 8, context)]),
    ...record(0x17, [1, 0, 0, 0, ...word(first), ...word(last)]), ...record(10),
    ...record(0x809, [0, 6, 16, 0]), ...record(6, [...formula]), ...record(10),
    ...record(0x809, [0, 6, 16, 0]), ...record(0x203, [...number]), ...record(10)]);
}

for (const wide of [false, true]) for (const raw of [0x39, 0x59, 0x79, 0x3a, 0x5a, 0x7a, 0x3b, 0x5b, 0x7b]) {
  it(`binds a NUL self-book with wide=${wide} and token=${raw}`, async () => {
    const warnings: string[] = []; let calls = 0;
    const configured: CapabilityContext = { ...context,
      externalReferences: { resolve() { calls++; throw new Error("unexpected external authority"); } },
      async diagnostic(d) { warnings.push(d.message); } };
    const selected = fixture([1, 0, Number(wide), 0, ...(wide ? [0] : [])], raw);
    const before = selected.slice(), book = await readBiff(selected, configured);
    const name = (raw & 0x1f) === 0x19, area = (raw & 0x1f) === 0x1b;
    expect(book.sheets[0]!.cells[0]!.formula).toBe(`='Worksheet2'!${name ? "Rate" : area ? "$A$1:$A$1" : "$A$1"}+1`);
    expect(recalculateWorkbook(book, configured, true).sheets[0]!.cells[0]!.value)
      .toEqual({ kind: "number", value: name ? 24 : 42 });
    expect(calls).toBe(0); expect(warnings).toEqual([]); expect(selected).toEqual(before);
    const reopened = await readBiff(await createBiffWriter(8)(book, [], context), context);
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value)
      .toEqual({ kind: "number", value: name ? 24 : 42 });
    expect(book.unsupportedRecords?.some(record => record.kind === "SUPBOOK")).toBe(true);
  });
}

it.each([" ", "x", "\0suffix"])("does not treat external marker %j as the current workbook", async marker => {
  const book = await readBiff(fixture([...biffString(marker, 8, context)]), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=#REF!+1");
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value)
    .toEqual({ kind: "error", value: "#REF!" });
});

it.each([[0xffff, 1], [1, 0xffff]])("retains deleted self-book endpoints %i:%i", async (first, last) => {
  const book = await readBiff(fixture([1, 0, 0, 0], 0x3a, first, last), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe("=#REF!+1");
});

it.each([0x39, 0x3a, 0x3b])("keeps invalid self-book sheet indexes unbound for token %i", async raw => {
  const warnings: string[] = [];
  const book = await readBiff(fixture([1, 0, 0, 0], raw, 2), { ...context,
    async diagnostic(d) { warnings.push(d.message); } });
  expect(book.sheets[0]!.cells[0]!.formula).toBeUndefined();
  expect(warnings).toContain("Unsupported ssconvert feature: external BIFF workbook reference");
});

it.each([[1, 0], [1, 0, 1, 0], [1, 0, 2, 0]].map(marker => ({ marker })))("refuses malformed self-book string framing $marker", async ({ marker }) => {
  const bytes = Uint8Array.from([...record(0x809, [0, 6, 5, 0]), ...record(0x1ae, [0, 0, ...marker]), ...record(10)]);
  await expect(readBiff(bytes, context)).rejects.toThrow("Invalid Excel BIFF");
});
