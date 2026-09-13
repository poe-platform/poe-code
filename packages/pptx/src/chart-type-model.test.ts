import { expect, it } from "vitest";
import { XL_CHART_TYPE } from "./chart-enums.js";
import { readModelChartType } from "./chart-type-model.js";
import { parseXmlPart } from "./xml.js";

const examples: Record<string, string> = {};
const element = (tag: string, body = "") => `<c:${tag}>${body}</c:${tag}>`;
const value = (tag: string, v: string) => `<c:${tag} val="${v}"/>`;
for (const [group, suffix] of [
  ["standard", ""],
  ["stacked", "_STACKED"],
  ["percentStacked", "_STACKED_100"]
]) {
  examples[`AREA${suffix}`] = element("areaChart", value("grouping", group!));
  examples[`THREE_D_AREA${suffix}`] = element("area3DChart", value("grouping", group!));
  for (const markers of [false, true])
    examples[`LINE${markers ? "_MARKERS" : ""}${suffix}`] = element(
      "lineChart",
      value("grouping", group!) + value("marker", markers ? "1" : "0")
    );
}
for (const [direction, plain] of [
  ["bar", "BAR"],
  ["col", "COLUMN"]
]) {
  for (const [group, suffix] of [
    ["clustered", "_CLUSTERED"],
    ["stacked", "_STACKED"],
    ["percentStacked", "_STACKED_100"],
    ["standard", ""]
  ]) {
    if (group !== "standard")
      examples[`${plain}${suffix}`] = element(
        "barChart",
        value("barDir", direction!) + value("grouping", group!)
      );
    if (group === "standard" && direction === "bar") continue;
    for (const shape of ["box", "cone", "cylinder", "pyramid"]) {
      const prefix =
        shape === "box"
          ? `THREE_D_${plain}`
          : `${shape.toUpperCase()}_${direction === "bar" ? "BAR" : "COL"}`;
      examples[`${prefix}${suffix}`] = element(
        "bar3DChart",
        value("barDir", direction!) + value("grouping", group!) + value("shape", shape)
      );
    }
  }
}
for (const [tag, name] of [
  ["pieChart", "PIE"],
  ["pie3DChart", "THREE_D_PIE"],
  ["doughnutChart", "DOUGHNUT"]
])
  for (const exploded of [false, true])
    examples[`${name}${exploded ? "_EXPLODED" : ""}`] = element(
      tag!,
      element("ser", value("explosion", exploded ? "15" : "0"))
    );
examples.THREE_D_LINE = element("line3DChart");
examples.BAR_OF_PIE = element("ofPieChart", value("ofPieType", "bar"));
examples.PIE_OF_PIE = element("ofPieChart", value("ofPieType", "pie"));
examples.BUBBLE = element("bubbleChart", value("bubble3D", "0"));
examples.BUBBLE_THREE_D_EFFECT = element("bubbleChart", value("bubble3D", "1"));
for (const [style, name] of [
  ["standard", "RADAR"],
  ["marker", "RADAR_MARKERS"],
  ["filled", "RADAR_FILLED"]
])
  examples[name!] = element("radarChart", value("radarStyle", style!));
for (const [style, name] of [
  ["marker", "XY_SCATTER"],
  ["lineMarker", "XY_SCATTER_LINES"],
  ["line", "XY_SCATTER_LINES_NO_MARKERS"],
  ["smoothMarker", "XY_SCATTER_SMOOTH"],
  ["smooth", "XY_SCATTER_SMOOTH_NO_MARKERS"]
])
  examples[name!] = element("scatterChart", value("scatterStyle", style!));
for (const top of [false, true])
  for (const wire of [false, true])
    examples[`SURFACE${top ? "_TOP_VIEW" : ""}${wire ? "_WIREFRAME" : ""}`] = element(
      top ? "surfaceChart" : "surface3DChart",
      value("wireframe", wire ? "1" : "0")
    );
