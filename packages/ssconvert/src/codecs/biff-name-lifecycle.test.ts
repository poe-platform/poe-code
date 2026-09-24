import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, NamedExpression, Workbook } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readBiffRecords, readCfb } from "./biff-binary.js";
import { writeCfb } from "./biff-write-binary.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 8, operations: 100000 } };

async function lifecycleInput(profile: 7 | 8 | "dsf") {
  const names: NamedExpression[] = [], mutations = new Map<string, string>(), forwards = new Map<string, string>();
  const cases: { id: string; formula: string; expected: CellValue }[] = [];
  const num = (value: number): CellValue => ({ kind: "number", value });
  const missing: CellValue = { kind: "error", value: "#REF!" };
  const addCase = (id: string, name: string, local: boolean, expected: CellValue) => {
    cases.push({ id, formula: "=" + (local ? "Data!" : "") + name, expected });
  };
  for (const local of [false, true]) for (const placeholder of [false, true]) {
    const prefix = (local ? "L" : "G") + (placeholder ? "P" : "C"), scope = local ? { sheet: "data" } : {};
    names.push({ name: prefix + "First", expression: placeholder ? "#NAME?" : "11", ...scope },
      { name: prefix + "Watch", expression: prefix + "First", ...scope },
      { name: prefix + "Later", expression: "17", ...scope },
      { name: prefix + "Trail", expression: prefix + "Later", ...scope });
    mutations.set(prefix + "Later", prefix + "First");
    forwards.set(prefix + "Watch", prefix + "Later");
    for (const [suffix, expected] of [["First", num(placeholder ? 17 : 11)], ["Later", placeholder ? num(17) : missing],
      ["Watch", missing], ["Trail", placeholder ? num(17) : missing]] as const)
      addCase(prefix + suffix, prefix + suffix, local, expected);
  }
  for (const local of [false, true]) {
    const prefix = local ? "LR" : "GR", scope = local ? { sheet: "data" } : {};
    names.push({ name: prefix + "First", expression: "#NAME?", ...scope },
      { name: prefix + "Watch", expression: prefix + "First", ...scope },
      { name: prefix + "Later", expression: "#NAME?", ...scope },
      { name: prefix + "Final", expression: "23", ...scope },
      { name: prefix + "Trail", expression: prefix + "Later", ...scope });
    mutations.set(prefix + "Later", prefix + "First"); mutations.set(prefix + "Final", prefix + "First");
    for (const suffix of ["First", "Later", "Final", "Watch", "Trail"]) addCase(prefix + suffix, prefix + suffix, local, num(23));
  }
  for (const local of [false, true]) for (const [first, later, label] of [
    ["Sheet_Title", "Other_Title", "Title"], ["Print_Area", "Other_Area", "Area"]
  ] as const) {
    const scope = local ? { sheet: "data" } : {}, prefix = (local ? "L" : "G") + label;
    names.push({ name: first, expression: "11", ...scope }, { name: prefix + "Watch", expression: first, ...scope },
      { name: later, expression: "17", ...scope }, { name: prefix + "Trail", expression: later, ...scope });
    mutations.set(later, first);
    for (const [name, expected] of [[first, num(local ? 17 : 11)], [later, local ? num(17) : missing],
      [prefix + "Watch", num(local ? 17 : 11)], [prefix + "Trail", local ? num(17) : missing]] as const)
      addCase(prefix + name, name, local, expected);
  }
  cases.push({ id: "default-title", formula: '=INDIRECT("Blank!Sheet_Title")', expected: missing },
    { id: "default-print-area", formula: '=INDIRECT("Blank!Print_Area")', expected: missing });
  const book: Workbook = { names, sheets: [{ id: "here", name: "Here", cells: cases.map((entry, row) =>
    ({ row, column: 0, formula: entry.formula, value: num(999) })) },
  { id: "data", name: "Data", cells: [] }, { id: "blank", name: "Blank", cells: [] }] };
  const streams = new Map(readCfb(await createBiffWriter(profile)(book, [], context), context));
  for (const [streamName, original] of streams) {
    const stream = new Uint8Array(original), revision = streamName === "Book" ? 7 : 8;
    const declarations = readBiffRecords(stream, context).filter(record => record.opcode === 0x18).map(record => {
      const start = revision === 8 ? 15 : 14, width = revision === 8 && (record.data.u8(14) & 1) ? 2 : 1;
      const length = record.data.u8(3), encoding = width === 2 ? "utf16le" as const : "latin1" as const;
      return { record, start, width, length, encoding, name: Buffer.from(record.data.bytes.subarray(start, start + length * width)).toString(encoding) };
    });
    let renamed = 0, forwarded = 0;
    for (const entry of declarations) {
      const replacement = mutations.get(entry.name);
      if (replacement) {
        expect(replacement.length).toBe(entry.length);
        stream.set(Buffer.from(replacement, entry.encoding), entry.record.offset + 4 + entry.start); renamed++;
      }
      const target = forwards.get(entry.name);
      if (target) {
        const index = declarations.findIndex(entry => entry.name === target) + 1;
        expect(index).toBeGreaterThan(0);
        const start = entry.record.offset + 4 + entry.start + entry.length * entry.width;
        const token = stream[start]! & 0x1f;
        expect([3, 25]).toContain(token);
        const offset = token === 3 ? 1 : revision === 8 ? 3 : 11;
        new DataView(stream.buffer).setUint16(start + offset, index, true); forwarded++;
      }
    }
    expect(renamed).toBe(12); expect(forwarded).toBe(4);
    streams.set(streamName, stream);
  }
  return { bytes: writeCfb(streams, context), cases };
}

