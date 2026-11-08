import { XL_CHART_TYPE } from "./chart-enums.js";
import { OfficeError } from "./errors.js";
import { attr, child } from "./masters.js";
import type { XmlElement, XmlPart } from "./xml.js";

const plotTags = new Set([
  "areaChart",
  "area3DChart",
  "barChart",
  "bar3DChart",
  "bubbleChart",
  "doughnutChart",
  "lineChart",
  "line3DChart",
  "ofPieChart",
  "pieChart",
  "pie3DChart",
  "radarChart",
  "scatterChart",
  "stockChart",
  "surfaceChart",
  "surface3DChart"
]);
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Chart type cannot be classified from the retained plot properties.",
    "validate-intent"
  );
}
function token(node: XmlElement, localName: string, fallback?: string): string | undefined {
  const matches = node.children.filter(
    (n) => n.name.namespace === node.name.namespace && n.name.localName === localName
  );
  if (matches.length > 1)
    throw new OfficeError("invalid-xml", "Duplicate chart type discriminator.", "index");
  return matches[0] ? (attr(matches[0], "val") ?? fallback) : fallback;
}
function flag(node: XmlElement, localName: string, fallback = false): boolean {
  const value = token(node, localName, child(node, localName) ? "1" : undefined);
  if (value === undefined) return fallback;
  if (!["1", "0", "true", "false"].includes(value)) unsupported();
  return value === "1" || value === "true";
}
function series(node: XmlElement) {
  return node.children.filter(
    (n) => n.name.namespace === node.name.namespace && n.name.localName === "ser"
  );
}
function enumType(name: string): XL_CHART_TYPE {
  const value = Object.hasOwn(XL_CHART_TYPE, name)
    ? XL_CHART_TYPE[name as keyof typeof XL_CHART_TYPE]
    : undefined;
  if (typeof value !== "number") unsupported();
  return value as XL_CHART_TYPE;
}
export function readModelChartType(doc: XmlPart): XL_CHART_TYPE {
  const ns = doc.root.name.namespace;
  if (
    ![
      "http://schemas.openxmlformats.org/drawingml/2006/chart",
      "http://purl.oclc.org/ooxml/drawingml/chart"
    ].includes(ns)
  )
    unsupported();
  const chart = child(doc.root, "chart"),
    area = chart && child(chart, "plotArea");
  if (!area) unsupported();
  const plots = area.children.filter(
    (n) => n.name.namespace === ns && plotTags.has(n.name.localName)
  );
  const plot = plots[0];
  if (!plot) unsupported();
  const stock = plots.find((n) => n.name.localName === "stockChart");
  if (
    stock &&
    plots.length === 2 &&
    plots.some(
      (n) =>
        n.name.localName === "barChart" && token(n, "barDir") === "col" && series(n).length === 1
    )
  ) {
    const count = series(stock).length;
    if (count !== 3 && count !== 4) unsupported();
    return count === 3 ? XL_CHART_TYPE.STOCK_VHLC : XL_CHART_TYPE.STOCK_VOHLC;
  }
  const tag = plot.name.localName;
  const grouping = token(plot, "grouping", tag.startsWith("bar") ? "clustered" : "standard");
  if (!["standard", "clustered", "stacked", "percentStacked"].includes(grouping!)) unsupported();
  const suffix =
    grouping === "percentStacked" ? "_STACKED_100" : grouping === "stacked" ? "_STACKED" : "";
  const first = series(plot)[0];
  if (tag === "barChart" || tag === "bar3DChart") {
    const direction = token(plot, "barDir");
    if (direction !== "bar" && direction !== "col") unsupported();
    if (tag === "barChart")
      return enumType(`${direction === "bar" ? "BAR" : "COLUMN"}${suffix || "_CLUSTERED"}`);
    const shape = (first && token(first, "shape")) ?? token(plot, "shape", "box");
    const prefixes: Record<string, string> = {
      box: `THREE_D_${direction === "bar" ? "BAR" : "COLUMN"}`,
      cone: `CONE_${direction === "bar" ? "BAR" : "COL"}`,
      coneToMax: `CONE_${direction === "bar" ? "BAR" : "COL"}`,
      cylinder: `CYLINDER_${direction === "bar" ? "BAR" : "COL"}`,
      pyramid: `PYRAMID_${direction === "bar" ? "BAR" : "COL"}`,
      pyramidToMax: `PYRAMID_${direction === "bar" ? "BAR" : "COL"}`
    };
    if (!shape || !Object.hasOwn(prefixes, shape)) unsupported();
    return enumType(`${prefixes[shape]}${suffix || (grouping === "standard" ? "" : "_CLUSTERED")}`);
  }
  if (tag === "areaChart" || tag === "area3DChart")
    return enumType(`${tag === "area3DChart" ? "THREE_D_" : ""}AREA${suffix}`);
  if (tag === "lineChart") {
    const marker = first && child(first, "marker"),
      symbol = marker && token(marker, "symbol");
    const marked = symbol === undefined ? flag(plot, "marker") : symbol !== "none";
    return enumType(`LINE${marked ? "_MARKERS" : ""}${suffix}`);
  }
  if (tag === "line3DChart") return XL_CHART_TYPE.THREE_D_LINE;
  if (["pieChart", "pie3DChart", "doughnutChart"].includes(tag)) {
    const exploded = series(plot).some((n) => Number(token(n, "explosion", "0")) > 0);
    return enumType(
      `${tag === "pie3DChart" ? "THREE_D_PIE" : tag === "pieChart" ? "PIE" : "DOUGHNUT"}${exploded ? "_EXPLODED" : ""}`
    );
  }
  if (tag === "ofPieChart") {
    const type = token(plot, "ofPieType");
    if (type !== "bar" && type !== "pie") unsupported();
    return type === "bar" ? XL_CHART_TYPE.BAR_OF_PIE : XL_CHART_TYPE.PIE_OF_PIE;
  }
  if (tag === "bubbleChart")
    return (first && child(first, "bubble3D") ? flag(first, "bubble3D") : flag(plot, "bubble3D"))
      ? XL_CHART_TYPE.BUBBLE_THREE_D_EFFECT
      : XL_CHART_TYPE.BUBBLE;
  if (tag === "radarChart") {
    const style = token(plot, "radarStyle"),
      types: Record<string, string> = {
        standard: "RADAR",
        marker: "RADAR_MARKERS",
        filled: "RADAR_FILLED"
      };
    if (!style || !Object.hasOwn(types, style)) unsupported();
    return enumType(types[style]!);
  }
  if (tag === "scatterChart") {
    const style = token(plot, "scatterStyle"),
      types: Record<string, string> = {
        marker: "XY_SCATTER",
        lineMarker: "XY_SCATTER_LINES",
        line: "XY_SCATTER_LINES_NO_MARKERS",
        smoothMarker: "XY_SCATTER_SMOOTH",
        smooth: "XY_SCATTER_SMOOTH_NO_MARKERS"
      };
    if (!style || !Object.hasOwn(types, style)) unsupported();
    const a =
      ns === "http://purl.oclc.org/ooxml/drawingml/chart"
        ? "http://purl.oclc.org/ooxml/drawingml/main"
        : "http://schemas.openxmlformats.org/drawingml/2006/main";
    const props = first && child(first, "spPr"),
      line = props && child(props, "ln", a);
    if (line && child(line, "noFill", a)) return XL_CHART_TYPE.XY_SCATTER;
    return enumType(types[style]!);
  }
  if (tag === "stockChart") {
    const count = series(plot).length;
    if (count !== 3 && count !== 4) unsupported();
    return count === 3 ? XL_CHART_TYPE.STOCK_HLC : XL_CHART_TYPE.STOCK_OHLC;
  }
  return enumType(
    `SURFACE${tag === "surfaceChart" ? "_TOP_VIEW" : ""}${flag(plot, "wireframe") ? "_WIREFRAME" : ""}`
  );
}
