import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { Binary } from "./biff-binary.js";
import { biffArrayReader } from "./biff-arrays.js";
import { parseExpression } from "../formulas/parser.js";
import { renameWorkbookSheet, rewriteWorkbook } from "../formulas/workbook.js";
import { serializeExpression } from "../formulas/serialization.js";
import { setCellText } from "../workbook/updates/index.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";
import { readXlsx, createXlsxWriter } from "./xlsx.js";
import { snapshotWorkbook } from "../workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };

for (const revision of [7, 8] as const) for (const text of ["001", "TRUE", "#REF!"]) {
  it(`preserves stored BIFF${revision} array string ${text} through recalculation and reexport`, async () => {
    const record = (id: number, bytes: readonly number[]) => [id & 255, id >> 8, bytes.length & 255, bytes.length >> 8, ...bytes];
    // TYPE(INDEX(ptgArray,1,1)), with an independently encoded string sidecar.
    const tokens = [0x40, 0, 0, 0, 0, 0, 0, 0, 0x1e, 1, 0, 0x1e, 1, 0, 0x22, 3, 29, 0, 0x21, 86, 0];
    const header = new Uint8Array(22); new DataView(header.buffer).setFloat64(6, 999, true); header[20] = tokens.length;
    const dimensions = revision === 8 ? [0, 0, 0] : [1, 1, 0];
    const string = revision === 8 ? [text.length, 0, 0, ...new TextEncoder().encode(text)] : [text.length, ...new TextEncoder().encode(text)];
    const bytes = new Uint8Array([...record(0x809, [0, revision === 8 ? 6 : 5, 16, 0]),
      ...record(6, [...header, ...tokens, ...dimensions, 2, ...string]), ...record(10, [])]);
    const imported = await readBiff(bytes, context);
    expect(recalculateWorkbook(imported, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 2 });
    const reopened = await readBiff(await createBiffWriter(revision)(imported, [], context), context);
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 2 });
  });
}

it.each([7, 8] as const)("retains BIFF%i typed named and grouped arrays through sheet edits", async revision => {
  const book: Workbook = { names: [{ name: "Strings", expression: '={"001"}', arrayStringLiterals: true }],
    sheets: [{ id: "s", name: "Sheet", formulaGroups: [
      { id: "a", kind: "array", expression: '={"TRUE";"#REF!"}', arrayStringLiterals: true,
        range: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 } },
      { id: "b", kind: "shared", expression: '=TYPE(INDEX({"001"},1,1))', arrayStringLiterals: true,
        range: { startRow: 3, endRow: 4, startColumn: 0, endColumn: 0 } }
    ], cells: [
      { row: 0, column: 0, formula: "=TYPE(INDEX(Strings,1,1))", value: { kind: "number", value: 999 } },
      ...[1, 2, 3, 4].map(row => ({ row, column: 0, formula: row < 3 ? '={"TRUE";"#REF!"}' : '=TYPE(INDEX({"001"},1,1))',
        arrayStringLiterals: true, formulaGroup: row < 3 ? "a" : "b", value: { kind: "number" as const, value: 999 } }))
    ] }] };
  const expected = [{ kind: "number", value: 2 }, { kind: "string", value: "TRUE" }, { kind: "string", value: "#REF!" },
    { kind: "number", value: 2 }, { kind: "number", value: 2 }];
  const values = (value: Workbook) => recalculateWorkbook(value, context, true).sheets[0]!.cells.map(cell => cell.value);
  expect(values(book)).toEqual(expected);
  expect(values(rewriteWorkbook(book, context, document => serializeExpression(document, document.grammar, false)))).toEqual(expected);
  const imported = await readBiff(await createBiffWriter(revision)(book, [], context), context);
  expect(values(imported)).toEqual(expected);
  expect(values(renameWorkbookSheet(imported, imported.sheets[0]!.id, "Renamed", context))).toEqual(expected);
});

it("uses text-entry coercion when replacing an imported typed formula", () => {
  const formula = '=TYPE(INDEX({"001"},1,1))';
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, arrayStringLiterals: true, value: { kind: "number", value: 999 } }
  ] }] };
  const updated = setCellText(book, { sheet: "s", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }, formula, context);
  expect(updated.sheets[0]!.cells[0]!.arrayStringLiterals).toBeUndefined();
  expect(recalculateWorkbook(updated, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 1 });
});

