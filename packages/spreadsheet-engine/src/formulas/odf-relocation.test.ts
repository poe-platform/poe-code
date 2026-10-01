import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { odfGrammar } from "./conventions.js";
import { rewriteReferences } from "./rewriting.js";
import { localReferenceRange } from "./local-references.js";
import type { ParsePosition } from "./ast.js";

const workbook = { sheets: ["Sheet1", "Sheet2", "Sheet3", "Sheet4"].map((name, index) => ({ id: `s${index}`, name, cells: [] })) };
const origin = { sheet: "s0", row: 0, column: 0 };
function parse(source: string, position: ParsePosition = origin) {
  const result = parseExpression(source, { grammar: odfGrammar, position, workbook });
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.document;
}
function range(source: string, position: ParsePosition) {
  const document = parse(source, position);
  if (document.root.kind !== "reference") throw new Error("Expected reference");
  const resolved = localReferenceRange(workbook, document.root, position)!;
  return { sheets: resolved.sheets.map(sheet => sheet.name), rows: [resolved.firstRow, resolved.lastRow], columns: [resolved.firstColumn, resolved.lastColumn] };
}

it("anchors an implicit sheet on cross-sheet move and emits one range qualifier", () => {
  const destination = { sheet: "s2", row: 4, column: 3 };
  const moved = rewriteReferences(parse("of:=[.A1:.B2]"), { translation: "move", position: destination });
  expect(moved).toBe("of:=[$'Sheet1'.A1:.B2]");
  expect(range(moved, destination)).toEqual({ sheets: ["Sheet1"], rows: [0, 1], columns: [0, 1] });
  const copied = rewriteReferences(parse(moved, destination), { translation: "copy", position: { ...destination, sheet: "s3" } });
  expect(range(copied, { ...destination, sheet: "s3" }).sheets).toEqual(["Sheet1"]);
});

it.each(["Sheet2", "$Sheet2"])("inherits the omitted endpoint scope of %s", sheet => {
  const document = parse(`of:=[${sheet}.A1:.B2]`);
  if (document.root.kind !== "reference") throw new Error("Expected reference");
  expect(document.root.last?.sheet).toBe("Sheet2");
  expect(document.root.last?.sheetRelative).toBe(document.root.first.sheetRelative);
  expect(document.root.last?.sheetOffset).toBe(document.root.first.sheetOffset);
});

it.each(["move", "copy"] as const)("preserves relative range semantics on cross-sheet %s", translation => {
  const destination = { sheet: "s1", row: 1, column: 1 };
  const rewritten = rewriteReferences(parse("of:=[Sheet2.A1:.B2]"), { translation, position: destination });
  expect(range(rewritten, destination)).toEqual(translation === "move"
    ? { sheets: ["Sheet2"], rows: [0, 1], columns: [0, 1] }
    : { sheets: ["Sheet3"], rows: [1, 2], columns: [1, 2] });
});

it("keeps different endpoint sheets when copying a sheet span", () => {
  const destination = { ...origin, sheet: "s1" };
  const copied = rewriteReferences(parse("of:=[Sheet1.A1:Sheet2.B2]"), { translation: "copy", position: destination });
  expect(range(copied, destination).sheets).toEqual(["Sheet2", "Sheet3"]);
});

it("accepts nesting beyond 128 by default and honors an explicit depth budget", () => {
  const source = "of:=" + "(".repeat(150) + "1" + ")".repeat(150);
  expect(parse(source).root.kind).toBe("parentheses");
  expect(() => parseExpression(source, { grammar: odfGrammar, position: origin, maximumDepth: 128 })).toThrow("depth limit");
});

it.each([
  ["of:=SUM([.A1:.B2])", "of:=SUM([$'Sheet1'.A1:.B2])"],
  ["of:=[.A1]", "of:=[$'Sheet1'.A1]"],
  ["of:=['external'#$Sheet2.A1:.B2]", "of:=['external'#$Sheet2.A1:.B2]"]
])("moves %s without changing its cell targets", (source, expected) => {
  expect(rewriteReferences(parse(source!), { translation: "move", position: { sheet: "s2", row: 3, column: 2 } })).toBe(expected);
});
