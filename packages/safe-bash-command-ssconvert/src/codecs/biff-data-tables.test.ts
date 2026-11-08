import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createEngine } from "../engine.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";
import { writeBiffDataTable } from "./biff-data-tables.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 10000 } };
type Mode = "row" | "column" | "both";
const record = (id: number, bytes: readonly number[]) => [id & 255, id >> 8, bytes.length & 255, bytes.length >> 8, ...bytes];
const integer = (n: number) => [0x1e, n, 0];
const expression = (mode: Mode) => `=TABLE(${mode === "column" ? "" : "E1"},${mode === "row" ? "" : "F1"})`;

function originalTable(revision: number, mode: Mode): Uint8Array {
  const bytes = record(revision === 2 ? 9 : revision === 3 ? 0x209 : revision === 4 ? 0x409 : 0x809,
    [0, revision >= 7 ? revision === 8 ? 6 : 5 : 0, 16, 0]);
  const reference = (column: number) => [0x24, 0, 0, column, ...(revision === 8 ? [0] : [])];
  const formula = (row: number, column: number, tokens: number[]) => {
    const start = revision === 2 ? 17 : revision <= 4 ? 18 : 22;
    const payload = new Uint8Array(start); payload[0] = row; payload[2] = column;
    if (revision === 2) payload[16] = tokens.length;
    else new DataView(payload.buffer).setUint16(start - 2, tokens.length, true);
    bytes.push(...record(6, [...payload, ...tokens]));
  };
  const number = (row: number, column: number, value: number) => {
    const data = new Uint8Array(revision === 2 ? 15 : 14); data[0] = row; data[2] = column;
    new DataView(data.buffer).setFloat64(revision === 2 ? 7 : 6, value, true);
    bytes.push(...record(revision === 2 ? 3 : 0x203, [...data]));
  };
  number(0, 4, 100); number(0, 5, 200);
  if (mode === "both") formula(0, 0, [...reference(4), ...integer(10), 5, ...reference(5), 3]);
  for (let n = 1; n <= 2; n++) {
    if (mode === "column") formula(0, n, [...reference(5), ...integer(10 * (n + 1)), 3]);
    else number(0, n, n + 1);
    if (mode === "row") formula(n, 0, [...reference(4), ...integer(10), 5, ...integer(n + 3), 3]);
    else number(n, 0, n + 3);
  }
  for (let row = 1; row <= 2; row++) for (let column = 1; column <= 2; column++) {
    formula(row, column, [2, 1, 0, 1, ...(revision === 2 ? [] : [0])]);
    if (row === 1 && column === 1) {
      // Specification 5.24-25: old one-input tables are 12 bytes; all others 16.
      const data = new Uint8Array(revision === 2 && mode !== "both" ? 12 : 16), view = new DataView(data.buffer);
      data.set([1, 0, 2, 0, 1, 2]);
      if (revision === 2) data[7] = Number(mode === "row");
      else view.setUint16(6, mode === "both" ? 12 : mode === "row" ? 4 : 0, true);
      view.setUint16(10, mode === "column" ? 5 : 4, true);
      if (mode === "both") view.setUint16(14, 5, true);
      bytes.push(...record(revision === 2 ? mode === "both" ? 0x37 : 0x36 : 0x236, [...data]));
    }
  }
  bytes.push(...record(10, []));
  return Uint8Array.from(bytes);
}

const results = (book: Workbook) => recalculateWorkbook(book, context, true).sheets[0]!.cells
  .filter(cell => cell.row >= 1 && cell.column >= 1 && cell.column <= 2).map(cell => cell.value);
const expected = [24, 34, 25, 35].map(value => ({ kind: "number", value }));

for (const revision of [2, 3, 4, 7, 8]) for (const mode of ["row", "column", "both"] as const) {
  it(`imports original BIFF${revision} ${mode} data-table records and recalculates substitutions`, async () => {
    const diagnostics: string[] = [];
    const book = await readBiff(originalTable(revision, mode), { ...context, diagnostic: async d => { diagnostics.push(d.code); } });
    expect(book.sheets[0]!.formulaGroups).toMatchObject([{ kind: "array", expression: expression(mode),
      range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 } }]);
    expect(results(book)).toEqual(expected);
    expect(book.sheets[0]!.cells.filter(cell => cell.column >= 4).map(cell => cell.value))
      .toEqual([100, 200].map(value => ({ kind: "number", value })));
    expect(diagnostics).toEqual([]);
    for (const target of [7, 8] as const) {
      const reopened = await readBiff(await createBiffWriter(target)(book, [], context), context);
      expect(results(reopened)).toEqual(expected);
    }
  });
}

