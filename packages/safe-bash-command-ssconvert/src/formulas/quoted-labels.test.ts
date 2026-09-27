import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { gnumericGrammar, odfGrammar } from "./conventions.js";
import { serializeExpression } from "./serialization.js";
import { rewriteReferences } from "./rewriting.js";
import { recalculateWorkbook } from "./evaluator.js";
import type { Cell, LabelRange, Workbook } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";

const position = { sheet: "s", row: 2, column: 2 };
const pair = (axis: "row" | "column", row = 0, column = 0): LabelRange => ({ axis,
  labels: { startRow: row, endRow: row, startColumn: column, endColumn: column },
  data: axis === "column" ? { startRow: 1, endRow: 4, startColumn: column, endColumn: column } :
    { startRow: row, endRow: row, startColumn: 1, endColumn: 4 } });
const label = (row = 0, column = 0, value = "Sales"): Cell => ({ row, column, value: { kind: "string", value } });
const book = (): Workbook => ({ automaticLabelLookup: false, sheets: [{ id: "s", name: "Sheet", cells: [label()], labelRanges: [pair("column")] }] });
function parsed(source: string, workbook = book()) {
  const result = parseExpression(source, { position, workbook, grammar: odfGrammar });
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.document;
}

it("binds a native quoted label to a cell with Calc's orientation-dependent relativity", () => {
  const document = parsed("of:='Sales'");
  expect(document.root).toMatchObject({ kind: "reference", label: { axis: "column", quoted: true, scalar: true },
    first: { row: { value: 0, relative: false }, column: { value: -2, relative: true } } });
  expect(serializeExpression(document, gnumericGrammar, false)).toBe("=@column.odf.quoted:A$1");
});

it("prefers this sheet's row declaration over another sheet's column declaration", () => {
  const workbook = book();
  const document = parsed("='Sales'", { ...workbook, sheets: [
    { id: "other", name: "Other", cells: [label()], labelRanges: [pair("column")] },
    { ...workbook.sheets[0]!, labelRanges: [pair("row")] }
  ] });
  expect(document.root).toMatchObject({ label: { axis: "row" }, first: {
    row: { value: -2, relative: true }, column: { value: 0, relative: false } } });
});

it("searches column declarations before rows and retains declaration order", () => {
  const workbook = book();
  const document = parsed("='Sales'", { ...workbook, sheets: [{ ...workbook.sheets[0]!,
    cells: [label(), label(0, 1), label(0, 3)], labelRanges: [pair("row"), pair("column", 0, 3), pair("column", 0, 1)]
  }] });
  expect(document.root).toMatchObject({ label: { axis: "column" }, first: { column: { value: 1, relative: true } } });
});

it("searches each declared area in column-major order without depending on cell storage order", () => {
  const workbook = book(), declaration = pair("column");
  const document = parsed("='Sales'", { ...workbook, sheets: [{ ...workbook.sheets[0]!,
    cells: [label(0, 1), label(2, 0), label(1, 0)],
    labelRanges: [{ ...declaration, labels: { ...declaration.labels, endRow: 2, endColumn: 1 } }]
  }] });
  expect(document.root).toMatchObject({ first: { row: { value: 1, relative: false }, column: { value: -2, relative: true } } });
});

it("captures a remote label's sheet name and decodes doubled apostrophes", () => {
  const workbook = book();
  const document = parsed("=SUM('Owner''s sales')", { ...workbook, sheets: [{ ...workbook.sheets[0]!, labelRanges: [] },
    { id: "remote-id", name: "O'Brien", cells: [label(0, 0, "Owner's sales")], labelRanges: [pair("column")] }
  ] });
  expect(document.root).toMatchObject({ args: [{ label: { scalar: false }, first: { sheet: "O'Brien" } }] });
  expect(serializeExpression(document, gnumericGrammar, false)).toBe("=SUM(@column.odf.quoted:'O\\'Brien'!A$1)");
});