it.each([7, 8, "dsf"] as const)("retains BIFF %s forward, replacement and permanent-name lifecycles", async profile => {
  const { bytes, cases } = await lifecycleInput(profile), before = new Uint8Array(bytes);
  const book = await readBiff(bytes, context), actual = recalculateWorkbook(book, context, true).sheets[0]!.cells;
  expect(actual.map(cell => cell.value)).toEqual(cases.map(entry => entry.expected));
  expect(book.names?.filter(name => name.name === "Sheet_Title" || name.name === "Print_Area")).toEqual([
    { name: "Sheet_Title", expression: "=11" }, { name: "Print_Area", expression: "=11" },
    { name: "Sheet_Title", expression: "=17", sheet: "Data" }, { name: "Print_Area", expression: "=17", sheet: "Data" },
    { name: "Sheet_Title", expression: '="Here"', sheet: "Here" }, { name: "Print_Area", expression: "=#REF!", sheet: "Here" },
    { name: "Sheet_Title", expression: '="Blank"', sheet: "Blank" }, { name: "Print_Area", expression: "=#REF!", sheet: "Blank" }
  ]);
  expect(bytes).toEqual(before);
});

it.each([7, 8, "dsf"] as const)("retains BIFF %s escaped default titles and removed permanent names", async profile => {
  const book: Workbook = { names: [{ name: "Sheet_Title", expression: "#NAME?", sheet: "removed" },
    { name: "Print_Area", expression: "#NAME?", sheet: "removed" }],
  sheets: [{ id: "escaped", name: 'A "quoted" title', cells: [] }, { id: "removed", name: "Removed", cells: [] }] };
  const imported = await readBiff(await createBiffWriter(profile)(book, [], context), context);
  expect(imported.names).toEqual([
    { name: "Sheet_Title", expression: '="A \\"quoted\\" title"', sheet: 'A "quoted" title' },
    { name: "Print_Area", expression: "=#REF!", sheet: 'A "quoted" title' }
  ]);
});

it.each([7, 8, "dsf"] as const)("keeps BIFF %s global indexed names distinct from implicit local names", async profile => {
  const book: Workbook = { names: [{ name: "Sheet_Title", expression: "31" }, { name: "Print_Area", expression: "37" },
    { name: "TitleAlias", expression: "Sheet_Title" }, { name: "AreaAlias", expression: "Print_Area" }],
  sheets: [{ id: "here", name: "Here", cells: ["Sheet_Title", "Print_Area", "TitleAlias", "AreaAlias"].map((name, row) =>
    ({ row, column: 0, formula: "=" + name, value: { kind: "number", value: 999 } })) }] };
  const imported = await readBiff(await createBiffWriter(profile)(book, [], context), context);
  expect(recalculateWorkbook(imported, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(
    [31, 37, 31, 37].map(value => ({ kind: "number", value })));
});
