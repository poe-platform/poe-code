import {expect, it, vi} from "vitest";
import {PDFPage, PDFArray, PDFRawStream, decodePDFRawStream} from "pdf-lib";
import * as fontShaping from "../rendering/print/font-shaping.js";
import {suppliedDefaultFont} from "safe-bash-pdf-engine";
import type {CapabilityContext} from "../contracts.js";
import {createFormattingCapability} from "../formatting.js";
import {readGnumeric} from "./gnumeric.js";
import {writePdf} from "./pdf.js";
import {pdfText} from "./pdf-text.test-support.js";
const context: CapabilityContext = {signal: new AbortController().signal, own() {},
  environment: {env: {}, locale: "C", timezone: "UTC"}, formatting: createFormattingCapability(),
  fonts: {async resolve() {return suppliedDefaultFont().bytes;}},
  limits: {inputBytes: 1000000, outputBytes: 4000000, workbookWork: 6000000, cells: 10000, sheets: 4, operations: 100}};
async function fixture(alignment: string, unit = 10, width = 72, vertical = "BOTTOM", height = 20, wrap = 0) {
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Version Epoch="1" Major="12" Minor="61" Full="1.12.61"/><g:SheetNameIndex><g:SheetName g:Cols="256" g:Rows="65536">S</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>S</g:Name><g:PrintInformation><g:paper>na_letter</g:paper><g:Margins><g:top Points="72"/><g:bottom Points="72"/><g:left Points="72"/><g:right Points="72"/></g:Margins><g:Header Left="" Middle="" Right=""/><g:Footer Left="" Middle="" Right=""/></g:PrintInformation><g:Styles><g:StyleRegion startRow="0" endRow="3" startCol="0" endCol="0"><g:Style HAlign="${alignment}" VAlign="GNM_VALIGN_${vertical}" WrapText="${wrap}" ShrinkToFit="0" Rotation="0" Shade="0" Indent="0" Locked="1" Hidden="0" Fore="0:0:0" Back="FFFF:FFFF:FFFF" PatternColor="0:0:0" Format="General"><g:Font Unit="${unit}" Bold="0" Italic="0" Underline="0" StrikeThrough="0" Script="0">Sans</g:Font></g:Style></g:StyleRegion></g:Styles><g:Cols DefaultSizePts="${width}"><g:ColInfo No="0" Unit="${width}" HardSize="1"/></g:Cols><g:Rows DefaultSizePts="${height}"><g:RowInfo No="0" Unit="${height}" HardSize="1" Count="4"/></g:Rows><g:Cells><g:Cell Row="0" Col="0" ValueType="60">alpha</g:Cell><g:Cell Row="1" Col="0" ValueType="40">-12.5</g:Cell><g:Cell Row="2" Col="0" ValueType="20">TRUE</g:Cell><g:Cell Row="3" Col="0" ValueType="50">#DIV/0!</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`), context);
}
it.each([
  ["GNM_HALIGN_GENERAL", [76.75, 121.25, 101.25, 94.5]],
  ["GNM_HALIGN_LEFT", [76.75, 76.75, 76.75, 76.75]],
  ["GNM_HALIGN_RIGHT", [121.25, 121.25, 125.75, 112.25]],
  ["GNM_HALIGN_CENTER", [99, 99, 101.25, 94.5]]
] as const)("prints four value kinds with native %s alignment and numeric minus", async (alignment, positions) => {
  const book = await fixture(alignment), before = structuredClone(book);
  const {runs: cells} = await pdfText(await writePdf(book, [], context));
  expect(cells.map(cell => cell.text)).toEqual(["alpha", "−12.5", "TRUE", "#DIV/0!"]);
  // The supplied monospaced fixture has 600/1000em advances. Native cell
  // layout excludes 5pt from width and adds its 4.75pt leading inset.
  expect(cells.map(cell => cell.glyphs[0]!.x)).toEqual(positions);
  expect(cells.map(cell => cell.size)).toEqual([7.5, 7.5, 7.5, 7.5]);
  expect(book).toEqual(before);
});

