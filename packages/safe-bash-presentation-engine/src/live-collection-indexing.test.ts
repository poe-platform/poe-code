import { expect, it } from "vitest";
import { chart, IndexError, Shape, parseXmlPart } from "./index.js";

function xml(text: string) {
  return parseXmlPart(new TextEncoder().encode(text), {
    maxBytes: 20000,
    maxNodes: 300,
    maxDepth: 30
  });
}

function model() {
  let part = xml(
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="0"><c:v>Marsh</c:v></c:pt><c:pt idx="1"><c:v>Dune</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:ptCount val="2"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>8</c:v></c:pt></c:numLit></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>'
  );
  return new chart.Chart(
    () => part,
    (next) => {
      part = next;
    }
  );
}

it("requires explicit at for negative positions in every live chart sequence", () => {
  const value = model();
  const plot = value.plots[0]!;
  expect([...plot.categories].map((category) => category.label)).toEqual(["Marsh", "Dune"]);
  expect(value.series[0]!.values).toEqual([3, 8]);
  for (const sequence of [
    value.plots,
    value.series,
    plot.series,
    plot.categories,
    ...plot.categories.levels
  ]) {
    expect(sequence.at(-1).equals(sequence[sequence.length - 1])).toBe(true);
    expect(sequence.at(-sequence.length).equals(sequence[0])).toBe(true);
    for (const index of [-1, -sequence.length, -sequence.length - 1])
      expect(() => sequence[index]).toThrow(IndexError);
    for (const index of [sequence.length, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => sequence[index]).toThrow(IndexError);
      expect(() => sequence.at(index)).toThrow(IndexError);
    }
  }
  const points = value.series[0]!.points;
  expect(points.length).toBe(2);
  expect(() => points[-1]).toThrow(IndexError);
  expect(() => points.at(-1)).toThrow(IndexError);
  expect(value.plots.slice(-1)[0]!.chart).toBe(value);
});

it("requires explicit at for negative gradient stop positions while preserving live edits", () => {
  const shape = new Shape(
    xml(
      '<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="123456"/></a:gs><a:gs pos="100000"><a:srgbClr val="ABCDEF"/></a:gs></a:gsLst></a:gradFill></p:spPr></p:sp>'
    )
  );
  const stops = shape.fill.gradient_stops;
  expect([...stops].map((stop) => stop.position)).toEqual([0, 1]);
  expect(stops.at(-1)).toBe(stops[1]);
  expect(stops.at(-2)).toBe(stops[0]);
  for (const index of [-1, -2, -3, 2, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => stops[index]).toThrow(IndexError);
  stops.at(-1).position = 0.75;
  expect(stops[1]!.position).toBe(0.75);
});
