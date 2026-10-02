import { OfficeError } from "./errors.js";
import type { RelationshipEdge } from "./relationships.js";
import type { XmlPart } from "./xml.js";

export const chartImportTypes = {
  chart: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
  chartEx: "application/vnd.ms-office.chartex+xml",
  chartStyle: "application/vnd.ms-office.chartstyle+xml",
  chartColorStyle: "application/vnd.ms-office.chartcolorstyle+xml"
};
export const chartImportRelationships: Readonly<Record<string, string>> = {
  "http://schemas.microsoft.com/office/2014/relationships/chartEx": "chartEx",
  "http://schemas.microsoft.com/office/2011/relationships/chartStyle": "chartStyle",
  "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle": "chartColorStyle"
};
const extendedChart = "http://schemas.microsoft.com/office/drawing/2014/chartex";
const chartStyle = "http://schemas.microsoft.com/office/drawing/2012/chartStyle";

export function validatePreservedChart(
  xml: XmlPart,
  type: string,
  edges: readonly RelationshipEdge[],
  dialect: { readonly a: string; readonly c: string; readonly r: string }
): void {
  const fail = (): never => {
    throw new OfficeError(
      "unsupported-edit",
      "Import cannot preserve these chart references safely.",
      "validate-intent"
    );
  };
  const roots: Record<string, readonly [string, string]> = {
    [chartImportTypes.chart]: [dialect.c, "chartSpace"],
    [chartImportTypes.chartEx]: [extendedChart, "chartSpace"],
    [chartImportTypes.chartStyle]: [chartStyle, "chartStyle"],
    [chartImportTypes.chartColorStyle]: [chartStyle, "colorStyle"]
  };
  const root = roots[type];
  if (!root || xml.root.name.namespace !== root[0] || xml.root.name.localName !== root[1]) fail();
  const namespaces = [
    dialect.c,
    dialect.a,
    extendedChart,
    chartStyle,
    "http://schemas.microsoft.com/office/drawing/2007/8/2/chart"
  ];
  const pending = [xml.root];
  while (pending.length) {
    const node = pending.pop()!;
    if (!namespaces.includes(node.name.namespace)) fail();
    if (
      ["hlinkClick", "hlinkHover", "oleObj", "control", "contentPart"].includes(node.name.localName)
    )
      fail();
    for (const attribute of node.attributes) {
      const { namespace, localName } = attribute.name;
      if (namespace === "http://www.w3.org/2000/xmlns/") continue;
      if (namespace === dialect.r) {
        if (
          !["id", "embed", "link"].includes(localName) ||
          !edges.some((edge) => edge.id === attribute.value)
        )
          fail();
      } else if (namespace === "http://www.w3.org/XML/1998/namespace") {
        if (!["lang", "space"].includes(localName)) fail();
      } else if (
        namespace ||
        [
          "spid",
          "shapeId",
          "slideId",
          "part",
          "partName",
          "href",
          "src",
          "target",
          "Target"
        ].includes(localName)
      )
        fail();
    }
    pending.push(...node.children);
  }
}
