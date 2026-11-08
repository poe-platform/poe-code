import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { parseExpression } from "../formulas/parser.js";
import { rewriteReferences } from "../formulas/rewriting.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 100000, cells: 100, sheets: 256, operations: 10000 } };
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
const number = (value: number) => [5, ...word(value * 2)];
function input(named: boolean, sheet: number | undefined, reversed = false, dynamic = false, flags = 0): Uint8Array {
  const name = Array.from("@<<@123>>INDEX(", c => c.charCodeAt(0));
  // Formula sheet C is outside the absolute source span A:B. Its independent
  // selector is in C2; source B2 values differ between A and B.
  const tokens = [2, flags, ...word(1), reversed ? 1 : 0, 0, ...word(2), reversed ? 0 : 1, 1,
    ...number(1), ...number(0), ...(sheet === undefined ? [] : dynamic ? [1, 0, ...word(1), 2, 2] : number(sheet)),
    ...(named ? [122, sheet === undefined ? 3 : 4, ...word(name.length), ...name] : [98, sheet === undefined ? 3 : 4]), 3];
  return Uint8Array.from([...record(0, [...word(0x1002), 4, 0, ...Array<number>(22).fill(0)]),
    ...record(25, [0, 0, 2, 0, ...Array<number>(10).fill(0), ...tokens]),
    ...record(24, [...word(1), 0, 1, ...word(20)]),
    ...record(24, [...word(1), 1, 1, ...word(40)]),
    ...record(24, [...word(1), 2, 1, ...word(60)]),
    ...record(24, [...word(1), 2, 2, ...word((sheet ?? 0) * 2)]), ...record(1)]);
}

for (const named of [false, true]) {
  it.each([undefined, 0, 1])(`selects the Lotus INDEX source sheet (named ${named}, offset %s)`, async sheet => {
    const book = await readLotus(input(named, sheet), context);
    const result = recalculateWorkbook(book, context, true);
    const formula = result.sheets.flatMap(s => s.cells).find(c => c.formula)!;
    expect(formula.value).toEqual({ kind: "number", value: sheet === 1 ? 20 : 10 });
    expect(formula.formula).toContain("INDEX((");
  });
  it(`normalizes reversed source sheet endpoints (named ${named})`, async () => {
    const book = await readLotus(input(named, 1, true), context);
    expect(recalculateWorkbook(book, context, true).sheets.flatMap(s => s.cells).find(c => c.formula)!.value)
      .toEqual({ kind: "number", value: 20 });
  });
  it(`keeps a live INDEX sheet selector (named ${named})`, async () => {
    const book = await readLotus(input(named, 0, false, true), context);
    expect(recalculateWorkbook(book, context, true).sheets.flatMap(s => s.cells).find(c => c.formula)!.value)
      .toEqual({ kind: "number", value: 10 });
    const changed = { ...book, sheets: book.sheets.map(s => ({ ...s,
      cells: s.cells.map(c => c.row === 1 && c.column === 2 ? { ...c, value: { kind: "number" as const, value: 1 } } : c) })) };
    expect(recalculateWorkbook(changed, context, true).sheets.flatMap(s => s.cells).find(c => c.formula)!.value)
      .toEqual({ kind: "number", value: 20 });
  });
}

it("selects the last sheet of the complete 256-sheet Lotus span", async () => {
  const tokens = [2, 0, ...word(1), 0, 0, ...word(2), 255, 1,
    ...number(1), ...number(0), ...number(255), 98, 4, 3];
  const bytes = Uint8Array.from([...record(0, [...word(0x1002), 4, 0, ...Array<number>(22).fill(0)]),
    ...record(25, [0, 0, 128, 0, ...Array<number>(10).fill(0), ...tokens]),
    ...record(24, [...word(1), 255, 1, ...word(40)]), ...record(1)]);
  await expect(readLotus(bytes, { ...context, limits: { ...context.limits, operations: 100 } }))
    .rejects.toMatchObject({ code: "resource-limit" });
  const book = await readLotus(bytes, context);
  expect(book.sheets).toHaveLength(256);
  expect(recalculateWorkbook(book, context, true).sheets.flatMap(s => s.cells).find(c => c.formula)!.value)
    .toEqual({ kind: "number", value: 20 });
});

