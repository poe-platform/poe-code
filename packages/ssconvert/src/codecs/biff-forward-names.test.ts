import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 2000000, outputBytes: 2000000, cells: 5000, sheets: 8, operations: 100000 } };

for (const padding of [0, 256]) it.each([7, 8, "dsf"] as const)(
  `declares BIFF %s name dependencies before use with ${padding} intervening names`, async profile => {
    const book: Workbook = { names: [
      { name: "Outer", sheet: "data", expression: "Middle+1" },
      { name: "GlobalOuter", expression: "GlobalLeaf+2" },
      { name: "Qualified", sheet: "data", expression: "Here!Leaf+3" },
      { name: "Macro", expression: "IFERROR(1/0,23)" },
      { name: "Addin", expression: "ACOT(1)" },
      ...Array.from({ length: padding }, (_, index) => ({ name: `Padding_${index}`, expression: String(index) })),
      { name: "Middle", sheet: "data", expression: "Leaf+4" },
      { name: "Leaf", sheet: "data", expression: "7" },
      { name: "GlobalLeaf", expression: "11" },
      { name: "Leaf", sheet: "here", expression: "17" }
    ], sheets: [{ id: "here", name: "Here", cells:
      ["=Data!Outer", "=GlobalOuter", "=Data!Qualified", "=Macro", "=Addin"].map((formula, row) =>
        ({ row, column: 0, formula, value: { kind: "number", value: 999 } }))
    }, { id: "data", name: "Data", cells: [] }] };
    const before = structuredClone(book);
    const bytes = await createBiffWriter(profile)(book, [], context);
    for (const [stream, input] of readCfb(bytes, context)) {
      const records = readBiffRecords(input, context), revision = records[0]!.data.u16(0) === 0x600 ? 8 : 7;
      const names = records.filter(record => record.opcode === 0x18).map(record => {
        const data = record.data, wide = revision === 8 && Boolean(data.u8(14) & 1);
        const length = data.u8(3), start = 14 + Number(revision === 8) + length * (wide ? 2 : 1);
        return { text: Buffer.from(data.slice(14 + Number(revision === 8), length * (wide ? 2 : 1))).toString(wide ? "utf16le" : "latin1"),
          scope: data.u16(revision === 8 ? 8 : 6), tokens: data.slice(start, data.u16(4)) };
      });
      expect(names).toHaveLength(padding + 10);
      for (const [name, target, scope] of [
        ["Outer", "Middle", 2], ["Middle", "Leaf", 2], ["Qualified", "Leaf", 1],
        ["GlobalOuter", "GlobalLeaf", 0], ["Macro", "_xlfn.IFERROR", 0]
      ] as const) {
        const caller = names.findIndex(entry => entry.text === name);
        const dependency = names.findIndex(entry => entry.text === target && entry.scope === scope);
        expect(dependency, `${stream}: ${name} needs ${target}`).toBeGreaterThanOrEqual(0);
        expect(dependency, `${stream}: ${name} must follow ${target}`).toBeLessThan(caller);
        const tokens = names[caller]!.tokens;
        const offset = tokens[0] === 0x59 ? revision === 8 ? 3 : 11 : 1;
        expect(new DataView(tokens.buffer, tokens.byteOffset).getUint16(offset, true)).toBe(dependency + 1);
      }
      const calculated = recalculateWorkbook(await readBiff(input, context), context, true);
      expect(calculated.sheets[0]!.cells.map(cell => cell.value)).toEqual(
        [12, 13, 20, 23, Math.PI / 4].map(value => ({ kind: "number", value })));
    }
    expect(book).toEqual(before);
  }
);

it.each([7, 8, "dsf"] as const)("relocates BIFF %s names shared by array and ordinary cell formulas", async profile => {
  const expression = "=Outer+NamedMacro+ROW(A1:A2)";
  const book: Workbook = { names: [
    { name: "Outer", expression: "Leaf" },
    { name: "NamedMacro", expression: "IFERROR(1/0,3)" },
    { name: "Leaf", expression: "7" }
  ], sheets: [{ id: "here", name: "Here", formulaGroups: [{ id: "array", kind: "array",
    range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }, expression }], cells: [
    { row: 0, column: 0, formula: expression, formulaGroup: "array", value: { kind: "number", value: 999 } },
    { row: 1, column: 0, formula: expression, formulaGroup: "array", value: { kind: "number", value: 999 } },
    { row: 2, column: 0, formula: "=NamedMacro", value: { kind: "number", value: 999 } }
  ] }] };
  const before = structuredClone(book);
  for (const [stream, input] of readCfb(await createBiffWriter(profile)(book, [], context), context)) {
    const reopened = await readBiff(input, context);
    expect(reopened.names?.map(name => name.name), stream).toEqual(["Leaf", "Outer", "_xlfn.IFERROR", "NamedMacro"]);
    expect(reopened.sheets[0]!.formulaGroups).toMatchObject([{ kind: "array", expression }]);
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(
      [11, 12, 3].map(value => ({ kind: "number", value })));
  }
  expect(book).toEqual(before);
});