it("allows a cached textual formula result as a label, excluding the formula being bound", () => {
  const workbook = book();
  const cells = [{ ...label(), formula: '=CONCAT("Sa";"les")' }, { ...label(2, 2), formula: "='Sales'" }];
  const document = parsed("='Sales'", { ...workbook, sheets: [{ ...workbook.sheets[0]!, cells,
    labelRanges: [pair("column", 2, 2), pair("column")]
  }] });
  expect(document.root).toMatchObject({ first: { row: { value: 0, relative: false } } });
});

it.each(["='Sales'", "=SUM('Sales')", "=1+'Sales'", "=SUM('Sales'+1)"])("preserves selection when lowering %s to internal syntax", source => {
  const document = parsed(source);
  const lowered = serializeExpression(document, gnumericGrammar, false);
  const again = parseExpression(lowered, { position, workbook: book() });
  expect(again.ok).toBe(true);
  if (!again.ok) return;
  const mode = (node: typeof document.root): unknown => node.kind === "reference" ? node.label?.scalar :
    node.kind === "binary" ? [mode(node.left), mode(node.right)] : node.kind === "call" ? node.args.map(mode) : undefined;
  expect(mode(again.document.root)).toEqual(mode(document.root));
});

it("preserves the captured identity through text edits and copy/move after lowering", () => {
  const source = serializeExpression(parsed("=SUM('Sales')"), gnumericGrammar, false);
  const document = parseExpression(source, { position, workbook: book() });
  if (!document.ok) throw new Error("Expected internal label");
  expect(rewriteReferences(document.document, { translation: "copy", position: { ...position, column: 3 } })).toBe("=SUM(@column.odf.quoted:B$1)");
  expect(rewriteReferences(document.document, { translation: "move", position: { ...position, column: 3 } })).toBe("=SUM(@column.odf.quoted:A$1)");
  const workbook = book(), sheet = workbook.sheets[0]!;
  const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 10000 } };
  const changed: Workbook = { ...workbook, sheets: [{ ...sheet, cells: [label(0, 0, "Renamed"), label(0, 1),
    { row: 1, column: 0, value: { kind: "number", value: 2 } },
    { row: 4, column: 0, value: { kind: "number", value: 3 } },
    { row: 2, column: 2, formula: source, formulaDirty: true, value: { kind: "number", value: 999 } }
  ] }] };
  expect(recalculateWorkbook(changed, context, true).sheets[0]!.cells.at(-1)!.value).toEqual({ kind: "number", value: 5 });
});

it("keeps ordinary Gnumeric single quotes and native ODF qualified references distinct", () => {
  expect(parseExpression("='Sales'", { position, workbook: book() })).toMatchObject({ ok: true, document: {
    root: { kind: "literal", value: { kind: "string", value: "Sales" } } } });
  expect(parsed("=['Sheet'.A1]").root).toMatchObject({ kind: "reference", first: { sheet: "Sheet" } });
  expect(parsed("=['Sheet'.A1]").root).not.toHaveProperty("label");
});

it("bounds declared-label lookup and preserves exact cancellation", () => {
  expect(() => parseExpression("='Sales'", { position, workbook: book(), grammar: odfGrammar, maximumNodes: 1 }))
    .toThrow("limit");
  const controller = new AbortController(), reason = new Error("cancel lookup"); controller.abort(reason);
  expect(() => parseExpression("='Sales'", { position, workbook: book(), grammar: odfGrammar, signal: controller.signal })).toThrow(reason);
});

it("charges sparse label candidates to the caller and observes cancellation during lookup", () => {
  const controller = new AbortController(), reason = new Error("cancel during lookup");
  let work = 0;
  expect(() => parseExpression("='Sales'", { position, workbook: book(), grammar: odfGrammar,
    signal: controller.signal, onWork() { if (++work === 2) controller.abort(reason); } })).toThrow(reason);
  expect(work).toBe(2);
});