it.each([[8, 125], [14, 113.75]] as const)("aligns Unit%s cells using rounded shaped advances", async (unit, x) => {
  const {runs} = await pdfText(await writePdf(await fixture("GNM_HALIGN_RIGHT", unit), [], context));
  expect(runs.find(run => run.text === "alpha")?.glyphs[0]?.x).toBe(x);
});
it("clips text whose rounded display width exceeds the first printable cell", async () => {
  const book = await fixture("GNM_HALIGN_RIGHT", 8, 23.4);
  // Five600/1000em glyphs are18raw points, but round to5display pixels each:
  // 18.75pt must not fit in the18.4pt available width.
  const single = {...book, sheets: book.sheets.map(sheet => ({...sheet, cells: sheet.cells.slice(0, 1)}))};
  expect((await pdfText(await writePdf(single, [], context))).runs[0]!.text).toBe("alpha");
});

it("uses shaped advance positions instead of nominal glyph widths", async () => {
  const original = fontShaping.createFontShaper;
  const create = vi.spyOn(fontShaping, "createFontShaper").mockImplementation((context, tick) => {
    const shaper = original(context, tick);
    return {...shaper, shape(metrics, value) {
    const run = shaper.shape(metrics, value);
    return {...run, positions: run.positions.map(position => ({...position, xAdvance: position.xAdvance - 100}))};
    }};
  });
  try {
    const {runs} = await pdfText(await writePdf(await fixture("GNM_HALIGN_RIGHT"), [], context));
    expect(runs.find(run => run.text === "alpha")?.glyphs[0]?.x).toBe(125);
  } finally {create.mockRestore();}
});

it.each([false, true])("prints right-aligned strings across empty columns with XLSX metadata %s", async xlsx => {
  const book = await fixture("GNM_HALIGN_RIGHT", 10, 48), sheet = book.sheets[0]!;
  const value = "OVERFLOWTEXTCONTINUES";
  const input = { ...book, sheets: [{ ...sheet, cells: [{ ...sheet.cells[0]!, column: 3, ...(xlsx ? { style: { ...sheet.cells[0]!.style!, xlsx: {} } } : {}), value: { kind: "string" as const, value } }] }] };
  const { runs } = await pdfText(await writePdf(input, [], context));
  expect(runs.map(run => run.text)).toEqual([value]);
  expect(runs[0]!.glyphs[0]!.x).toBeLessThan(72 + 3 * 48);
});
it("preserves configured columns instead of resizing them from a CSV filename", async () => {
  const book = { sheets: [{ id: "s", name: "Data", view: { defaultColumnWidth: 48 }, columns: [{ index: 0, sizePoints: 48 }], cells: [
    { row: 0, column: 0, value: { kind: "string" as const, value: "OVERFLOWTEXTCONTINUES" } },
    { row: 0, column: 1, value: { kind: "string" as const, value: "END" } }
  ] }] };
  const { runs } = await pdfText(await writePdf(book, [], { ...context, inputFilename: "input.csv" }));
  expect(runs.find(run => run.text === "END")!.glyphs[0]!.x).toBe(124.75);
});

it.each([
  [undefined, 76, 140, 83.5],
  [0, 124, 92, 95.5],
  [2, 76, 92, 83.5]
] as const)("clips centered overflow independently at blocker column %s", async (blocker, left, right, x) => {
  const book = await fixture("GNM_HALIGN_CENTER", 10, 48), sheet = book.sheets[0]!;
  const value = "OVERFLOWTEXTCONTINUES";
  const cells = [{ ...sheet.cells[0]!, column: 1, value: { kind: "string" as const, value } }];
  if (blocker !== undefined) cells.push({ ...sheet.cells[0]!, column: blocker, value: { kind: "string", value: "END" } });
  cells.push({...sheet.cells[0]!, row: 1, column: 0, value: {kind: "string", value: "anchor"}});
  const {pdf, runs} = await pdfText(await writePdf({...book, sheets: [{...sheet, cells}]}, [], context));
  expect(runs[0]!.text).toBe(value);
  expect(runs[0]!.glyphs[0]!.x).toBe(x);
  const contents = pdf.getPage(0).node.Contents() as PDFArray;
  const operators = contents.asArray().map(ref => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref) as PDFRawStream).decode())).join("\n");
  expect(operators).toContain(`${left} 700 ${right} 20 re`);
});