for (const [format, write, read] of [["Gnumeric XML", writeGnumeric, readGnumeric],
  ["XLSX", createXlsxWriter("2008"), readXlsx]] as const) {
  it(`preserves typed array cells, names and groups through ${format}`, async () => {
    const book: Workbook = { names: [{ name: "Strings", expression: '={"001"}', arrayStringLiterals: true }],
      sheets: [{ id: "s", name: "Sheet", formulaGroups: [{ id: "a", kind: "array", expression: '={"TRUE";"#REF!"}',
        arrayStringLiterals: true, range: { startRow: 2, endRow: 3, startColumn: 0, endColumn: 0 } }], cells: [
        { row: 0, column: 0, formula: '=TYPE(INDEX({"001"},1,1))', arrayStringLiterals: true, value: { kind: "number", value: 999 } },
        { row: 1, column: 0, formula: '=TYPE(INDEX(Strings,1,1))', value: { kind: "number", value: 999 } },
        ...[2, 3].map(row => ({ row, column: 0, formula: '={"TRUE";"#REF!"}', arrayStringLiterals: true,
          formulaGroup: "a", value: { kind: "number" as const, value: 999 } }))
      ] }] };
    const reopened = await read(await write(book, [], context), context);
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([
      { kind: "number", value: 2 }, { kind: "number", value: 2 }, { kind: "string", value: "TRUE" }, { kind: "string", value: "#REF!" }
    ]);
  });
}

it("admits only explicit typed-array metadata and validates its stored type", async () => {
  const cell = { row: 0, column: 0, formula: '=TYPE(INDEX({"001"},1,1))', arrayStringLiterals: true,
    value: { kind: "number" as const, value: 999 } };
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [cell] }] };
  const xml = new TextDecoder().decode(await writeGnumeric(book, [], context));
  expect(xml).toContain('ssc:array-string-literals="1"');
  await expect(readGnumeric(new TextEncoder().encode(xml.replace('ssc:array-string-literals="1"', 'ssc:array-string-literals="yes"')), context))
    .rejects.toThrow("Invalid ssconvert formula array string semantics");
  for (const source of [xml.replace('ssc:array-string-literals="1"', 'ssc:array-string-literals="0"'),
    xml.replace("urn:poe-code:ssconvert:formulas:1", "urn:foreign:formulas")]) {
    const reopened = await readGnumeric(new TextEncoder().encode(source), context);
    expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 1 });
  }
  expect(() => snapshotWorkbook({ sheets: [{ ...book.sheets[0]!, cells: [{ ...cell, arrayStringLiterals: "yes" }] }] } as unknown as Workbook, context.limits))
    .toThrow("Invalid formula array string semantics");
});

it("reads continued array strings through the complete BIFF record importer", async () => {
  const record = (id: number, bytes: readonly number[]) => [id & 255, id >> 8, bytes.length & 255, bytes.length >> 8, ...bytes];
  const header = new Uint8Array(22); new DataView(header.buffer).setFloat64(6, 999, true); header[20] = 8;
  const bytes = new Uint8Array([...record(0x809, [0, 6, 16, 0]),
    ...record(6, [...header, 0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 65]),
    ...record(0x3c, [1, 233, 0]), ...record(10, [])]);
  const book = await readBiff(bytes, context);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "Aé" });
});

it("preserves typed array sidecars attached to original shared-formula records", async () => {
  const record = (id: number, bytes: readonly number[]) => [id & 255, id >> 8, bytes.length & 255, bytes.length >> 8, ...bytes];
  const cell = (row: number) => {
    const header = new Uint8Array(22); header[0] = row; header[20] = 5;
    return record(6, [...header, 1, 0, 0, 0, 0]);
  };
  const group = new Uint8Array(10); group[2] = 1; group[8] = 8;
  const bytes = new Uint8Array([...record(0x809, [0, 6, 16, 0]), ...cell(0),
    ...record(0x4bc, [...group, 0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 48, 48, 49]),
    ...cell(1), ...record(10, [])]);
  const book = await readBiff(bytes, context);
  expect(book.sheets[0]!.formulaGroups).toMatchObject([{ kind: "shared", arrayStringLiterals: true }]);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value))
    .toEqual([{ kind: "string", value: "001" }, { kind: "string", value: "001" }]);
});

for (const shared of [false, true]) for (const budget of ["text", "work"])
it(`bounds cumulative ${budget} while expanding ${shared ? "shared" : "individual"} BIFF arrays`, async () => {
  const record = (id: number, bytes: readonly number[]) => [id & 255, id >> 8, bytes.length & 255, bytes.length >> 8, ...bytes];
  const array = [0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 240, 63];
  const cells = Array.from({ length: 12 }, (_, row) => {
    const header = new Uint8Array(22); header[0] = row; header[20] = shared ? 5 : 8;
    return record(6, [...header, ...(shared ? [1, 0, 0, 0, 0] : array)]);
  });
  const group = new Uint8Array(10); group[2] = 11; group[8] = 8;
  const bytes = new Uint8Array([...record(0x809, [0, 6, 16, 0]), ...cells[0]!,
    ...(shared ? record(0x4bc, [...group, ...array]) : []), ...cells.slice(1).flat(), ...record(10, [])]);
  const read = (limit: number) => readBiff(bytes, { ...context, limits: { ...context.limits,
    ...(budget === "text" ? { workbookTextBytes: limit } : { workbookWork: limit }) } });
  expect((await read(1000)).sheets[0]!.cells.map(cell => cell.formula)).toEqual(Array<string>(12).fill("={1}"));
  await expect(read(budget === "text" ? 80 : 30)).rejects.toThrow(`${budget} limit`);
});