it.each([7, 8])("selects a sheet from an imported Lotus named range (opcode %i)", async opcode => {
  const name = [...Array.from("Across", c => c.charCodeAt(0)), ...Array<number>(10).fill(0)];
  const tokens = [opcode, ...Array.from("Across", c => c.charCodeAt(0)), 0,
    ...number(1), ...number(0), ...number(1), 98, 4, 3];
  const bytes = Uint8Array.from([...record(0, [...word(0x1002), 4, 0, ...Array<number>(22).fill(0)]),
    ...record(9, [0, 0, ...name, ...word(1), 0, 0, ...word(2), 1, 1]),
    ...record(25, [0, 0, 2, 0, ...Array<number>(10).fill(0), ...tokens]),
    ...record(24, [...word(1), 0, 1, ...word(20)]),
    ...record(24, [...word(1), 1, 1, ...word(40)]), ...record(1)]);
  const book = await readLotus(bytes, context);
  expect(book.names?.find(n => n.name === "Across")).toBeDefined();
  expect(recalculateWorkbook(book, context, true).sheets.flatMap(s => s.cells).find(c => c.formula)!.value)
    .toEqual({ kind: "number", value: 20 });
});


for (const named of [false, true]) for (const flags of [4, 32, 36]) {
  it.each([0, 1])(`retains relative INDEX sheet selection across copy (named ${named}, flags ${flags}, offset %i)`, async offset => {
    const original = await readLotus(input(named, offset, false, false, flags), context);
    const book = { ...original, sheets: [...original.sheets, { id: "lotus-3", name: "Sheet4", cells: [] }] };
    const owner = book.sheets.find(s => s.id === "lotus-2")!;
    const source = owner.cells.find(c => c.formula)!;
    expect(source.formula?.startsWith("of:=")).toBe(true);
    expect(recalculateWorkbook(book, context, true).sheets.find(s => s.id === owner.id)!.cells.find(c => c.formula)!.value)
      .toEqual({ kind: "number", value: offset === 0 ? 10 : 20 });
    const parsed = parseExpression(source.formula!, { workbook: book, position: { sheet: owner.id, row: 0, column: 0 } });
    expect(parsed.ok).toBe(true); if (!parsed.ok) return;
    const formula = rewriteReferences(parsed.document, { translation: "copy", position: { sheet: "lotus-3", row: 0, column: 0 } });
    const copied = { ...book, sheets: book.sheets.map(s => s.id === "lotus-3" ? { ...s,
      cells: [{ row: 0, column: 0, value: { kind: "blank" as const }, formula }] } : s) };
    const value = recalculateWorkbook(copied, context, true).sheets.find(s => s.id === "lotus-3")!.cells[0]!.value;
    expect(value).toEqual(flags === 4 && offset === 1 ? { kind: "error", value: "#REF!" }
      : { kind: "number", value: flags === 32 ? offset === 0 ? 10 : 20 : offset === 0 ? 20 : 30 });
  });
}


for (const edition of ["2006", "2008"] as const) {
  it.each([4, 32, 36])(`exports relative INDEX spans as native areas with source annotations (${edition}, flags %i)`, async flags => {
    const book = recalculateWorkbook(await readLotus(input(false, 1, false, false, flags), context), context, true);
    const original = book.sheets.flatMap(s => s.cells).find(c => c.formula)!.formula;
    const bytes = await createXlsxWriter(edition)(book, [], context);
    const zip = createZipCodec(), bounds = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
      maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
    const archive = await zip.readZipArchive(bytes, bounds, context.signal);
    let content = "";
    for (const entry of archive.entries.filter(e => e.name.startsWith("xl/worksheets/sheet") && e.name.endsWith(".xml"))) {
      for await (const chunk of zip.decodeZipEntry(entry, bounds, context.signal)) content += new TextDecoder().decode(chunk);
    }
    expect(content).toContain("INDEX((");
    expect(content).toContain("ssc:openformula=");
    const reopened = await readXlsx(bytes, { ...context, limits: { ...context.limits, inputBytes: context.limits.outputBytes } });
    expect(reopened.sheets.flatMap(s => s.cells).find(c => c.formula)!.formula).toBe(original);
    expect(recalculateWorkbook(reopened, context, true).sheets.flatMap(s => s.cells).find(c => c.formula)!.value)
      .toEqual({ kind: "number", value: 20 });
  });
}