it("renders implicit defaults identically to the materialized native default style", async () => {
  const explicit = await fixture("GNM_HALIGN_GENERAL"), sheet = explicit.sheets[0]!;
  const implicit = {...explicit, sheets: [{...sheet, cells: sheet.cells.map(cell => {
    const copy = {...cell}; delete copy.style; return copy;
  })}]};
  const expected = await pdfText(await writePdf(explicit, [], context));
  const actual = await pdfText(await writePdf(implicit, [], context));
  expect(actual.runs).toEqual(expected.runs);
});

it.each(["\n", "\r", "\r\n", "\u2028", "\u2029"])("prints explicit %j line breaks without requiring control glyphs", async separator => {
  const book = await fixture("GNM_HALIGN_RIGHT"), sheet = book.sheets[0]!;
  const cells = [{...sheet.cells[0]!, value: {kind: "string" as const, value: `alpha${separator}ab`}}];
  const {runs} = await pdfText(await writePdf({...book, sheets: [{...sheet, cells}]}, [], context));
  expect(runs.map(run => run.text)).toEqual(["alpha", "ab"]);
  expect(runs[0]!.glyphs[0]!.x).toBe(121.25);
  expect(runs[1]!.glyphs[0]!.x).toBe(134.75);
  expect(runs[0]!.glyphs[0]!.y - runs[1]!.glyphs[0]!.y).toBeCloseTo(9.9, 6);
});

it("retains blank and trailing lines in the text block", async () => {
  const book = await fixture("GNM_HALIGN_LEFT"), sheet = book.sheets[0]!;
  const cells = [{...sheet.cells[0]!, value: {kind: "string" as const, value: "alpha\n\nab\n"}}];
  const {runs} = await pdfText(await writePdf({...book, sheets: [{...sheet, cells}]}, [], context));
  expect(runs.map(run => run.text)).toEqual(["alpha", "ab"]);
  expect(runs[0]!.glyphs[0]!.y - runs[1]!.glyphs[0]!.y).toBeCloseTo(19.8, 6);
});


it.each([
  ["TOP", 711.6, 701.7], ["CENTER", 698, 688.1], ["BOTTOM", 684.4, 674.5],
  ["JUSTIFY", 711.6, 674.5], ["DISTRIBUTED", 698, 688.1]
] as const)("positions multiline %s text with native block spacing", async (vertical, first, second) => {
  const book = await fixture("GNM_HALIGN_LEFT", 10, 72, vertical, 48), sheet = book.sheets[0]!;
  const cells = [{...sheet.cells[0]!, value: {kind: "string" as const, value: "alpha\nab"}}];
  const {runs} = await pdfText(await writePdf({...book, sheets: [{...sheet, cells}]}, [], context));
  expect(runs[0]!.glyphs[0]!.y).toBeCloseTo(first, 3);
  expect(runs[1]!.glyphs[0]!.y).toBeCloseTo(second, 3);
});
it("rounds centered paragraph offsets to native display pixels", async () => {
  const book = await fixture("GNM_HALIGN_CENTER", 8), sheet = book.sheets[0]!;
  const cells = [{...sheet.cells[0]!, value: {kind: "string" as const, value: "alpha\nab"}}];
  const {runs} = await pdfText(await writePdf({...book, sheets: [{...sheet, cells}]}, [], context));
  expect(runs[1]!.glyphs[0]!.x - runs[0]!.glyphs[0]!.x).toBe(6);
});
it.each(["JUSTIFY", "DISTRIBUTED"])("wraps strings when implied by %s", async vertical => {
  const original = await fixture("GNM_HALIGN_LEFT", 10, 12, vertical), sheet = original.sheets[0]!;
  const book = {...original, sheets: [{...sheet, cells: [sheet.cells[0]!]}]};
  const {runs} = await pdfText(await writePdf(book, [], context));
  expect(runs.map(run => run.text.split("‐").join("")).join("")).toBe("alpha");
  expect(runs.length).toBeGreaterThan(1);
});

