import { SaxesParser } from "saxes";
import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { attr, child, loadShared } from "./masters.js";
import { nodeFor, selected, validateSelection, type ShapeSelection } from "./shape-operations.js";
import type { SelectionContext } from "./selectors.js";
import type { XmlElement, XmlPart } from "./xml.js";
export type ChartSelection = Pick<ShapeSelection, "scope" | "slide" | "shape" | "select">;
export interface ChartXmlNode {
  readonly name: string;
  readonly namespace: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly text: string;
  readonly children: readonly ChartXmlNode[];
  readonly xml: string;
}
export interface ChartPoint {
  readonly index: string | null;
  readonly value: string;
}
export interface ChartDataSource {
  readonly kind: string;
  readonly authority: "literal" | "referenced";
  readonly formula: string | null;
  readonly cached: boolean;
  readonly pointCount: string | null;
  readonly formatCode: string | null;
  readonly points: readonly ChartPoint[];
  readonly levels: readonly (readonly ChartPoint[])[];
}
export interface ChartSeries {
  readonly index: string | null;
  readonly order: string | null;
  readonly name: string | null;
  readonly nameSource: ChartDataSource | null;
  readonly categories: ChartDataSource | null;
  readonly values: ChartDataSource | null;
  readonly xValues: ChartDataSource | null;
  readonly yValues: ChartDataSource | null;
  readonly bubbleSizes: ChartDataSource | null;
  readonly labels: ChartXmlNode | null;
  readonly marker: ChartXmlNode | null;
  readonly points: readonly ChartXmlNode[];
  readonly format: ChartXmlNode | null;
  readonly xml: string;
}
export interface ChartPlot {
  readonly type: string;
  readonly properties: Readonly<Record<string, string>>;
  readonly axisIds: readonly string[];
  readonly series: readonly ChartSeries[];
  readonly labels: ChartXmlNode | null;
  readonly xml: string;
}
export interface ChartAxis {
  readonly type: string;
  readonly id: string | null;
  readonly crossAxisId: string | null;
  readonly properties: Readonly<Record<string, string>>;
  readonly details: ChartXmlNode;
  readonly xml: string;
}
export interface ChartInspection {
  readonly externalData: readonly ChartXmlNode[];
  readonly plots: readonly ChartPlot[];
  readonly axes: readonly ChartAxis[];
  readonly title: ChartXmlNode | null;
  readonly legend: ChartXmlNode | null;
  readonly style: string | null;
  readonly unsupported: readonly ChartXmlNode[];
  readonly xml: string;
}
export interface ChartLink {
  readonly relationshipId: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
  readonly targetPart: string | null;
  readonly role: "workbook" | "style" | "color-style" | "other";
  readonly authoritative: boolean;
}
export interface ChartRecord extends ChartInspection {
  readonly location: Location;
  readonly token: string;
  readonly part: string;
  readonly shapeId: string;
  readonly name: string | null;
  readonly chartPart: string;
  readonly relationshipId: string;
  readonly links: readonly ChartLink[];
}
const chartNamespaces = [
  "http://schemas.openxmlformats.org/drawingml/2006/chart",
  "http://purl.oclc.org/ooxml/drawingml/chart"
];
const chartEx = "http://schemas.microsoft.com/office/drawing/2014/chartex";
const relationships = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships"
];
const plotTypes = [
  "areaChart",
  "area3DChart",
  "barChart",
  "bar3DChart",
  "lineChart",
  "line3DChart",
  "pieChart",
  "pie3DChart",
  "doughnutChart",
  "ofPieChart",
  "radarChart",
  "scatterChart",
  "bubbleChart",
  "stockChart",
  "surfaceChart",
  "surface3DChart"
];
function descendants(node: XmlElement): XmlElement[] {
  return node.children.flatMap((x) => [x, ...descendants(x)]);
}
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
function activeChildren(
  doc: XmlPart,
  node: XmlElement,
  understood: readonly string[]
): readonly XmlElement[] {
  return node.children.flatMap((candidate) => {
    if (candidate.name.namespace !== mc || candidate.name.localName !== "AlternateContent")
      return [candidate];
    const branch =
      candidate.children.find((branch) => {
        if (branch.name.namespace !== mc || branch.name.localName !== "Choice") return false;
        const requires = attr(branch, "Requires") ?? "";
        const tokens = requires
          .split("\t")
          .join(" ")
          .split("\n")
          .join(" ")
          .split("\r")
          .join(" ")
          .split(" ")
          .filter(Boolean);
        return (
          tokens.length > 0 &&
          tokens.every((prefix) => understood.includes(doc.resolveNamespace(branch, prefix) ?? ""))
        );
      }) ??
      candidate.children.find(
        (branch) => branch.name.namespace === mc && branch.name.localName === "Fallback"
      );
    return branch ? [...activeChildren(doc, branch, understood)] : [];
  });
}
/** Read-only XML inventory; lexical numeric values retain errors, precision and cache holes. */
export function inspectChart(doc: XmlPart): ChartInspection {
  const ns = doc.root.name.namespace;
  const children = (node: XmlElement) =>
    activeChildren(doc, node, [
      ns,
      "http://schemas.openxmlformats.org/drawingml/2006/main",
      "http://purl.oclc.org/ooxml/drawingml/main"
    ]);
  const child = (node: XmlElement, name: string, namespace = ns) =>
    children(node).find((x) => x.name.localName === name && x.name.namespace === namespace);
  const text = (node: XmlElement | undefined): string => {
    if (!node) return "";
    let value = "";
    const parser = new SaxesParser({ xmlns: true });
    parser.on("text", (t) => {
      value += t;
    });
    parser.on("cdata", (t) => {
      value += t;
    });
    parser.write(doc.markup(node, true)).close();
    return value;
  };
  const tree = (node: XmlElement): ChartXmlNode => ({
    name: node.name.localName,
    namespace: node.name.namespace,
    attributes: Object.fromEntries(
      node.attributes.map((x) => [
        x.name.namespace ? `{${x.name.namespace}}${x.name.localName}` : x.name.localName,
        x.value
      ])
    ),
    text: text(node),
    children: node.children.map(tree),
    xml: doc.markup(node, true)
  });
  const property = (node: XmlElement, name: string) => {
    const found = child(node, name, ns);
    return found ? (attr(found, "val") ?? null) : null;
  };
  const properties = (node: XmlElement) =>
    Object.fromEntries(
      node.children
        .filter((x) => x.name.namespace === ns && attr(x, "val") !== undefined)
        .map((x) => [x.name.localName, attr(x, "val")!])
    );
  const optional = (node: XmlElement, name: string) => {
    const found = child(node, name, ns);
    return found ? tree(found) : null;
  };
  const points = (node: XmlElement) =>
    node.children
      .filter((x) => x.name.namespace === ns && x.name.localName === "pt")
      .map((x) => ({ index: attr(x, "idx") ?? null, value: text(child(x, "v", ns)) }));
  const source = (parent: XmlElement, name: string): ChartDataSource | null => {
    const holder = child(parent, name, ns);
    if (!holder) return null;
    const data = holder.children.find(
      (x) =>
        x.name.namespace === ns &&
        ["numRef", "strRef", "multiLvlStrRef", "numLit", "strLit", "v"].includes(x.name.localName)
    );
    if (!data) return null;
    const referenced = ["numRef", "strRef", "multiLvlStrRef"].includes(data.name.localName);
    const cache = referenced
      ? data.children.find(
          (x) =>
            x.name.namespace === ns &&
            ["numCache", "strCache", "multiLvlStrCache"].includes(x.name.localName)
        )
      : data;
    return {
      kind: data.name.localName,
      authority: referenced ? "referenced" : "literal",
      formula: child(data, "f", ns) ? text(child(data, "f", ns)) : null,
      cached: referenced && !!cache,
      pointCount: cache ? property(cache, "ptCount") : null,
      formatCode:
        cache && child(cache, "formatCode", ns) ? text(child(cache, "formatCode", ns)) : null,
      points:
        data.name.localName === "v"
          ? [{ index: "0", value: text(data) }]
          : cache
            ? points(cache)
            : [],
      levels: cache
        ? cache.children
            .filter((x) => x.name.namespace === ns && x.name.localName === "lvl")
            .map(points)
        : []
    };
  };
  const supported = chartNamespaces.includes(ns) && doc.root.name.localName === "chartSpace";
  const chart = supported ? child(doc.root, "chart", ns) : undefined;
  const area = chart && child(chart, "plotArea", ns);
  const plots = area
    ? area.children
        .filter((x) => x.name.namespace === ns && plotTypes.includes(x.name.localName))
        .map((node) => ({
          type: node.name.localName,
          properties: properties(node),
          axisIds: node.children
            .filter((x) => x.name.namespace === ns && x.name.localName === "axId")
            .map((x) => attr(x, "val") ?? ""),
          series: node.children
            .filter((x) => x.name.namespace === ns && x.name.localName === "ser")
            .map((ser) => {
              const nameSource = source(ser, "tx");
              return {
                index: property(ser, "idx"),
                order: property(ser, "order"),
                name: nameSource?.points[0]?.value ?? null,
                nameSource,
                categories: source(ser, "cat"),
                values: source(ser, "val"),
                xValues: source(ser, "xVal"),
                yValues: source(ser, "yVal"),
                bubbleSizes: source(ser, "bubbleSize"),
                labels: optional(ser, "dLbls"),
                marker: optional(ser, "marker"),
                points: ser.children
                  .filter((x) => x.name.namespace === ns && x.name.localName === "dPt")
                  .map(tree),
                format: optional(ser, "spPr"),
                xml: doc.markup(ser, true)
              };
            }),
          labels: optional(node, "dLbls"),
          xml: doc.markup(node, true)
        }))
    : [];
  const axes = area
    ? area.children
        .filter(
          (x) =>
            x.name.namespace === ns &&
            ["catAx", "valAx", "dateAx", "serAx"].includes(x.name.localName)
        )
        .map((node) => ({
          type: node.name.localName,
          id: property(node, "axId"),
          crossAxisId: property(node, "crossAx"),
          properties: properties(node),
          details: tree(node),
          xml: doc.markup(node, true)
        }))
    : [];
  const drawingNs =
    ns === chartNamespaces[1]
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const known = new Set([
    ...plotTypes,
    ..."chartSpace date1904 lang roundedCorners style clrMapOvr pivotSource name fmtId protection chart title tx rich strRef strCache numRef numCache multiLvlStrRef multiLvlStrCache numLit strLit f ptCount pt v lvl formatCode autoTitleDeleted pivotFmts view3D rotX hPercent rotY depthPercent rAngAx perspective floor sideWall backWall thickness plotArea layout manualLayout layoutTarget xMode yMode wMode hMode x y w h ser idx order spPr invertIfNegative pictureOptions pictureFormat pictureStackUnit dPt explosion marker symbol size dLbls dLbl delete dLblPos showLegendKey showVal showCatName showSerName showPercent showBubbleSize separator showLeaderLines leaderLines numFmt txPr cat val xVal yVal bubbleSize smooth shape axId grouping varyColors barDir gapWidth gapDepth overlap serLines firstSliceAng holeSize splitType splitPos secondPieSize custSplit secondPiePt wireframe bandFmts bandFmt radarStyle scatterStyle bubble3D bubbleScale showNegBubbles sizeRepresents dropLines hiLowLines upDownBars upBars downBars catAx dateAx valAx serAx scaling logBase orientation max min delete axPos majorGridlines minorGridlines majorTickMark minorTickMark tickLblPos crossAx crosses crossesAt auto lblAlgn lblOffset tickLblSkip tickMarkSkip noMultiLvlLbl baseTimeUnit majorUnit majorTimeUnit minorUnit minorTimeUnit dispUnits builtInUnit custUnit dispUnitsLbl crossBetween legend legendPos legendEntry overlay plotVisOnly dispBlanksAs showDLblsOverMax externalData autoUpdate printSettings headerFooter pageMargins pageSetup userShapes".split(
      " "
    )
  ]);
  const unsupported: XmlElement[] = [];
  const scan = (node: XmlElement): void => {
    for (const next of node.children) {
      if (
        (next.name.namespace !== ns && next.name.namespace !== drawingNs) ||
        (next.name.namespace === ns && !known.has(next.name.localName))
      )
        unsupported.push(next);
      else scan(next);
    }
  };
  if (supported) scan(doc.root);
  else unsupported.push(doc.root);
  return {
    externalData: children(doc.root)
      .filter((x) => x.name.namespace === ns && x.name.localName === "externalData")
      .map(tree),
    plots,
    axes,
    title: chart ? optional(chart, "title") : null,
    legend: chart ? optional(chart, "legend") : null,
    style: supported ? property(doc.root, "style") : null,
    unsupported: unsupported.map(tree),
    xml: doc.markup(doc.root, true)
  };
}
export async function readCharts(
  input: BinaryInput,
  options: ChartSelection,
  context: SelectionContext
): Promise<readonly ChartRecord[]> {
  if (
    !options ||
    typeof options !== "object" ||
    Reflect.ownKeys(options).some(
      (key) =>
        typeof key !== "string" ||
        !["scope", "slide", "shape", "select"].includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(options, key)!)
    )
  )
    throw new OfficeError("invalid-value", "Invalid chart selection options.", "usage");
  validateSelection(options, "read");
  if (options.scope !== undefined && options.scope !== "slides")
    throw new OfficeError("invalid-selection", "Charts require slide scope.", "select");
  options = { ...options };
  const s = await loadShared(input, context, false);
  const result: ChartRecord[] = [];
  for (const record of selected(s, options)) {
    const doc = s.doc(record.part),
      shape = nodeFor(doc.root, record.id);
    if (shape.name.localName !== "graphicFrame" || shape.name.namespace !== s.p) continue;
    for (const binding of activeChildren(
      doc,
      child(child(shape, "graphic", s.a) ?? shape, "graphicData", s.a) ?? shape,
      [s.p, s.a, ...chartNamespaces, chartEx]
    ).filter(
      (x) =>
        x.name.localName === "chart" && [...chartNamespaces, chartEx].includes(x.name.namespace)
    )) {
      const id = binding.attributes.find(
        (x) => x.name.localName === "id" && relationships.includes(x.name.namespace)
      )?.value;
      const link = s.index.inventory.relationships.find(
        (x) =>
          x.owner === record.part &&
          x.id === id &&
          (relationships.some((ns) => x.type === `${ns}/chart`) ||
            x.type === "http://schemas.microsoft.com/office/2014/relationships/chartEx")
      );
      if (!link || link.external || !link.targetPart)
        throw new OfficeError("missing-binding", "Missing internal chart relationship.", "parse");
      const chartDoc = s.doc(link.targetPart);
      const externalData = descendants(chartDoc.root).filter(
        (x) =>
          x.name.namespace === chartDoc.root.name.namespace && x.name.localName === "externalData"
      );
      const workbookIds = externalData.flatMap((x) =>
        x.attributes
          .filter((a) => a.name.localName === "id" && relationships.includes(a.name.namespace))
          .map((a) => a.value)
      );
      const links: ChartLink[] = s.index.inventory.relationships
        .filter((x) => x.owner === link.targetPart)
        .map((x) => ({
          relationshipId: x.id,
          type: x.type,
          target: x.target,
          external: x.external,
          targetPart: x.targetPart,
          role:
            workbookIds.includes(x.id) || relationships.some((ns) => x.type === `${ns}/package`)
              ? "workbook"
              : x.type === "http://schemas.microsoft.com/office/2011/relationships/chartStyle"
                ? "style"
                : x.type ===
                    "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle"
                  ? "color-style"
                  : "other",
          authoritative: workbookIds.includes(x.id)
        }));
      result.push({
        ...inspectChart(chartDoc),
        location: record.location,
        token: record.token,
        part: record.part,
        shapeId: record.id,
        name: record.name ?? null,
        chartPart: link.targetPart,
        relationshipId: link.id,
        links
      });
    }
  }
  return result;
}