for (const volume of [false, true])
  for (const open of [false, true])
    examples[`STOCK_${volume ? "V" : ""}${open ? "O" : ""}HLC`] =
      (volume ? element("barChart", value("barDir", "col") + element("ser")) : "") +
      element("stockChart", element("ser").repeat(open ? 4 : 3));
function document(body: string, strict = false) {
  const ns = strict
    ? "http://purl.oclc.org/ooxml/drawingml/chart"
    : "http://schemas.openxmlformats.org/drawingml/2006/chart";
  return parseXmlPart(
    new TextEncoder().encode(
      `<c:chartSpace xmlns:c="${ns}"><c:chart><c:plotArea>${body}</c:plotArea></c:chart></c:chartSpace>`
    ),
    { maxBytes: 20000, maxNodes: 500, maxDepth: 30 }
  );
}
it("enumerates every public chart variant", () => {
  expect(Object.keys(examples).sort()).toEqual(
    Object.entries(XL_CHART_TYPE)
      .filter(([, v]) => typeof v === "number")
      .map(([key]) => key)
      .sort()
  );
});
it.each(Object.entries(examples))(
  "classifies imported %s in both XML dialects without mutations",
  (name, markup) => {
    for (const strict of [false, true]) {
      const xml = document(markup, strict),
        before = xml.bytes();
      expect(readModelChartType(xml)).toBe(XL_CHART_TYPE[name as keyof typeof XL_CHART_TYPE]);
      expect(xml.bytes()).toEqual(before);
    }
  }
);
it.each([
  "<c:stockChart><c:ser/></c:stockChart>",
  '<c:bar3DChart><c:barDir val="col"/><c:shape val="alien"/></c:bar3DChart>',
  '<c:scatterChart><c:scatterStyle val="alien"/></c:scatterChart>',
  "<c:pieChart/><c:pieChart/>"
])("rejects ambiguous or unsupported imported structure %s", (body) => {
  if (body === "<c:pieChart/><c:pieChart/>")
    expect(readModelChartType(document(body))).toBe(XL_CHART_TYPE.PIE);
  else expect(() => readModelChartType(document(body))).toThrow();
});

it("honors first-series shape, marker and bubble overrides without flattening later series", () => {
  expect(
    readModelChartType(
      document(
        '<c:bar3DChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:shape val="coneToMax"/></c:ser><c:shape val="box"/></c:bar3DChart>'
      )
    )
  ).toBe(XL_CHART_TYPE.CONE_COL_CLUSTERED);
  expect(
    readModelChartType(
      document(
        '<c:lineChart><c:ser><c:marker><c:symbol val="none"/></c:marker></c:ser><c:marker val="1"/></c:lineChart>'
      )
    )
  ).toBe(XL_CHART_TYPE.LINE);
  expect(
    readModelChartType(
      document(
        '<c:bubbleChart><c:ser><c:bubble3D val="0"/></c:ser><c:bubble3D val="1"/></c:bubbleChart>'
      )
    )
  ).toBe(XL_CHART_TYPE.BUBBLE);
});
it("recognizes marker-only scatter represented by hidden connecting line", () => {
  expect(
    readModelChartType(
      document(
        '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:ser><c:spPr><a:ln xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:noFill/></a:ln></c:spPr></c:ser></c:scatterChart>'
      )
    )
  ).toBe(XL_CHART_TYPE.XY_SCATTER);
});
it("rejects duplicate type discriminators and ignores foreign plot lookalikes", () => {
  expect(() =>
    readModelChartType(
      document('<c:areaChart><c:grouping val="standard"/><c:grouping val="stacked"/></c:areaChart>')
    )
  ).toThrowError(expect.objectContaining({ code: "invalid-xml" }));
  expect(readModelChartType(document('<x:lineChart xmlns:x="urn:other"/><c:pie3DChart/>'))).toBe(
    XL_CHART_TYPE.THREE_D_PIE
  );
});