it.each(["array", "shared"] as const)("marks only %s formula groups in formula-display mode", async kind => {
  const original = await fixture("GNM_HALIGN_GENERAL"), sheet = original.sheets[0]!;
  const cells = [0, 1].flatMap(row => [0, 1].map(column => ({...sheet.cells[0]!, row, column,
    formula: "=1+2", formulaGroup: "group", value: {kind: "number" as const, value: 3}})));
  const book = {...original, sheets: [{...sheet, cells, view: {...sheet.view, displayFormulas: true},
    formulaGroups: [{id: "group", kind, expression: "=1+2", range: {startRow: 0, startColumn: 0, endRow: 1, endColumn: 1}}]}]};
  const {runs} = await pdfText(await writePdf(book, [], context));
  expect(runs.map(run => run.text)).toEqual(Array(4).fill(kind === "array" ? "{=1+2}" : "=1+2"));
  const values = {...book, sheets: book.sheets.map(sheet => ({...sheet, view: {...sheet.view, displayFormulas: false}}))};
  expect((await pdfText(await writePdf(values, [], context))).runs.map(run => run.text)).toEqual(["3", "3", "3", "3"]);
});

it.each([
  ["=1 + 2 * 3", "=1+2*3"],
  ["=SUM(A1:A1)", "=sum(A1)"], ["=SUM($A$1:$A$1)", "=sum($A$1)"],
  ["=SUM(S!A1:A1)", "=sum(S!A1)"], ["=SUM($A1:A1)", "=sum($A1:A1)"],
  ["=SUM(A:A)", "=sum(A:A)"], ["=SUM(1:1)", "=sum(1:1)"], ["=sUm(1,2)", "=sum(1,2)"], ["=((1+2))", "=((1+2))"],
  ["=+1", "=+1"], ["= a1 + $b$2", "=A1+$B$2"], ["=1.00+1e3", "=1+1000"],
  ["=MY.Unknown(1,2)", "=MY.Unknown(1,2)"], ["=1e-9", "=1E-09"], ["=S!A2", "=S!A2"], ["={1e-9,-1e-8}", "={1E-09,-1E-08}"], ['="a b" & "c"', '="a b"&"c"']
])("prints native expression spelling for %s", async (formula, expected) => {
  const original = await fixture("GNM_HALIGN_GENERAL"), sheet = original.sheets[0]!;
  const book = {...original, sheets: [{...sheet, view: {...sheet.view, displayFormulas: true},
    cells: [{...sheet.cells[0]!, formula, value: {kind: "number" as const, value: 0}}]}]};
  expect((await pdfText(await writePdf(book, [], context))).runs[0]!.text).toBe(expected);
});

it.each([
  ["alpha\u2028ab\u2028", 684.4], ["alpha\u2029ab\u2029", 694.3],
  ["alpha\u2028\nab", 684.4], ["alpha\u2028\r\nab", 684.4], ["alpha\u2028\u2029ab", 684.4]
] as const)("preserves native paragraph-boundary height for %j", async (value, firstY) => {
  const original = await fixture("GNM_HALIGN_LEFT", 10, 72, "BOTTOM", 48), sheet = original.sheets[0]!;
  const book = {...original, sheets: [{...sheet, cells: [{...sheet.cells[0]!, value: {kind: "string" as const, value}}]}]};
  expect((await pdfText(await writePdf(book, [], context))).runs[0]!.glyphs[0]!.y).toBeCloseTo(firstY, 6);
});

it.each([
  ["=A1", "=R[-1]C[-1]"], ["=B2", "=RC"],
  ["=A1+$A$1+A$1+$A1", "=R[-1]C[-1]+R1C1+R1C[-1]+R[-1]C1"],
  ["=SUM(A1:C3)", "=sum(R[-1]C[-1]:R[1]C[1])"],
  ["=SUM(A:A)", "=sum(C[-1])"], ["=SUM(1:1)", "=sum(R[-1])"], ["=SUM(A1:A1)", "=sum(R[-1]C[-1])"], ["=S!A1", "=S!R[-1]C[-1]"]
])("prints native R1C1 reference spelling for %s", async (formula, expected) => {
  const original = await fixture("GNM_HALIGN_GENERAL"), sheet = original.sheets[0]!;
  const book = {...original, sheets: [{...sheet, view: {...sheet.view, displayFormulas: true, gnumeric: {ExprConvention: "gnumeric:R1C1"}},
    cells: [{...sheet.cells[0]!, row: 1, column: 1, formula}]}]};
  expect((await pdfText(await writePdf(book, [], context))).runs[0]!.text).toBe(expected);
});
it("prints each R1C1 array member relative to the array corner", async () => {
  const original = await fixture("GNM_HALIGN_GENERAL"), sheet = original.sheets[0]!;
  const cells = [1, 2].flatMap(row => [1, 2].map(column => ({...sheet.cells[0]!, row, column, formula: "=A1", formulaGroup: "array"})));
  const book = {...original, sheets: [{...sheet, cells, view: {...sheet.view, displayFormulas: true, gnumeric: {ExprConvention: "gnumeric:R1C1"}},
    formulaGroups: [{id: "array", kind: "array" as const, expression: "=A1", range: {startRow: 1, startColumn: 1, endRow: 2, endColumn: 2}}]}]};
  expect((await pdfText(await writePdf(book, [], context))).runs.map(run => run.text)).toEqual(Array(4).fill("{=R[-1]C[-1]}"));
});