it.each([2, 3, 4, 7, 8])("keeps the cached string after BIFF%i DATATABLE and before the next formula", async revision => {
  const records = readBiffRecords(originalTable(revision, "both"), context), bytes: number[] = [];
  for (const r of records) {
    const data = r.data.bytes.slice();
    if (r.opcode === 6 && data[0] === 1 && data[2] === 1) {
      const start = revision === 2 ? 7 : 6; new DataView(data.buffer).setUint16(start + 6, 0xffff, true);
    }
    bytes.push(...record(r.opcode, [...data]));
    if ([0x36, 0x37, 0x236].includes(r.opcode)) bytes.push(...record(revision === 2 ? 7 : 0x207,
      revision === 2 ? [1, 120] : revision === 8 ? [1, 0, 0, 120] : [1, 0, 120]));
  }
  const diagnostics: string[] = [];
  const book = await readBiff(Uint8Array.from(bytes), { ...context, diagnostic: async d => { diagnostics.push(d.code); } });
  expect(book.sheets[0]!.cells.find(c => c.row === 1 && c.column === 1)?.cachedResult).toEqual({ kind: "string", value: "x" });
  expect(results(book)).toEqual(expected); expect(diagnostics).toEqual([]);
});

it.each(["short record", "input column", "first row", "wrong pointer", "trailing pointer"])("rejects a malformed data table: %s", async kind => {
  const records = readBiffRecords(originalTable(8, "both"), context), bytes: number[] = [];
  for (const r of records) {
    let data = r.data.bytes.slice();
    if (r.opcode === 0x236) {
      if (kind === "short record") data = data.subarray(0, 15);
      if (kind === "input column") data[11] = 1;
      if (kind === "first row") data[0] = 0;
    }
    if (r.opcode === 6 && data[0] === 2 && data[2] === 2) {
      if (kind === "wrong pointer") data[23] = 2;
      if (kind === "trailing pointer") { data = Uint8Array.from([...data, 0]); data[20] = 6; }
    }
    bytes.push(...record(r.opcode, [...data]));
  }
  await expect(readBiff(Uint8Array.from(bytes), context)).rejects.toThrow("Invalid Excel BIFF");
});

it.each([2, 7])("retains unrepresented BIFF%i input flags with warnings and cached results", async revision => {
  const records = readBiffRecords(originalTable(revision, revision === 2 ? "row" : "both"), context), bytes: number[] = [];
  for (const r of records) {
    const data = r.data.bytes.slice();
    if (r.opcode === 0x236) data[6] = 28;
    if (r.opcode === 0x36) data[7] = 2;
    bytes.push(...record(r.opcode, [...data]));
  }
  const diagnostics: string[] = [];
  const book = await readBiff(Uint8Array.from(bytes), { ...context, diagnostic: async d => { diagnostics.push(d.code); } });
  expect(book.sheets[0]!.formulaGroups).toBeUndefined();
  expect(diagnostics.length).toBeGreaterThan(0);
  expect(diagnostics.every(code => code === "biff-loss-warning")).toBe(true);
  expect(book.sheets[0]!.unsupportedRecords?.some(r => r.kind === "untranslated-formula")).toBe(true);
  expect(book.sheets[0]!.cells.find(c => c.row === 1 && c.column === 1)?.cachedResult).toEqual({ kind: "number", value: 0 });
});

