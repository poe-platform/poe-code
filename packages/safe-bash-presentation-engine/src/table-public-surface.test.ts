import { expect, it } from "vitest";
import { InvalidHandleError } from "./errors.js";
import { Table } from "./tables-model.js";
import { FillFormat } from "./shapes.js";
import { RGBColor } from "./text-run-color.js";
import { createTableXml } from "./tables.js";
import { parseXmlPart } from "./xml.js";
import { Length } from "./length.js";

function fixture() {
  return new Table(
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
}

it("compares live cell identity by table owner and coordinates", () => {
  const table = fixture(),
    cell = table.cell(0, 0);
  expect(cell.equals(table.rows[0]!.cells[0])).toBe(true);
  expect(cell.equals(table.cell(0, 1))).toBe(false);
  expect(cell.equals(fixture().cell(0, 0))).toBe(false);
  expect(cell.equals(null)).toBe(false);
  cell.text = "Bay";
  expect(cell.equals(table.cell(0, 0))).toBe(true);
  table.structure({ kind: "merge", from: { row: 0, column: 0 }, to: { row: 1, column: 1 } });
  expect(cell.equals(table.cell(1, 1))).toBe(false);
});

it("returns the existing fill model and keeps its edits live within one cell", () => {
  const table = fixture(),
    cell = table.cell(0, 1),
    fill = cell.fill;
  expect(fill).toBeInstanceOf(FillFormat);
  expect(fill.type).toBe(null);
  fill.solid();
  fill.fore_color.rgb = RGBColor.from_string("336699");
  cell.text = "Harbor";
  expect(fill.fore_color.rgb.toString()).toBe("336699");
  expect(table.cell(0, 1).fill.fore_color.rgb.toString()).toBe("336699");
  expect(table.cell(0, 0).fill.type).toBe(null);
  fill.gradient();
  fill.gradient_angle = 35;
  fill.gradient_stops.at(0).color.rgb = RGBColor.from_string("112233");
  expect(cell.fill.gradient_angle).toBe(35);
  expect(cell.fill.gradient_stops.at(0).color.rgb.toString()).toBe("112233");
  fill.background();
  expect(cell.fill.type).toBe(5);
});

it("invalidates retained fill and equality handles after structural edits", () => {
  const table = fixture(),
    cell = table.cell(0, 0),
    fill = cell.fill;
  table.structure({ kind: "rows-add", position: 0, spanPolicy: "reject" });
  expect(() => fill.type).toThrow(InvalidHandleError);
  expect(() => fill.solid()).toThrow(InvalidHandleError);
  expect(() => cell.equals(table.cell(0, 0))).toThrow(InvalidHandleError);
});

it("creates cell properties only when fill is accessed and preserves neighboring XML", () => {
  const original = fixture().xml;
  const graphic = original.root.children.find((n) => n.name.localName === "graphic")!;
  const tbl = graphic.children[0]!.children[0]!;
  const cell = tbl.children.find((n) => n.name.localName === "tr")!.children[0]!;
  const pr = cell.children.find((n) => n.name.localName === "tcPr")!;
  const missing = original.spliceChildren(cell, cell.children.indexOf(pr), 1, []);
  const table = new Table(missing);
  expect(table.cell(0, 0).text).toBe("");
  expect(table.xml.bytes()).toEqual(missing.bytes());
  const fill = table.cell(0, 0).fill;
  expect(fill.type).toBe(null);
  expect(table.xml.bytes()).not.toEqual(missing.bytes());
  const created = table.xml.bytes();
  expect(table.cell(0, 0).fill.type).toBe(null);
  expect(table.xml.bytes()).toEqual(created);
  fill.patterned();
  expect(fill.fore_color.rgb.toString()).toBe("000000");
  expect(fill.back_color.rgb.toString()).toBe("FFFFFF");
  expect(table.cell(0, 1).fill.type).toBe(null);
});

it("rejects fill changes through a locked table without changing bytes", () => {
  const original = fixture().xml;
  const nv = original.root.children[0]!.children[1]!;
  const locked = original.spliceChildren(nv, 0, 0, [
    '<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noSelect="1"/>'
  ]);
  const table = new Table(locked),
    fill = table.cell(0, 0).fill;
  expect(fill.type).toBe(null);
  expect(() => fill.solid()).toThrow("locked");
  expect(() => fill.patterned()).toThrow("locked");
  expect(table.xml.bytes()).toEqual(locked.bytes());
});

it("owns one live cell frame and invalidates descendants on whole-cell text assignment", () => {
  const cell = fixture().cell(0, 0),
    frame = cell.text_frame;
  const paragraph = frame.paragraphs[0]!;
  const run = paragraph.add_run();
  run.text = "Before";
  expect(cell.text_frame).toBe(frame);
  expect(frame.parent).toBe(cell);
  cell.text = "After";
  expect(cell.text_frame).toBe(frame);
  expect(frame.text).toBe("After");
  expect(() => paragraph.text).toThrow(InvalidHandleError);
  expect(() => run.text).toThrow(InvalidHandleError);
});
it("retains admitted XML limits in the cell frame view", () => {
  const table = fixture();
  const xml = table.cell(0, 0).text_frame.xml;
  expect(() =>
    xml.spliceChildren(xml.root, xml.root.children.length, 0, [
      `<p xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><r><t>${"x".repeat(100000)}</t></r></p>`
    ])
  ).toThrow(expect.objectContaining({ code: "resource-limit" }));
});