it.each([
  ["=SUM(A1:IV2)", "=sum(1:2)", "=sum(R:R[1])"],
  ["=SUM(A1:B65536)", "=sum(A:B)", "=sum(C:C[1])"],
  ["=SUM(A1:IV65536)", "=sum(1:65536)", "=sum(R:R[65535])"],
  ["=SUM($A$1:$IV$2)", "=sum($1:$2)", "=sum(R1:R2)"],
  ["=SUM($A1:IV$2)", "=sum(1:$2)", "=sum(R:R2)"],
  ["=SUM(IV2:A1)", "=sum(1:2)", "=sum(R[1]:R)"],
  ["=SUM(A1:IU2)", "=sum(A1:IU2)", "=sum(RC:R[1]C[254])"],
  ["=SUM(A1:B65535)", "=sum(A1:B65535)", "=sum(RC:R[65534]C[1])"]
])("prints native full-axis range boundaries for %s", async (formula, a1, r1c1) => {
  const original = await fixture("GNM_HALIGN_GENERAL"), sheet = original.sheets[0]!;
  for (const [convention, expected] of [["A1", a1], ["R1C1", r1c1]]) {
    const book = {...original, sheets: [{...sheet, view: {...sheet.view, displayFormulas: true,
      gnumeric: {ExprConvention: "gnumeric:" + convention}}, cells: [{...sheet.cells[0]!, formula}]}]};
    expect((await pdfText(await writePdf(book, [], context))).runs[0]!.text).toBe(expected);
  }
});


it.each([
  ["=SUM(A1:IV2)", "=sum(A1:IV2)"],
  ["=SUM(A1:SR2)", "=sum(1:2)"],
  ["=SUM(T!A1:IV2)", "=sum(T!1:2)"],
  ["=SUM(T!A1:B65536)", "=sum(T!A:B)"]
])("uses the referenced sheet dimensions for %s", async (formula, expected) => {
  const original = await fixture("GNM_HALIGN_GENERAL"), sheet = original.sheets[0]!;
  const book = {...original, sheets: [{...sheet, size: {rows: 131072, columns: 512},
    view: {...sheet.view, displayFormulas: true}, cells: [{...sheet.cells[0]!, formula}]},
    {...sheet, id: "t", name: "T", cells: []}]};
  expect((await pdfText(await writePdf(book, [], context))).runs[0]!.text).toBe(expected);
});


it.each([
  ["R1C1", undefined, "=R[-1]C[-1]"],
  ["R1C1", "gnumeric:A1", "=R[-1]C[-1]"],
  ["A1", "gnumeric:R1C1", "=A1"]
])("prints normalized reference mode %s before retained convention %s", async (referenceMode, ExprConvention, expected) => {
  const original = await fixture("GNM_HALIGN_GENERAL"), sheet = original.sheets[0]!;
  const book = {...original, sheets: [{...sheet, view: {...sheet.view, displayFormulas: true,
    referenceMode, ...(ExprConvention ? {gnumeric: {ExprConvention}} : {})},
    cells: [{...sheet.cells[0]!, row: 1, column: 1, formula: "=A1"}]}]};
  expect((await pdfText(await writePdf(book, [], context))).runs[0]!.text).toBe(expected);
});


