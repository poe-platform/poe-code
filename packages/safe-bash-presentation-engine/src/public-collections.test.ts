import { expect, it } from "vitest";
import { Table } from "./tables-model.js";
import { createTableXml } from "./tables.js";
import { Shape } from "./shapes.js";
import { Length } from "./length.js";
import { parseXmlPart } from "./xml.js";

const xml = (source: string) =>
  parseXmlPart(new TextEncoder().encode(source), {
    maxBytes: 20000,
    maxNodes: 200,
    maxDepth: 30
  });
const table = () =>
  new Table(
    xml(
      createTableXml(9, {
        rows: 2,
        columns: 3,
        left: new Length(0),
        top: new Length(0),
        width: new Length(900),
        height: new Length(600)
      })
    )
  );
const gradient = () =>
  new Shape(
    xml(
      '<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="40000"><a:srgbClr val="123456"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst></a:gradFill></p:spPr></p:sp>'
    )
  ).fill.gradient_stops;

it("provides table at lookup, strict bounds, traversal and live values", () => {
  const model = table();
  for (const collection of [model.rows, model.columns, model.rows[0]!.cells]) {
    expect([...collection]).toHaveLength(collection.length);
    expect(collection.at(0)).toBeDefined();
    for (const index of [-1, collection.length, 0.5, NaN, Infinity]) {
      expect(() => collection.at(index)).toThrowError(
        expect.objectContaining({ code: "index-out-of-range" })
      );
      expect(() => collection[index]).toThrowError(
        expect.objectContaining({ code: "index-out-of-range" })
      );
    }
    expect("slice" in collection).toBe(false);
    expect(() => Reflect.set(collection, "0", collection[0])).toThrow();
    expect(() => Object.defineProperty(collection, "0", { value: collection[0] })).toThrow();
    expect(() => Reflect.deleteProperty(collection, "0")).toThrow();
  }
  model.rows.at(1).cells.at(2).text = "live";
  expect(model.cell(1, 2).text).toBe("live");
  expect([...model.iter_cells()].map((cell) => cell.text)).toEqual(["", "", "", "", "", "live"]);
});

it("provides checked gradient numeric lookup and inherited bounded index", () => {
  const stops = gradient();
  expect(stops.length).toBe(3);
  expect(stops[0]).toBe(stops.at(0));
  expect(stops.at(-1)).toBe(stops[2]);
  expect([...stops].map((stop) => stop.position)).toEqual([0, 0.4, 1]);
  expect(stops.reversed().map((stop) => stop.position)).toEqual([1, 0.4, 0]);
  expect(stops.includes(stops.at(1))).toBe(true);
  expect(stops.count(stops.at(1))).toBe(1);
  expect(stops.count(gradient().at(1))).toBe(0);
  expect(stops.index(stops.at(1), -2, -1)).toBe(1);
  expect(() => stops.index(stops.at(1), 2)).toThrow();
  expect(() => stops.index(stops.at(1), 0, 1)).toThrow();
  for (const index of [-4, 3, 0.5, NaN, Infinity])
    expect(() => stops[index]).toThrowError(
      expect.objectContaining({ code: "index-out-of-range" })
    );
  expect("slice" in stops).toBe(false);
  expect(() => Reflect.set(stops, "0", stops.at(2))).toThrow();
  expect(() => Object.defineProperty(stops, "0", { value: stops.at(2) })).toThrow();
  expect(() => Reflect.deleteProperty(stops, "0")).toThrow();
  stops[0]!.position = 0.2;
  expect(stops.at(0).position).toBe(0.2);
});
