import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import { parseExpression } from "./parser.js";
import { rewriteReferences } from "./rewriting.js";
import { dirtyWorkbook } from "../workbook/updates/recalculation.js";
import { createOdfWriter, readOdf } from "../codecs/odf.js";
import type { Cell, Workbook } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 10000 } };
type Axis = "row" | "column";
const coordinate = (axis: Axis, value: number) => axis === "column" ? { row: value, column: 0 } : { row: 0, column: value };
function fixture(axis: Axis, own: number, values: readonly (readonly [number, number])[], formula = "of:=SUM('Sales')", label = 0): Workbook {
  const cells: Cell[] = [
    { ...coordinate(axis, label), value: { kind: "string", value: "Sales" } },
    ...values.map(([at, value]): Cell => ({ ...coordinate(axis, at), value: { kind: "number", value } })),
    { ...coordinate(axis, own), formula, formulaDirty: true, value: { kind: "number", value: 999 } }
  ];
  // OpenFormula infers a row label from adjacent vertical text.
  if (axis === "row") cells.push({ row: 1, column: label, value: { kind: "string", value: "Other" } });
  return { automaticLabelLookup: true, sheets: [{ id: "s", name: "Sheet", size: { rows: 256, columns: 256 }, cells }] };
}
const result = (book: Workbook) => recalculateWorkbook(book, context, true).sheets[0]!.cells.find(cell => cell.formula)!.value;

for (const axis of ["row", "column"] as const) {
  it.each([
    { title: "below data", own: 3, values: [[1, 10], [2, 20]], expected: 30 },
    { title: "above data", own: 1, values: [[2, 10], [3, 20]], expected: 30 },
    { title: "between data", own: 2, values: [[1, 10], [3, 20]], expected: 10 },
    { title: "after the initial blank", own: 2, values: [[3, 20]], expected: 0 },
    { title: "after a data gap", own: 5, values: [[1, 10], [3, 20], [4, 30]], expected: 10 },
    { title: "after one initial blank", own: 4, values: [[2, 10], [3, 20]], expected: 30 },
    { title: "after two initial blanks", own: 5, values: [[3, 10], [4, 20]], expected: 0 },
    { title: "above empty data", own: 1, values: [], expected: 0 }
  ] as const)(`excludes the ${axis} total $title without crossing a gap`, ({ own, values, expected }) => {
    const book = fixture(axis, own, values);
    expect(result(book)).toEqual({ kind: "number", value: expected });
    expect(book.sheets[0]!.cells.find(cell => cell.formula)!.value).toEqual({ kind: "number", value: 999 });
  });

  for (const own of [1, 3]) it.each(["of:='Sales'+10", "of:=ABS('Sales')", "of:=ABS(('Sales'))"])(
    `rejects the ${axis} scalar self-reference at ${own}: %s`, formula => {
      expect(result(fixture(axis, own, own === 1 ? [[2, 10], [3, 20]] : [[1, 10], [2, 20]], formula)))
        .toEqual({ kind: "error", value: "#REF!" });
    });

  it(`does not clamp an excluded ${axis} formula back onto the final grid cell`, () => {
    expect(result(fixture(axis, 255, [], "of:=SUM('Sales')", 254))).toEqual({ kind: "error", value: "#REF!" });
  });

  it(`keeps ${axis} data below a label that is beyond the formula`, () => {
    expect(result(fixture(axis, 0, [[2, 10], [3, 20]], "of:=SUM('Sales')", 1))).toEqual({ kind: "number", value: 30 });
  });

  it(`updates ${axis} totals after data edits without reading their prior result`, () => {
    const clean = recalculateWorkbook(fixture(axis, 3, [[1, 10], [2, 20]]), context, true);
    const point = coordinate(axis, 1), changed: Workbook = { ...clean, sheets: clean.sheets.map(sheet => ({ ...sheet,
      cells: sheet.cells.map(cell => cell.row === point.row && cell.column === point.column ?
        { ...cell, value: { kind: "number", value: 15 } } : cell)
    })) };
    const dirty = dirtyWorkbook(changed, [{ sheet: "s", startRow: point.row, endRow: point.row, startColumn: point.column, endColumn: point.column }], context);
    expect(dirty.sheets[0]!.cells.find(cell => cell.formula)!.formulaDirty).toBe(true);
    expect(recalculateWorkbook(dirty, context, { force: false, queueVolatile: false }).sheets[0]!.cells.find(cell => cell.formula)!.value)
      .toEqual({ kind: "number", value: 35 });
  });

  it.each(["strict", "extended"] as const)(`preserves the ${axis} exclusion after %s ODF transport`, async profile => {
    for (const own of [1, 3]) {
      const book = fixture(axis, own, own === 1 ? [[2, 10], [3, 20]] : [[1, 10], [2, 20]]);
      const reopened = await readOdf(await createOdfWriter(profile)(book, [], context), context);
      expect(reopened.automaticLabelLookup).toBe(true);
      expect(reopened.sheets[0]!.cells.find(cell => cell.formula)!.formula).toContain(`@${axis}.odf.quoted:`);
      expect(result(reopened)).toEqual({ kind: "number", value: 30 });
    }
  });
}

it("recomputes exclusion when a formula moves into its label column", () => {
  const source = "=SUM(@column.odf.quoted:A$1)", input = fixture("column", 3, [[1, 10], [2, 20]], source);
  const movedFrom: Workbook = { ...input, sheets: input.sheets.map(sheet => ({ ...sheet,
    cells: sheet.cells.map(cell => cell.formula ? { ...cell, column: 1 } : cell)
  })) };
  const parsed = parseExpression(source, { workbook: movedFrom, position: { sheet: "s", row: 3, column: 1 } });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  const formula = rewriteReferences(parsed.document, { translation: "move", position: { sheet: "s", row: 3, column: 0 } });
  const moved: Workbook = { ...movedFrom, sheets: movedFrom.sheets.map(sheet => ({ ...sheet,
    cells: sheet.cells.map(cell => cell.formula ? { ...cell, column: 0, formula } : cell)
  })) };
  expect(result(moved)).toEqual({ kind: "number", value: 30 });
});