it.each([false, true])("excludes stored blank boundary cells from print extent (styled=%s)", async styled => {
  const original = await fixture("GNM_HALIGN_LEFT"), sheet = original.sheets[0]!;
  const visible = {...sheet.cells[0]!, row: 1, column: 1};
  const baseline = {...original, sheets: [{...sheet, cells: [visible]}]};
  const blank = {row: 0, column: 0, value: {kind: "blank" as const}, ...(styled ? {style: visible.style} : {})};
  const input = {...original, sheets: [{...sheet, cells: [blank, visible, {...blank, row: 2, column: 2}]}]};
  const expected = await pdfText(await writePdf(baseline, [], context));
  const actual = await pdfText(await writePdf(input, [], context));
  expect(actual.runs).toEqual(expected.runs);
  expect(actual.pdf.getPageCount()).toBe(expected.pdf.getPageCount());
});
it("keeps empty strings as print-extent anchors", async () => {
  const original = await fixture("GNM_HALIGN_LEFT"), sheet = original.sheets[0]!;
  const visible = {...sheet.cells[0]!, row: 1, column: 1};
  const anchor = {...sheet.cells[0]!, value: {kind: "string" as const, value: ""}};
  const input = {...original, sheets: [{...sheet, cells: [anchor, visible]}]};
  expect((await pdfText(await writePdf(input, [], context))).runs.find(r => r.text === "alpha")!.glyphs[0]!.x).toBe(148.75);
});


it.each(["row", "column", "both"])("excludes hidden %s contents from print bounds", async axis => {
  const original = await fixture("GNM_HALIGN_LEFT"), sheet = original.sheets[0]!;
  const visible = {...sheet.cells[0]!, row: 1, column: 1};
  const rows = sheet.rows!.map(row => ({...row, hidden: row.index === 2 && axis !== "column"}));
  const columns = [...sheet.columns!, {index: 2, sizePoints: 72, hidden: axis !== "row"}];
  const baseline = {...original, sheets: [{...sheet, rows, columns, cells: [visible]}]};
  const cells = [visible, ...(axis !== "column" ? [{...visible, row: 2, column: 0}] : []),
    ...(axis !== "row" ? [{...visible, row: 0, column: 2}] : [])];
  const actual = await pdfText(await writePdf({...original, sheets: [{...sheet, rows, columns, cells}]}, [], context));
  const expected = await pdfText(await writePdf(baseline, [], context));
  expect(actual.runs).toEqual(expected.runs);
  expect(actual.pdf.getPageCount()).toBe(expected.pdf.getPageCount());
});

it.each(["JUSTIFY", "DISTRIBUTED"])("accepts horizontal %s without expanding final lines", async alignment => {
  const actual = await pdfText(await writePdf(await fixture(`GNM_HALIGN_${alignment}`), [], context));
  const expected = await pdfText(await writePdf(await fixture(alignment === "JUSTIFY" ? "GNM_HALIGN_LEFT" : "GNM_HALIGN_CENTER"), [], context));
  expect(actual.runs).toEqual(expected.runs);
});
it("justifies wrapped lines to the cell width while preserving paragraph endings", async () => {
  const original = await fixture("GNM_HALIGN_JUSTIFY", 10, 72, "TOP", 60), sheet = original.sheets[0]!;
  const book = {...original, sheets: [{...sheet, cells: [{...sheet.cells[0]!, value: {kind: "string" as const, value: "alpha beta gamma delta epsilon"}}]}]};
  const {runs} = await pdfText(await writePdf(book, [], context));
  expect(runs.map(run => run.text)).toEqual(["alpha beta", "gamma delta", "epsilon"]);
  expect(runs[0]!.glyphs[6]!.x).toBeCloseTo(125.75, 3);
  expect(runs[1]!.glyphs[6]!.x).toBeCloseTo(121.25, 3);
  expect(runs[2]!.glyphs[0]!.x).toBe(76.75);
});