for (const revision of [7, 8] as const) for (const [formula, expected] of [
  ["=SUM({1,2;3,4})", 10], ["=SUM({1,2})+SUM({3,4})", 10],
  ['=INDEX({"café","a\\"b"},1,2)', 'a"b'], ["=INDEX({TRUE,FALSE},1,1)", true],
  ["=INDEX({#REF!,#N/A},1,2)", "#N/A"], ["=COUNTBLANK({,1})", 1],
  ["=COUNTBLANK({,;1,})", 3], ["=COUNTBLANK({})", 1]
] as const) it(`reads BIFF${revision} literal array ${formula}`, async () => {
  const warnings: string[] = [];
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, value: { kind: "number", value: 999 } }
  ] }] };
  const reopened = await readBiff(await createBiffWriter(revision)(book, [], context), { ...context,
    async diagnostic(d) { warnings.push(d.message); } });
  expect(reopened.sheets[0]!.cells[0]!.formula).toBeDefined();
  expect(warnings).toEqual([]);
  const value = recalculateWorkbook(reopened, context, true).sheets[0]!.cells[0]!.value;
  expect("value" in value ? value.value : undefined).toBe(expected);
});

it("reads array strings across CONTINUE width changes", () => {
  const read = biffArrayReader([
    new Binary(Uint8Array.from([0, 0, 0, 2, 2, 0, 0, 65])),
    new Binary(Uint8Array.from([1, 233, 0]))
  ], 8, 1252, context);
  expect(read()).toBe('{"Aé"}');
});

it.each([
  { bytes: [0, 0] }, { bytes: [0, 0, 0] }, { bytes: [0, 0, 0, 1, ...Array<number>(7).fill(0)] },
  { bytes: [0, 0, 0, 8, ...Array<number>(8).fill(0)] }, { bytes: [0, 0, 0, 2, 1, 0, 1, 65] },
  { bytes: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 240, 127] }
])("refuses malformed or nonfinite array payload $bytes", ({ bytes }) => {
  const read = biffArrayReader([new Binary(Uint8Array.from(bytes))], 8, 1252, context);
  expect(read).toThrow("Invalid Excel BIFF");
});

it("bounds array dimensions before allocating entries and charges text across arrays", () => {
  const huge = biffArrayReader([new Binary(Uint8Array.from([255, 255, 255]))], 8, 1252, {
    ...context, limits: { ...context.limits, workbookWork: 100 }
  });
  expect(huge).toThrow("array work limit");
  const empty = [0, 0, 0, 0, ...Array<number>(8).fill(0)];
  const read = biffArrayReader([new Binary(Uint8Array.from([...empty, ...empty]))], 8, 1252, {
    ...context, limits: { ...context.limits, workbookTextBytes: 3 }
  });
  expect(read()).toBe("{}"); expect(read).toThrow("array text limit");
});

it("preserves cancellation and bounds blank array syntax without accepting ragged rows", () => {
  const controller = new AbortController(), reason = new Error("array cancelled"); controller.abort(reason);
  const read = biffArrayReader([], 8, 1252, { ...context, signal: controller.signal });
  expect(read).toThrow(reason);
  const position = { sheet: "s", row: 0, column: 0 };
  expect(parseExpression("={,1;2}", { position }).ok).toBe(false);
  expect(() => parseExpression("={,}", { position, maximumNodes: 2 })).toThrow("formula node limit");
  expect(parseExpression("={,}", { position, maximumNodes: 3 }).ok).toBe(true);
});

it.each([7, 8] as const)("retains arrays in BIFF%i names and array groups", async revision => {
  const book: Workbook = { names: [{ name: "Values", expression: "={2,3}" }],
    sheets: [{ id: "s", name: "Sheet", formulaGroups: [{ id: "g", kind: "array", expression: "={11;13}",
      range: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 } }], cells: [
      { row: 0, column: 0, formula: "=SUM(Values)", value: { kind: "number", value: 999 } },
      ...[1, 2].map(row => ({ row, column: 0, formula: "={11;13}", formulaGroup: "g", value: { kind: "number" as const, value: 999 } }))
    ] }] };
  const reopened = await readBiff(await createBiffWriter(revision)(book, [], context), context);
  expect(reopened.names?.find(name => name.name === "Values")?.expression).toBe("={2,3}");
  expect(reopened.sheets[0]!.formulaGroups?.[0]?.expression).toBe("={11;13}");
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.map(cell => cell.value))
    .toEqual([5, 11, 13].map(value => ({ kind: "number", value })));
});
