import { expect, it } from "vitest";
import type { CapabilityContext, Diagnostic } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { createBiffWriter, readBiff } from "./biff.js";
import { readCfb } from "./biff-binary.js";
import { parseExpression } from "../formulas/parser.js";
import { rewriteReferences } from "../formulas/rewriting.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 8, operations: 1000 } };
const base: Workbook = { sheets: ["First", "Second", "Third"].map((name, index) => ({ id: `s${index}`, name,
  cells: [{ row: 0, column: 0, value: { kind: "number", value: 10 + index } }] })) };
function formulaBook(formula: string): Workbook {
  return { ...base, sheets: base.sheets.map((sheet, index) => index ? sheet : { ...sheet,
    cells: [...sheet.cells, { row: 1, column: 1, formula, value: { kind: "blank" } }] }) };
}

for (const revision of [7, 8] as const) {
  it.each([["First", "$Second"], ["$First", "Second"], ["First", "Second"], ["$First", "$Second"]])(
    `exports INDEX sheet selection as native BIFF${revision} areas (%s:%s)`, async (first, last) => {
      const diagnostics: Diagnostic[] = [];
      const bytes = await createBiffWriter(revision)(formulaBook(`of:=INDEX([${first}.$A$1:${last}.$A$1];1;1;2)`), [],
        { ...context, async diagnostic(value) { diagnostics.push(value); } });
      const book = await readBiff(bytes, context);
      // Calc's ScIndex rejects a 3D double reference; it requires a reference list.
      expect(book.sheets[0]!.cells.find(cell => cell.formula)!.formula).toContain("INDEX((");
      expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.find(cell => cell.formula)!.value)
        .toEqual({ kind: "number", value: 11 });
      expect(diagnostics).toHaveLength(first.startsWith("$") && last.startsWith("$") ? 0 : 1);
      if (diagnostics.length) expect(diagnostics[0]!.message).toContain("fixed sheet references");
    });

  // LibreOffice xeformula.cxx resolves the tab at the source anchor, then emits
  // fixed EXTERNSHEET links. Read the standard stream separately from any future
  // container annotations: this checks that interoperable fallback explicitly.
  it(`writes fixed BIFF${revision} sheet links and reports copy-semantics loss once per formula`, async () => {
    const diagnostics: Diagnostic[] = [];
    const bytes = await createBiffWriter(revision)(formulaBook("of:=[Second.$A$1]+[Second.$A$1]+[$Second.$A$1]"), [],
      { ...context, async diagnostic(value) { diagnostics.push(value); } });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "biff-loss-warning", severity: "warning" });
    expect(diagnostics[0]!.message).toContain("fixed sheet references");
    expect(diagnostics[0]!.message).toContain("'First' R2C2");
    const stream = readCfb(bytes, context).get(revision === 8 ? "Workbook" : "Book")!;
    const book = await readBiff(stream, context);
    const cell = book.sheets[0]!.cells.find(cell => cell.formula)!;
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.find(cell => cell.formula)!.value)
      .toEqual({ kind: "number", value: 33 });
    const parsed = parseExpression(cell.formula!, { position: { sheet: book.sheets[0]!.id, row: 1, column: 1 }, workbook: book });
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    const copied = rewriteReferences(parsed.document, { translation: "copy", position: { sheet: book.sheets[1]!.id, row: 1, column: 1 } });
    const moved = { ...book, sheets: book.sheets.map((sheet, index) => index !== 1 ? sheet :
      { ...sheet, cells: [...sheet.cells, { ...cell, formula: copied }] }) };
    expect(recalculateWorkbook(moved, context, true).sheets[1]!.cells.find(cell => cell.formula)!.value)
      .toEqual({ kind: "number", value: 33 });
  });

  it(`binds an implicit first sheet in a BIFF${revision} cross-sheet range to the source anchor`, async () => {
    const source: Workbook = { ...base, sheets: base.sheets.map((sheet, index) => index !== 1 ? sheet :
      { ...sheet, cells: [...sheet.cells, { row: 1, column: 1, formula: "of:=SUM([.$A$1:$Third.$A$1])", value: { kind: "blank" } }] }) };
    const bytes = await createBiffWriter(revision)(source, [], context);
    const book = await readBiff(bytes, context);
    expect(recalculateWorkbook(book, context, true).sheets[1]!.cells.find(cell => cell.formula)!.value)
      .toEqual({ kind: "number", value: 23 });
  });

  it(`diagnoses a relative last sheet in a BIFF${revision} range with a fixed first sheet`, async () => {
    const diagnostics: Diagnostic[] = [];
    const bytes = await createBiffWriter(revision)(formulaBook("of:=SUM([$Second.$A$1:Third.$A$1])"), [],
      { ...context, async diagnostic(value) { diagnostics.push(value); } });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("biff-loss-warning");
    const book = await readBiff(bytes, context);
    expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.find(cell => cell.formula)!.value)
      .toEqual({ kind: "number", value: 23 });
  });

  it(`retains a BIFF${revision} name's declared target and diagnoses lost caller-relative semantics`, async () => {
    const book: Workbook = { ...base, names: [{ name: "Previous", expression: "of:=[Second.$A$1]",
      position: { sheet: "s2", row: 0, column: 0 } }], sheets: base.sheets.map((sheet, index) => index !== 1 ? sheet :
      { ...sheet, cells: [...sheet.cells, { row: 1, column: 1, formula: "=Previous", value: { kind: "blank" } }] }) };
    expect(recalculateWorkbook(book, context, true).sheets[1]!.cells.find(cell => cell.formula)!.value)
      .toEqual({ kind: "number", value: 10 });
    const diagnostics: Diagnostic[] = [];
    const bytes = await createBiffWriter(revision)(book, [], { ...context, async diagnostic(value) { diagnostics.push(value); } });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("Previous");
    const stream = readCfb(bytes, context).get(revision === 8 ? "Workbook" : "Book")!;
    const reopened = await readBiff(stream, context);
    expect(recalculateWorkbook(reopened, context, true).sheets[1]!.cells.find(cell => cell.formula)!.value)
      .toEqual({ kind: "number", value: 11 });
  });

  it(`keeps ordinary and fixed named BIFF${revision} references free of loss warnings`, async () => {
    const diagnostics: Diagnostic[] = [];
    await createBiffWriter(revision)(formulaBook("of:=[.$A$1]+[$Second.$A$1]"), [],
      { ...context, async diagnostic(value) { diagnostics.push(value); } });
    expect(diagnostics).toEqual([]);
  });
}