it.each(["12345678901234567890", "abcdefghijklmnop", "alpha\u00a0beta gamma delta"])("expands wrapped clusters or nonbreaking spaces for %s", async value => {
  const original = await fixture("GNM_HALIGN_JUSTIFY", 10, 72, "TOP", 60), sheet = original.sheets[0]!;
  const {runs} = await pdfText(await writePdf({...original, sheets: [{...sheet, cells: [{...sheet.cells[0]!, value: {kind: "string" as const, value}}]}]}, [], context));
  expect(runs.length).toBeGreaterThan(1);
  expect(runs[0]!.glyphs[0]!.x).toBe(76.75);
  expect(runs[0]!.glyphs.at(-1)!.x).toBeCloseTo(139.25, 2);
});
it("supports exact fontkit cluster mappings without native shaping", async () => {
  const originalShaper = fontShaping.createFontShaper;
  const create = vi.spyOn(fontShaping, "createFontShaper").mockImplementation((context, tick) => {
    const shaper = originalShaper(context, tick);
    return {...shaper, shape(metrics, value) {return metrics.layout(value);}};
  });
  try {
    const original = await fixture("GNM_HALIGN_JUSTIFY", 10, 72, "TOP", 60), sheet = original.sheets[0]!;
    const {runs} = await pdfText(await writePdf({...original, sheets: [{...sheet, cells: [{...sheet.cells[0]!, value: {kind: "string" as const, value: "12345678901234567890"}}]}]}, [], context));
    expect(runs[0]!.glyphs.at(-1)!.x).toBeCloseTo(139.25, 2);
  } finally {create.mockRestore();}
});


it.each(["JUSTIFY", "DISTRIBUTED"])("expands U+2028 forced lines but not paragraph endings with %s", async alignment => {
  for (const separator of ["\n", "\r", "\r\n", "\u2028", "\u2029", "\u2028\n", "\u2028\u2028"]) {
    const original = await fixture(`GNM_HALIGN_${alignment}`, 10, 72, "TOP", 60, 1), sheet = original.sheets[0]!;
    const value = "alpha beta" + separator + "delta";
    const {runs} = await pdfText(await writePdf({...original, sheets: [{...sheet, cells: [{...sheet.cells[0]!, value: {kind: "string" as const, value}}]}]}, [], context));
    expect(runs.map(run => run.text)).toEqual(["alpha beta", "delta"]);
    const first = runs[0]!;
    expect(first.glyphs[6]!.x - first.glyphs[0]!.x, separator).toBeCloseTo(separator.startsWith("\u2028") ? 49 : 27, 3);
  }
});
it("does not expand Distributed forced lines without wrapping", async () => {
  const original = await fixture("GNM_HALIGN_DISTRIBUTED", 10, 72, "TOP", 60), sheet = original.sheets[0]!;
  const value = "alpha beta\u2028delta";
  const {runs} = await pdfText(await writePdf({...original, sheets: [{...sheet, cells: [{...sheet.cells[0]!, value: {kind: "string" as const, value}}]}]}, [], context));
  expect(runs[0]!.glyphs[6]!.x - runs[0]!.glyphs[0]!.x).toBe(27);
});

it.each(["LEFT", "RIGHT", "CENTER", "JUSTIFY", "DISTRIBUTED"])("uses the full merged-cell box for %s text", async alignment => {
  const original = await fixture(`GNM_HALIGN_${alignment}`, 10, 72, "BOTTOM", 60, 1), sheet = original.sheets[0]!;
  const cells = [{...sheet.cells[0]!, value: {kind: "string" as const, value: "alpha beta gamma delta epsilon"}}];
  const merged = {...original, sheets: [{...sheet, cells, merges: [{startRow: 0, startColumn: 0, endRow: 2, endColumn: 2}]}]};
  const expanded = {...original, sheets: [{...sheet, cells, columns: [{index: 0, sizePoints: 216}], rows: [{index: 0, sizePoints: 180}]}]};
  expect((await pdfText(await writePdf(merged, [], context))).runs).toEqual((await pdfText(await writePdf(expanded, [], context))).runs);
});
it("ignores noncorner merged values without mutating workbook contents", async () => {
  const original = await fixture("GNM_HALIGN_LEFT"), sheet = original.sheets[0]!;
  const merges = [{startRow: 0, startColumn: 0, endRow: 2, endColumn: 2}];
  const book = {...original, sheets: [{...sheet, merges, cells: sheet.cells.slice(0, 3)}]}, before = structuredClone(book);
  expect((await pdfText(await writePdf(book, [], context))).runs.map(run => run.text)).toEqual(["alpha"]);
  expect(book).toEqual(before);
});

