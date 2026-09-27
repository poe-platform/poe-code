import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { translateBiffFormula } from "./biff-formulas.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 10000 } };
const integer = (value: number) => [0x1e, value & 255, value >> 8];
const formulaContext = (revision: number) => ({ revision, codepage: 1252, row: 0, column: 0,
  names: [], externalSheets: [], limit: 1000 });

// Excel File Format 1.42 section 3.11 and LibreOffice xlformula.cxx:
// these functions gained optional arguments after their original fixed tokens.
const cases = [
  { id: 14, name: "FIXED", first: 2, last: 3, count: 2 },
  { id: 70, name: "WEEKDAY", first: 2, last: 4, count: 1 },
  { id: 101, name: "HLOOKUP", first: 2, last: 4, count: 3 },
  { id: 102, name: "VLOOKUP", first: 2, last: 4, count: 3 },
  { id: 197, name: "TRUNC", first: 2, last: 2, count: 1 },
  { id: 220, name: "DAYS360", first: 3, last: 4, count: 2 }
];

for (const item of cases) {
  for (let revision = item.first; revision <= item.last; revision++) {
    for (const token of [0x21, 0x41, 0x61]) {
      it(`imports BIFF${revision} ${item.name} fixed token ${token} without consuming adjacent operands`, () => {
        const args = Array.from({ length: item.count }, (_, i) => i + 1);
        const bytes = [...integer(42), ...args.flatMap(integer), token, item.id,
          ...(revision >= 4 ? [0] : []), 3];
        expect(translateBiffFormula(Uint8Array.from(bytes), formulaContext(revision)))
          .toBe(`=42+${item.name}(${args.join(",")})`);
      });
    }
    it(`rejects missing BIFF${revision} ${item.name} fixed operands`, () => {
      const bytes = [...Array.from({ length: item.count - 1 }, () => integer(1)).flat(),
        0x21, item.id, ...(revision >= 4 ? [0] : [])];
      expect(() => translateBiffFormula(Uint8Array.from(bytes), formulaContext(revision)))
        .toThrow("invalid function argument count");
    });
  }
  for (const revision of [item.last + 1, 7, 8]) {
    it(`keeps BIFF${revision} ${item.name} explicit variable argument counts`, () => {
      const args = Array.from({ length: item.count + 1 }, (_, i) => i + 1);
      expect(translateBiffFormula(Uint8Array.from([...args.flatMap(integer), 0x22, args.length,
        item.id, ...(revision >= 4 ? [0] : [])]), formulaContext(revision)))
        .toBe(`=${item.name}(${args.join(",")})`);
      expect(() => translateBiffFormula(Uint8Array.from([...args.slice(0, item.count).flatMap(integer),
        0x21, item.id, ...(revision >= 4 ? [0] : [])]), formulaContext(revision)))
        .toThrow(`Unsupported ssconvert feature: BIFF function ${item.id}`);
    });
  }
}

it.each([2, 3, 4, 7, 8])("does not infer a fixed argument count for BIFF%i SUM", revision => {
  expect(() => translateBiffFormula(Uint8Array.from([...integer(1), 0x21, 4,
    ...(revision >= 4 ? [0] : [])]), formulaContext(revision))).toThrow("Unsupported ssconvert feature: BIFF function 4");
});

const record = (id: number, bytes: readonly number[]) => [id & 255, id >> 8, bytes.length & 255, bytes.length >> 8, ...bytes];

it.each([2, 3, 4])("recalculates original BIFF%i fixed functions through BIFF7/8 export", async revision => {
  const formulas = [
    { id: 70, args: [61], value: 5 }, // 1900-03-01, Thursday (Sunday = 1).
    ...(revision === 2 ? [{ id: 197, args: [42], value: 42 }] : []),
    ...(revision <= 3 ? [{ id: 14, args: [1234, 2], value: "1,234.00" }] : []),
    ...(revision >= 3 ? [{ id: 220, args: [61, 92], value: 30 }] : [])
  ].map(formula => ({ value: formula.value,
    tokens: [...formula.args.flatMap(integer), 0x21, formula.id, ...(revision >= 4 ? [0] : [])] }));
  // B1:C2 contains [1,2;10,20]; both three-argument lookups find 20.
  for (const [id, lookup] of [[101, 2], [102, 10]] as const) formulas.push({ value: 20,
    tokens: [...integer(lookup), 0x25, 0, 0, 1, 0, 1, 2, ...integer(2), 0x21, id, ...(revision >= 4 ? [0] : [])] });
  const bytes = record(revision === 2 ? 9 : revision === 3 ? 0x209 : 0x409, [0, 0, 16, 0]);
  for (const [row, formula] of formulas.entries()) {
    const tokens = formula.tokens;
    const header = new Uint8Array(revision === 2 ? 17 : 18); header[0] = row;
    if (revision === 2) header[16] = tokens.length;
    else new DataView(header.buffer).setUint16(16, tokens.length, true);
    bytes.push(...record(6, [...header, ...tokens]));
  }
  for (const [row, column, value] of [[0, 1, 1], [0, 2, 2], [1, 1, 10], [1, 2, 20]] as const) {
    const payload = new Uint8Array(revision === 2 ? 15 : 14), view = new DataView(payload.buffer);
    view.setUint16(0, row, true); view.setUint16(2, column, true);
    view.setFloat64(revision === 2 ? 7 : 6, value, true);
    bytes.push(...record(revision === 2 ? 3 : 0x203, [...payload]));
  }
  bytes.push(...record(10, []));
  const imported = await readBiff(Uint8Array.from(bytes), context);
  for (const book of [imported,
    await readBiff(await createBiffWriter(7)(imported, [], context), context),
    await readBiff(await createBiffWriter(8)(imported, [], context), context)]) {
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.filter(cell => cell.column === 0).map(cell => cell.value))
      .toEqual(formulas.map(({ value }) => ({ kind: typeof value === "number" ? "number" : "string", value })));
  }
});
