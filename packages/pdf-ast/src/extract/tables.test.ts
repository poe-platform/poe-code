import { expect, it } from "vitest";
import type { PdfPlacedGlyph } from "../ast.js";
import { extractTablesFromDisplayList } from "./tables.js";

it("extracts table bounds when a cell exceeds the JavaScript argument limit", () => {
  const glyph = (unicode: string, x: number, y: number): PdfPlacedGlyph => ({ unicode, charCode: 65, bbox: [x, y, x + 5, y + 10], baselineY: y, advanceWidth: 5, matrix: [1, 0, 0, 1, x, y], fontSize: 10, fontName: "Helvetica", color: { r: 0, g: 0, b: 0 } });
  const glyphs = Array<PdfPlacedGlyph>(1100000).fill(glyph("a", 0, 80));
  glyphs.push(glyph("B", 100, 80), glyph("C", 0, 60), glyph("D", 100, 60));
  const tables = extractTablesFromDisplayList({ pageIndex: 0, width: 612, height: 792, glyphs, paths: [], images: [], rotation: 0, annotations: [] });
  expect(tables).toHaveLength(1);
  expect(tables[0]!.bbox).toEqual([0, 60, 105, 90]);
  expect(tables[0]!.headers).toEqual(["a".repeat(1100000), "B"]);
  expect(tables[0]!.rows).toEqual([["C", "D"]]);
});