it.each(["row", "column"])("does not print a merge whose anchor %s is hidden", async axis => {
  const original = await fixture("GNM_HALIGN_LEFT"), sheet = original.sheets[0]!;
  const book = {...original, sheets: [{...sheet, cells: [sheet.cells[0]!], merges: [{startRow: 0, startColumn: 0, endRow: 2, endColumn: 2}],
    ...(axis === "row" ? {rows: [{index: 0, hidden: true, sizePoints: 20}]} : {columns: [{index: 0, hidden: true, sizePoints: 72}]})}]};
  expect((await pdfText(await writePdf(book, [], context))).runs).toEqual([]);
});

it("prints a hidden-row merge anchor when other cells expose its visible rectangle", async () => {
  const original = await fixture("GNM_HALIGN_LEFT"), sheet = original.sheets[0]!, anchor = sheet.cells[0]!;
  const book = {...original, sheets: [{...sheet, merges: [{startRow: 0, startColumn: 0, endRow: 2, endColumn: 2}],
    rows: [{index: 0, hidden: true, sizePoints: 20}], cells: [anchor,
      {...anchor, row: 1, column: 4, value: {kind: "string" as const, value: "marker"}},
      {...anchor, row: 3, column: 0, value: {kind: "string" as const, value: "lower"}}]}]};
  expect((await pdfText(await writePdf(book, [], context))).runs.map(run => run.text)).toEqual(["alpha", "marker", "lower"]);
});

it.each(["Diagonal", "Rev-Diagonal"])("renders %s border strokes without changing text geometry", async side => {
  const original = await fixture("GNM_HALIGN_LEFT"), sheet = original.sheets[0]!, cell = sheet.cells[0]!;
  const node = cell.style!.gnumeric as {children: readonly unknown[]};
  const draw = vi.spyOn(PDFPage.prototype, "drawLine");
  try {for (let style = 0; style <= 13; style++) {
    draw.mockClear();
    const border = {name: "StyleBorder", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [], children: [{
      name: side, namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [{name: "Style", namespace: "", value: String(style)}, {name: "Color", namespace: "", value: "FFFF:0:0"}], children: []}]};
    const book = {...original, sheets: [{...sheet, cells: [{...cell, style: {gnumeric: {...node, children: [...node.children, border]}} as NonNullable<typeof cell.style>}]}]};
    expect((await pdfText(await writePdf(book, [], context))).runs[0]!.text).toBe("alpha");
    expect(draw).toHaveBeenCalledTimes(style === 0 ? 0 : style === 6 ? 2 : 1);
    if (style === 1) expect(draw).toHaveBeenCalledWith(expect.objectContaining({
      start: {x: 74.5, y: side === "Diagonal" ? 699.5 : 719.5},
      end: {x: 146.5, y: side === "Diagonal" ? 719.5 : 699.5}, thickness: 1
    }));
  }} finally {draw.mockRestore();}
});
it.each([-90, -45, 30, 90])("prints rotated text at %s degrees", async rotation => {
  const book = await fixture("GNM_HALIGN_LEFT",10,72,"BOTTOM",60);
  const cell = book.sheets[0]!.cells[0]!;
  const style = cell.style!.gnumeric as {attributes:{name:string;value:string}[]};
  for (const attribute of style.attributes) if (attribute.name === "Rotation") attribute.value = String(rotation);
  const input = {...book,sheets:[{...book.sheets[0]!,cells:[cell]}]};
  const {pdf,runs}=await pdfText(await writePdf(input,[],context));
  expect(runs.map(run=>run.text)).toEqual(["alpha"]);
  const contents=pdf.getPage(0).node.Contents() as PDFArray;
  const operators=contents.asArray().map(ref=>new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref) as PDFRawStream).decode())).join("\n");
  const matrices = operators.split("\n").filter(line => line.endsWith(" cm")).map(line => line.split(" ").slice(0, 6).map(Number));
  expect(matrices.some(matrix => Math.abs(matrix[0]! - Math.cos(rotation * Math.PI / 180)) < 1e-12 && Math.abs(matrix[1]! - Math.sin(rotation * Math.PI / 180)) < 1e-12)).toBe(true);
});
