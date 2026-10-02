import { expect, it } from "vitest";
import { Table } from "./tables-model.js";
import { createTableXml } from "./tables.js";
import { parseXmlPart } from "./xml.js";
import { Length } from "./length.js";
const fixture = () =>
  new Table(
    parseXmlPart(
      new TextEncoder().encode(
        createTableXml(7, {
          rows: 2,
          columns: 2,
          left: new Length(0),
          top: new Length(0),
          width: new Length(100),
          height: new Length(60)
        })
      ),
      { maxBytes: 100000, maxNodes: 1000, maxDepth: 30 }
    )
  );
it("keeps retained cell and collection handles live through edits", () => {
  const table = fixture(),
    cell = table.cell(1, 1),
    row = table.rows.get(1);
  cell.text = "first";
  row.height = new Length(90);
  cell.text = "second";
  expect(table.cell(1, 1).text).toBe("second");
  expect(table.rows.get(1).height.emu).toBe(90);
  expect(table.columns.length).toBe(2);
  expect([...table.iter_cells()].map((c) => c.text)).toEqual(["", "", "", "second"]);
});
it("uses defaults for absent margins and clears local overrides", () => {
  const cell = fixture().cell(0, 0);
  expect(cell.margin_left.emu).toBe(91440);
  expect(cell.margin_top.emu).toBe(45720);
  cell.margin_left = new Length(0);
  expect(cell.margin_left.emu).toBe(0);
  cell.margin_left = null;
  expect(cell.margin_left.emu).toBe(91440);
});
it("rejects negative, fractional and missing collection positions", () => {
  const table = fixture();
  for (const i of [-1, 0.5, 2]) {
    expect(() => table.rows.get(i)).toThrow();
    expect(() => table.columns.get(i)).toThrow();
    expect(() => table.rows.get(0).cells.get(i)).toThrow();
  }
});
it("assigns neutral table style switches and cell text frames", () => {
  const table = fixture(),
    cell = table.cell(0, 0);
  table.first_row = true;
  table.horz_banding = true;
  expect(table.first_row).toBe(true);
  expect(table.horz_banding).toBe(true);
  cell.text_frame.text = "frame";
  expect(cell.text).toBe("frame");
});
it("rejects text frame writes through a locked table", () => {
  const original = fixture().xml,
    nv = original.root.children[0]!.children[1]!;
  const locked = original.spliceChildren(nv, 0, 0, [
    '<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noSelect="1"/>'
  ]);
  const table = new Table(locked),
    frame = table.cell(0, 0).text_frame;
  expect(() => {
    frame.text = "forbidden";
  }).toThrow("locked");
  expect(table.xml.bytes()).toEqual(locked.bytes());
});
it("exposes numeric row, column and cell lookup with strict bounds", () => {
  const table = fixture();
  table.rows[1]!.height = new Length(27);
  table.columns[0]!.width = new Length(33);
  table.rows[1]!.cells[0]!.text = "indexed";
  expect(table.cell(1, 0).text).toBe("indexed");
  expect(table.rows[1]!.height.emu).toBe(27);
  expect(table.columns[0]!.width.emu).toBe(33);
  for (const collection of [table.rows, table.columns, table.rows[0]!.cells])
    for (const index of [-1, 0.5, 2]) expect(() => collection[index]).toThrow();
});