for (const [mode, deleted] of [["row", 1], ["column", 1], ["both", 1], ["both", 2], ["both", 3]] as const) {
  it(`preserves deleted BIFF8 ${mode} inputs ${deleted} and recalculates reference errors`, async () => {
    const bytes: number[] = [];
    for (const r of readBiffRecords(originalTable(8, mode), context)) {
      const data = r.data.bytes.slice();
      if (r.opcode === 0x236) {
        data[6]! |= deleted << 4;
        if (deleted & 1) data.fill(0xff, 8, 12);
        if (deleted & 2) data.fill(0xff, 12, 16);
      }
      bytes.push(...record(r.opcode, [...data]));
    }
    const diagnostics: string[] = [];
    const book = await readBiff(Uint8Array.from(bytes), { ...context, diagnostic: async d => { diagnostics.push(d.code); } });
    const formula = `=TABLE(${mode === "column" ? "" : deleted & 1 ? "#REF!" : "E1"},${mode === "row" ? "" : deleted & (mode === "both" ? 2 : 1) ? "#REF!" : "F1"})`;
    expect(book.sheets[0]!.formulaGroups?.[0]?.expression).toBe(formula);
    expect(results(book)).toEqual(Array.from({ length: 4 }, () => ({ kind: "error", value: "#REF!" })));
    expect(book.sheets[0]!.cells.filter(c => c.column >= 4).map(c => c.value))
      .toEqual([100, 200].map(value => ({ kind: "number", value })));
    expect(diagnostics).toEqual([]);
    const encoded = await createBiffWriter(8)(book, [], context);
    const table = readBiffRecords(readCfb(encoded, context).get("Workbook")!, context).find(r => r.opcode === 0x236)!;
    expect(table.data.u16(6)).toBe((mode === "both" ? 12 : mode === "row" ? 4 : 0) | deleted << 4);
    if (deleted & 1) expect([...table.data.bytes.subarray(8, 12)]).toEqual([255, 255, 255, 255]);
    if (deleted & 2) expect([...table.data.bytes.subarray(12, 16)]).toEqual([255, 255, 255, 255]);
    const reopened = await readBiff(encoded, context);
    expect(reopened.sheets[0]!.formulaGroups?.[0]?.expression).toBe(formula);
    expect(results(reopened)).toEqual(results(book));
    await expect(createBiffWriter(7)(book, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
    const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits });
    try {
      const owned = await engine.readWorkbook({ kind: "stream", source: [Uint8Array.from(bytes)] }, {}, { signal: context.signal });
      for (const exportType of ["Gnumeric_Excel:xlsx", "Gnumeric_XmlIO:sax:0"]) {
        const chunks: Uint8Array[] = [];
        const output = await engine.writeWorkbook(owned, { kind: "stream", sink: { async write(bytes) { chunks.push(bytes.slice()); } } },
          { exportType }, { signal: context.signal, async diagnostic(d) { diagnostics.push(d.code); } });
        expect(output.exitCode).toBe(0);
        const transported = await engine.readWorkbook({ kind: "stream", source: chunks }, {}, { signal: context.signal });
        expect(results(transported)).toEqual(results(book));
        const returned = await readBiff(await createBiffWriter(8)(transported, [], context), context);
        expect(returned.sheets[0]!.formulaGroups?.[0]?.expression).toBe(formula);
      }
      expect(diagnostics).toEqual([]);
    } finally { await engine.dispose(); }
  });
}

it.each([8, 10, 12, 14])("ignores deleted BIFF8 input with a non-sentinel coordinate at %i", async offset => {
  const bytes: number[] = [];
  for (const r of readBiffRecords(originalTable(8, "both"), context)) {
    const data = r.data.bytes.slice();
    if (r.opcode === 0x236) { data[6]! |= 0x30; data.fill(0xff, 8, 16); data[offset] = 0; }
    bytes.push(...record(r.opcode, [...data]));
  }
  const book = await readBiff(Uint8Array.from(bytes), context);
  expect(book.sheets[0]!.formulaGroups![0]!.expression).toBe("=TABLE(#REF!,#REF!)");
});

it.each(["=TABLE(#REF!,F1)", "=TABLE(E1,#REF!)", "=TABLE((#REF!),F1)"])
  ("evaluates explicit deleted TABLE input without substitutions: %s", async expression => {
    const original = await readBiff(originalTable(8, "both"), context);
    const sheet = original.sheets[0]!;
    const book: Workbook = { ...original, sheets: [{ ...sheet,
      formulaGroups: [{ ...sheet.formulaGroups![0]!, expression }],
      cells: sheet.cells.map(cell => cell.formulaGroup ? { ...cell, formula: expression } : cell) }] };
    expect(results(book)).toEqual(Array.from({ length: 4 }, () => ({ kind: "error", value: "#REF!" })));
  });

it.each(["", "1", "#DIV/0!"])("retains the existing TABLE omission rule for a non-reference input %s", async input => {
  const original = await readBiff(originalTable(8, "column"), context), sheet = original.sheets[0]!;
  const formula = `=TABLE(${input},F1)`;
  const book: Workbook = { ...original, sheets: [{ ...sheet,
    formulaGroups: [{ ...sheet.formulaGroups![0]!, expression: formula }],
    cells: sheet.cells.map(cell => cell.formulaGroup ? { ...cell, formula } : cell) }] };
  expect(results(book)).toEqual(expected);
});

