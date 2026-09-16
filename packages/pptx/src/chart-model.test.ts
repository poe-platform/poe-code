import { expect, it } from "vitest";
import { Chart } from "./chart-model.js";
import { XL_CHART_TYPE } from "./chart-enums.js";
import { InvalidHandleError } from "./errors.js";
import { parseXmlPart } from "./xml.js";
function chart(plot = '<c:barChart><c:barDir val="col"/><c:grouping val="stacked"/></c:barChart>') {
  let xml = parseXmlPart(
    new TextEncoder().encode(
      `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:date1904 val="1"/><c:chart><c:plotArea>${plot}</c:plotArea><c:plotVisOnly val="1"/></c:chart><c:extLst/></c:chartSpace>`
    ),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 16 }
  );
  let live = true;
  const model = new Chart(
    () => {
      if (!live) throw new InvalidHandleError();
      return xml;
    },
    (next) => {
      xml = next;
    }
  );
  return {
    model,
    xml: () => xml,
    invalidate: () => {
      live = false;
    }
  };
}
it("reads first plot type through the chart classification engine", () => {
  expect(chart().model.chart_type).toBe(XL_CHART_TYPE.COLUMN_STACKED);
  expect(
    chart(
      '<c:pieChart><c:ser><c:idx val="0"/><c:order val="0"/><c:explosion val="12"/></c:ser></c:pieChart>'
    ).model.chart_type
  ).toBe(XL_CHART_TYPE.PIE_EXPLODED);
  expect(
    chart(
      '<c:doughnutChart><c:ser><c:idx val="0"/><c:order val="0"/><c:explosion val="5"/></c:ser></c:doughnutChart>'
    ).model.chart_type
  ).toBe(XL_CHART_TYPE.DOUGHNUT_EXPLODED);
});
it("sets and clears style and legend live while preserving other chart data", () => {
  const { model, xml } = chart();
  expect(model.chart_style).toBeNull();
  expect(model.has_legend).toBe(false);
  model.chart_style = 17;
  model.has_legend = true;
  expect(model.chart_style).toBe(17);
  expect(model.has_legend).toBe(true);
  const withLegend = xml().bytes();
  model.has_legend = true;
  expect(xml().bytes()).toEqual(withLegend);
  model.chart_style = null;
  model.has_legend = false;
  expect(model.chart_style).toBeNull();
  expect(model.has_legend).toBe(false);
  expect(xml().markup(xml().root)).toContain('<c:date1904 val="1"/>');
  expect(xml().markup(xml().root)).toContain('<c:plotVisOnly val="1"/>');
});
it("rejects invalid values and propagates invalidated chart ownership", () => {
  const { model, xml, invalidate } = chart();
  const before = xml().bytes();
  expect(() => {
    model.chart_style = 49;
  }).toThrow();
  expect(() => {
    model.has_legend = 1 as unknown as boolean;
  }).toThrow();
  expect(() => {
    model.chart_style = undefined as unknown as number;
  }).toThrow();
  expect(() => {
    model.has_legend = undefined as unknown as boolean;
  }).toThrow();
  expect(xml().bytes()).toEqual(before);
  const element = model.element;
  expect(element.tag.localName).toBe("chartSpace");
  model.chart_style = 3;
  expect(() => element.tag).toThrow(InvalidHandleError);
  invalidate();
  expect(() => model.chart_type).toThrow(InvalidHandleError);
  expect(() => model.chart_style).toThrow(InvalidHandleError);
  expect(() => model.has_legend).toThrow(InvalidHandleError);
  expect(() => model.element).toThrow(InvalidHandleError);
});
it("keeps XML owner authority private at runtime", () => {
  const { model } = chart();
  expect(Object.keys(model)).toEqual([]);
  expect("read" in model).toBe(false);
  expect("write" in model).toBe(false);
});