for (const mode of ["row", "column", "both"] as const) {
  it.each([0x40, 0x8000, 0xffc2])(`ignores reserved BIFF8 table flags %i in ${mode} mode`, async flags => {
    const bytes: number[] = [];
    for (const r of readBiffRecords(originalTable(8, mode), context)) {
      const data = r.data.bytes.slice(), view = new DataView(data.buffer);
      if (r.opcode === 0x236) view.setUint16(6, view.getUint16(6, true) | flags, true);
      bytes.push(...record(r.opcode, [...data]));
    }
    const diagnostics: string[] = [];
    const book = await readBiff(Uint8Array.from(bytes), { ...context, diagnostic: async d => { diagnostics.push(d.code); } });
    expect(book.sheets[0]!.formulaGroups?.[0]?.expression).toBe(expression(mode));
    expect(results(book)).toEqual(expected);
    expect(diagnostics).toEqual([]);
  });
}

it.each(["row", "column"] as const)("ignores the unused second input in a BIFF8 %s table", async mode => {
  const bytes: number[] = [];
  for (const r of readBiffRecords(originalTable(8, mode), context)) {
    const data = r.data.bytes.slice();
    if (r.opcode === 0x236) { data[6]! |= 0x20; data.fill(0xff, 12, 16); }
    bytes.push(...record(r.opcode, [...data]));
  }
  const diagnostics: string[] = [];
  const book = await readBiff(Uint8Array.from(bytes), { ...context, diagnostic: async d => { diagnostics.push(d.code); } });
  expect(results(book)).toEqual(expected);
  expect(diagnostics).toEqual([]);
});

it("exports parenthesized and qualified TABLE input coordinates without external lookup", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [] }] };
  const group = { id: "t", kind: "array" as const, range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 },
    expression: "=(TABLE(('[missing.xls]Other'!E1),($F$1)))" };
  expect([...writeBiffDataTable(group, "s", book, context, 16384)!])
    .toEqual([1, 0, 2, 0, 1, 2, 12, 0, 0, 0, 4, 0, 0, 0, 5, 0]);
});

it.each(["=TABLE(E1)", "=TABLE(,)", "=TABLE(E1:F2,)", "=TABLE(1,F1)", "=TABLE(IW1,F1)", "=TABLE(E16385,F1)", "=TABLE(@row:$A$1,F1)", "=TABLE((@column:$A$1),F1)"])
  ("refuses a data table that BIFF7 cannot represent: %s", expression => {
    expect(() => writeBiffDataTable({ id: "t", kind: "array", expression,
      range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 } }, "s",
    { sheets: [{ id: "s", name: "Sheet", cells: [] }] }, context, 16384)).toThrow("Cannot export Excel data table");
  });

for (const revision of [7, 8] as const) for (const mode of ["row", "column", "both"] as const) {
  it(`exports a native BIFF${revision} ${mode} data-table record and tTbl cell tokens`, async () => {
    const book: Workbook = { sheets: [{ id: "s", name: "Sheet", formulaGroups: [{ id: "t", kind: "array",
      expression: expression(mode), range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 } }],
      cells: [1, 2].flatMap(row => [1, 2].map(column => ({ row, column, formulaGroup: "t", formula: expression(mode),
        value: { kind: "number" as const, value: row * 10 + column } }))) }] };
    const bytes = await createBiffWriter(revision)(book, [], context);
    const stream = readCfb(bytes, context).get(revision === 8 ? "Workbook" : "Book")!;
    const records = readBiffRecords(stream, context), tables = records.filter(record => record.opcode === 0x236);
    expect(tables).toHaveLength(1);
    expect([...tables[0]!.data.bytes]).toEqual([1, 0, 2, 0, 1, 2, mode === "both" ? 12 : mode === "row" ? 4 : 0, 0,
      0, 0, mode === "column" ? 5 : 4, 0, 0, 0, mode === "both" ? 5 : 0, 0]);
    expect(records.filter(record => record.opcode === 6).map(record => [...record.data.bytes.subarray(22)]))
      .toEqual(Array.from({ length: 4 }, () => [2, 1, 0, 1, 0]));
    expect(records.some(record => record.opcode === 0x221)).toBe(false);
    const reopened = await readBiff(bytes, context);
    expect(reopened.sheets[0]!.formulaGroups?.[0]?.expression).toBe(expression(mode));
  });
}
