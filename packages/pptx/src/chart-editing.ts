import type { BinaryInput } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { attr, child, escape, loadShared, nextRel, relPart, required } from "./masters.js";
import { relativePartReference } from "./package-uri.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import { nodeFor, validateSelection, type ShapeSelection } from "./shape-operations.js";
import { applyShapeUpdate } from "./shapes.js";
import { readCharts, inspectChart } from "./charts.js";
import { parseXmlPart, type XmlPart, type XmlElement } from "./xml.js";
import { createChartWorkbook, validateChartWorkbook } from "./chart-workbook.js";

export const chartTypes = [
  "BAR_CLUSTERED",
  "BAR_STACKED",
  "BAR_STACKED_100",
  "COLUMN_CLUSTERED",
  "COLUMN_STACKED",
  "COLUMN_STACKED_100",
  "LINE",
  "LINE_MARKERS",
  "LINE_MARKERS_STACKED",
  "LINE_MARKERS_STACKED_100",
  "LINE_STACKED",
  "LINE_STACKED_100",
  "PIE",
  "PIE_EXPLODED",
  "XY_SCATTER",
  "XY_SCATTER_LINES",
  "XY_SCATTER_LINES_NO_MARKERS",
  "XY_SCATTER_SMOOTH",
  "XY_SCATTER_SMOOTH_NO_MARKERS"
] as const;
export type CreatableChartType = (typeof chartTypes)[number];
export interface ChartInputSeries {
  readonly name: string;
  readonly values: readonly (number | null)[];
  readonly xValues?: readonly number[];
  readonly numberFormat?: string;
}
export interface ChartData {
  readonly categories?: readonly (string | number | null)[];
  readonly series: readonly ChartInputSeries[];
}
export interface ChartUpdate {
  readonly data?: ChartData;
  readonly style?: number;
  readonly title?: string;
  readonly legend?: boolean;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
}
export interface AddChartOptions extends ChartUpdate {
  readonly slide: number;
  readonly type: CreatableChartType;
  readonly data: ChartData;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function unsupported(message: string): never {
  throw new OfficeError("unsupported-edit", message, "validate-intent");
}
function object(value: unknown, keys: readonly string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (k) =>
        typeof k !== "string" ||
        !keys.includes(k) ||
        !("value" in Object.getOwnPropertyDescriptor(value, k)!)
    )
  )
    invalid("Chart options require plain data properties.");
}
function array(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 250000 ||
    Reflect.ownKeys(value).some(
      (k) =>
        k !== "length" &&
        (typeof k !== "string" ||
          !Number.isSafeInteger(Number(k)) ||
          String(Number(k)) !== k ||
          !("value" in Object.getOwnPropertyDescriptor(value, k)!))
    ) ||
    Object.keys(value).length !== value.length
  )
    invalid("Chart arrays require nonempty bounded dense data.");
}
function dateLabel(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    value[4] === "-" &&
    value[7] === "-" &&
    value[10] === "T" &&
    value.endsWith("Z")
  );
}
function dateSerial(value: string, date1904: boolean): number {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 19) !== value.slice(0, 19))
    invalid("Invalid UTC category date.");
  const day = Math.floor(stamp / 86400000);
  return date1904
    ? day - Math.floor(Date.UTC(1904, 0, 1) / 86400000)
    : day -
        Math.floor(Date.UTC(1899, 11, 31) / 86400000) +
        (day >= Math.floor(Date.UTC(1900, 2, 1) / 86400000) ? 1 : 0);
}
function normalizedData(data: ChartData, date1904 = false): ChartData {
  return {
    ...data,
    ...(data.categories
      ? {
          categories: data.categories.map((value) =>
            dateLabel(value) ? dateSerial(value as string, date1904) : value
          )
        }
      : {})
  };
}
export function validateChartData(data: ChartData, type?: CreatableChartType): void {
  object(data, ["categories", "series"]);
  array(data.series);
  if (type !== undefined && !chartTypes.includes(type)) invalid("Unsupported chart creation type.");
  if (data.categories !== undefined) {
    array(data.categories);
    const kinds = new Set(
      data.categories.filter((v) => v !== null).map((v) => (dateLabel(v) ? "date" : typeof v))
    );
    for (const value of data.categories) if (dateLabel(value)) dateSerial(value as string, false);
    if (
      kinds.size > 1 ||
      data.categories.some(
        (v) => v !== null && typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v))
      )
    )
      invalid("Categories require homogeneous strings or finite numbers with optional nulls.");
  }
  for (const series of data.series) {
    object(series, ["name", "values", "xValues", "numberFormat"]);
    if (
      typeof series.name !== "string" ||
      (series.numberFormat !== undefined && typeof series.numberFormat !== "string")
    )
      invalid("Series names and number formats require strings.");
    array(series.values);
    if (series.values.some((v) => v !== null && (typeof v !== "number" || !Number.isFinite(v))))
      invalid("Series values require finite numbers or nulls.");
    if (series.xValues !== undefined) {
      array(series.xValues);
      if (
        series.xValues.length !== series.values.length ||
        series.xValues.some((v) => typeof v !== "number" || !Number.isFinite(v))
      )
        invalid("Scatter coordinates require equal length finite x values.");
    }
    if (type?.startsWith("XY_")) {
      if (data.categories !== undefined || !series.xValues)
        invalid("Scatter requires x values and forbids categories.");
    } else if (type !== undefined) {
      if (
        !data.categories ||
        data.categories.length !== series.values.length ||
        series.xValues !== undefined
      )
        invalid("Category series lengths must match categories.");
    }
  }
  if (type?.startsWith("PIE") && data.series.length !== 1)
    invalid("Pie charts require exactly one series.");
}
export function validateChartUpdate(update: ChartUpdate): void {
  object(update, ["data", "style", "title", "legend", "left", "top", "width", "height"]);
  if (update.data !== undefined) validateChartData(update.data);
  if (
    update.style !== undefined &&
    (!Number.isInteger(update.style) || update.style < 1 || update.style > 48)
  )
    invalid("Chart style requires an integer from 1 to 48.");
  if (update.title !== undefined && typeof update.title !== "string")
    invalid("Chart title requires text.");
  if (update.legend !== undefined && typeof update.legend !== "boolean")
    invalid("Chart legend requires a boolean.");
  for (const k of ["left", "top", "width", "height"] as const) {
    const v = update[k];
    if (
      v !== undefined &&
      (!Number.isSafeInteger(v) ||
        Math.abs(v) > 27273042316900 ||
        ((k === "width" || k === "height") && v <= 0))
    )
      invalid("Chart geometry requires bounded integer EMUs and positive extents.");
  }
}
function column(n: number): string {
  let s = "";
  for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function variant(type: CreatableChartType) {
  return {
    scatter: type.startsWith("XY_"),
    pie: type.startsWith("PIE"),
    bar: type.startsWith("BAR_") || type.startsWith("COLUMN_"),
    horizontal: type.startsWith("BAR_"),
    grouping: type.endsWith("_100")
      ? "percentStacked"
      : type.includes("STACKED")
        ? "stacked"
        : "clustered",
    marker: !type.endsWith("NO_MARKERS"),
    smooth: type.includes("SMOOTH")
  };
}
function seriesXml(
  type: CreatableChartType,
  data: ChartData,
  index: number,
  sheetName: string,
  date1904 = false
): string {
  const dates = data.categories?.some(dateLabel) ?? false;
  data = normalizedData(data, date1904);
  const series = data.series[index]!,
    v = variant(type),
    xColumn = v.scatter ? index * 2 : 0,
    yColumn = v.scatter ? index * 2 + 1 : index + 1;
  const sheet = sheetName === "Sheet1" ? sheetName : `'${sheetName.split("'").join("''")}'`;
  const reference = (
    holder: string,
    values: readonly (string | number | null)[],
    numeric: boolean,
    col: number
  ) =>
    `<c:${holder}><c:${numeric ? "num" : "str"}Ref><c:f>${escape(`${sheet}!$${column(col)}$2:$${column(col)}$${values.length + 1}`)}</c:f><c:${numeric ? "num" : "str"}Cache>${numeric ? `<c:formatCode>${escape(holder === "cat" && dates ? "yyyy-mm-dd" : (series.numberFormat ?? "General"))}</c:formatCode>` : ""}<c:ptCount val="${values.length}"/>${values.map((n, i) => (n === null ? "" : `<c:pt idx="${i}"><c:v>${escape(String(n))}</c:v></c:pt>`)).join("")}</c:${numeric ? "num" : "str"}Cache></c:${numeric ? "num" : "str"}Ref></c:${holder}>`;
  return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:strRef><c:f>${escape(`${sheet}!$${column(yColumn)}$1`)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escape(series.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>${type.startsWith("LINE") || v.scatter ? `<c:marker><c:symbol val="${(v.scatter ? v.marker : type.includes("MARKERS")) ? "circle" : "none"}"/></c:marker>` : ""}${type === "PIE_EXPLODED" ? '<c:explosion val="25"/>' : ""}${
    v.scatter
      ? reference("xVal", series.xValues!, true, xColumn) +
        reference("yVal", series.values, true, yColumn)
      : reference(
          "cat",
          data.categories!,
          data.categories!.some((x) => typeof x === "number"),
          0
        ) + reference("val", series.values, true, yColumn)
  }${type.startsWith("LINE") || v.scatter ? `<c:smooth val="${v.smooth ? 1 : 0}"/>` : ""}</c:ser>`;
}
function titleXml(title: string, a: string, c: string): string {
  return `<c:title xmlns:c="${c}" xmlns:a="${a}"><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escape(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}
export function createChartXml(
  type: CreatableChartType,
  data: ChartData,
  properties: ChartUpdate = {},
  strict = false,
  sheetName = "Sheet1",
  date1904 = false
): string {
  validateChartData(data, type);
  validateChartUpdate(properties);
  const c = strict
      ? "http://purl.oclc.org/ooxml/drawingml/chart"
      : "http://schemas.openxmlformats.org/drawingml/2006/chart",
    a = strict
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main",
    r = strict
      ? "http://purl.oclc.org/ooxml/officeDocument/relationships"
      : "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    v = variant(type),
    plot = v.scatter ? "scatterChart" : v.pie ? "pieChart" : v.bar ? "barChart" : "lineChart";
  const axisName = (category: boolean) =>
    category ? (data.categories?.some(dateLabel) ? "dateAx" : "catAx") : "valAx";
  const axis = (id: number, cross: number, pos: string, category: boolean) =>
    `<c:${axisName(category)}><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/><c:numFmt formatCode="${category && data.categories?.some(dateLabel) ? "yyyy-mm-dd" : "General"}" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/>${category ? (data.categories?.some(dateLabel) ? '<c:auto val="1"/><c:lblOffset val="100"/><c:baseTimeUnit val="days"/>' : '<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>') : `<c:crossBetween val="${v.scatter ? "midCat" : "between"}"/>`}</c:${axisName(category)}>`;
  const setup = v.scatter
    ? `<c:scatterStyle val="${type === "XY_SCATTER" ? "marker" : v.smooth ? (v.marker ? "smoothMarker" : "smooth") : v.marker ? "lineMarker" : "line"}"/>`
    : v.bar
      ? `<c:barDir val="${v.horizontal ? "bar" : "col"}"/><c:grouping val="${v.grouping}"/>`
      : v.pie
        ? ""
        : `<c:grouping val="${v.grouping === "clustered" ? "standard" : v.grouping}"/>`;
  return `<c:chartSpace xmlns:c="${c}" xmlns:a="${a}" xmlns:r="${r}">${date1904 ? '<c:date1904 val="1"/>' : ""}${properties.style === undefined ? "" : `<c:style val="${properties.style}"/>`}<c:chart>${properties.title === undefined ? "" : titleXml(properties.title, a, c)}<c:autoTitleDeleted val="${properties.title === undefined ? 1 : 0}"/><c:plotArea><c:layout/><c:${plot}>${setup}<c:varyColors val="${v.pie ? 1 : 0}"/>${data.series.map((_, i) => seriesXml(type, data, i, sheetName, date1904)).join("")}${v.bar ? `<c:gapWidth val="150"/>${v.grouping !== "clustered" ? '<c:overlap val="100"/>' : ""}` : ""}${v.pie ? '<c:firstSliceAng val="0"/>' : '<c:axId val="1"/><c:axId val="2"/>'}</c:${plot}>${v.pie ? "" : axis(1, 2, v.horizontal ? "l" : "b", !v.scatter) + axis(2, 1, v.horizontal ? "b" : "l", false)}</c:plotArea>${properties.legend ? '<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>' : ""}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}
export async function addChart(
  input: BinaryInput,
  options: AddChartOptions,
  context: SelectionContext
): Promise<Uint8Array> {
  object(options, [
    "slide",
    "type",
    "data",
    "style",
    "title",
    "legend",
    "left",
    "top",
    "width",
    "height"
  ]);
  const { slide, type, ...update } = options;
  validateChartUpdate(update);
  validateChartData(options.data, type);
  if (!Number.isSafeInteger(slide) || slide < 1)
    invalid("Chart creation requires a positive slide position.");
  for (const key of ["left", "top", "width", "height"] as const)
    if (options[key] === undefined) invalid("Chart creation requires explicit geometry.");
  options = structuredClone(options);
  const s = await loadShared(input, context),
    target = s.index.inventory.slides.find((x) => x.position === slide);
  if (!target) throw new SelectionError("missing-selection");
  const doc = s.doc(target.part),
    tree = required(required(doc.root, "cSld"), "spTree"),
    used = new Set<number>(),
    pending = [tree];
  while (pending.length) {
    const n = pending.pop()!;
    if (n.name.namespace === s.p && n.name.localName === "cNvPr") used.add(Number(attr(n, "id")));
    pending.push(...n.children);
  }
  let id = 1;
  while (used.has(id)) id++;
  if (id > 4294967295) invalid("No chart shape identity available.");
  let n = 1;
  while (
    s.reader.names.some(
      (x) =>
        x.toLowerCase() === `/ppt/charts/chart${n}.xml` ||
        x.toLowerCase() === `/ppt/embeddings/chart${n}.xlsx` ||
        x.toLowerCase() === `/ppt/charts/_rels/chart${n}.xml.rels`
    )
  )
    n++;
  const chartPart = `/ppt/charts/chart${n}.xml`,
    workbookPart = `/ppt/embeddings/chart${n}.xlsx`,
    relns = "http://schemas.openxmlformats.org/package/2006/relationships",
    slideRelPart = relPart(target.part),
    rels = s.reader.names.includes(slideRelPart)
      ? s.doc(slideRelPart)
      : parseXmlPart(
          new TextEncoder().encode(`<Relationships xmlns="${relns}"/>`),
          context.xmlLimits
        ),
    rid = nextRel(rels);
  s.save(
    slideRelPart,
    rels.spliceChildren(rels.root, rels.root.children.length, 0, [
      `<Relationship xmlns="${relns}" Id="${rid}" Type="${s.r}/chart" Target="${escape(relativePartReference(chartPart, target.part.slice(0, target.part.lastIndexOf("/"))))}"/>`
    ])
  );
  s.changes.set(
    chartPart,
    new TextEncoder().encode(
      createChartXml(type, options.data, update, s.p.includes("purl.oclc.org"))
    )
  );
  s.changes.set(
    workbookPart,
    await createChartWorkbook(normalizedData(options.data), variant(type).scatter, context)
  );
  s.changes.set(
    relPart(chartPart),
    new TextEncoder().encode(
      `<Relationships xmlns="${relns}"><Relationship Id="rId1" Type="${s.r}/package" Target="../embeddings/chart${n}.xlsx"/></Relationships>`
    )
  );
  const types = s.doc("/[Content_Types].xml");
  s.save(
    "/[Content_Types].xml",
    types.spliceChildren(types.root, types.root.children.length, 0, [
      `<Override xmlns="${types.root.name.namespace}" PartName="${chartPart}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
      `<Override xmlns="${types.root.name.namespace}" PartName="${workbookPart}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>`
    ])
  );
  const c = s.p.includes("purl.oclc.org")
    ? "http://purl.oclc.org/ooxml/drawingml/chart"
    : "http://schemas.openxmlformats.org/drawingml/2006/chart";
  const xml = `<p:graphicFrame xmlns:p="${s.p}" xmlns:a="${s.a}" xmlns:r="${s.r}" xmlns:c="${c}"><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${options.left}" y="${options.top}"/><a:ext cx="${options.width}" cy="${options.height}"/></p:xfrm><a:graphic><a:graphicData uri="${c}"><c:chart r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
  const ext = child(tree, "extLst");
  s.save(
    target.part,
    doc.spliceChildren(tree, ext ? tree.children.indexOf(ext) : tree.children.length, 0, [xml])
  );
  return (await s.finish(target.part, [slide])).bytes;
}
function replaceChild(
  doc: XmlPart,
  parent: XmlElement,
  name: string,
  xml: string | undefined
): XmlPart {
  const old = child(parent, name),
    order =
      parent.name.localName === "chartSpace"
        ? [
            "date1904",
            "lang",
            "roundedCorners",
            "style",
            "clrMapOvr",
            "pivotSource",
            "protection",
            "chart",
            "spPr",
            "txPr",
            "externalData",
            "printSettings",
            "userShapes",
            "extLst"
          ]
        : [
            "title",
            "autoTitleDeleted",
            "pivotFmts",
            "view3D",
            "floor",
            "sideWall",
            "backWall",
            "plotArea",
            "legend",
            "plotVisOnly",
            "dispBlanksAs",
            "showDLblsOverMax",
            "extLst"
          ];
  const following = parent.children.find(
    (n) =>
      n.name.namespace === parent.name.namespace &&
      order.indexOf(n.name.localName) > order.indexOf(name)
  );
  return doc.spliceChildren(
    parent,
    old
      ? parent.children.indexOf(old)
      : following
        ? parent.children.indexOf(following)
        : parent.children.length,
    old ? 1 : 0,
    xml === undefined ? [] : [xml]
  );
}
function existingType(doc: XmlPart): CreatableChartType {
  const info = inspectChart(doc);
  if (info.plots.length !== 1) unsupported("Combination chart data is preserve-only.");
  const plot = info.plots[0]!,
    group = plot.properties.grouping,
    suffix = group === "percentStacked" ? "_STACKED_100" : group === "stacked" ? "_STACKED" : "";
  if (plot.type === "barChart")
    return `${plot.properties.barDir === "bar" ? "BAR" : "COLUMN"}${suffix || "_CLUSTERED"}` as CreatableChartType;
  if (plot.type === "lineChart") {
    const marker = plot.series[0]?.marker?.children.find((n) => n.name === "symbol")?.attributes
      .val;
    return `LINE${marker && marker !== "none" ? "_MARKERS" : ""}${suffix}` as CreatableChartType;
  }
  if (plot.type === "pieChart") return "PIE";
  if (plot.type === "scatterChart") {
    const types: Record<string, CreatableChartType> = {
      marker: "XY_SCATTER",
      lineMarker: "XY_SCATTER_LINES",
      line: "XY_SCATTER_LINES_NO_MARKERS",
      smoothMarker: "XY_SCATTER_SMOOTH",
      smooth: "XY_SCATTER_SMOOTH_NO_MARKERS"
    };
    const type = types[plot.properties.scatterStyle ?? ""];
    if (!type) unsupported("Unsupported scatter style cannot be reconstructed.");
    return type;
  }
  return unsupported("Chart data reconstruction is unsupported for this plot.");
}
export async function setCharts(
  input: BinaryInput,
  selection: ShapeSelection,
  update: ChartUpdate,
  context: SelectionContext
): Promise<Uint8Array> {
  object(selection, ["scope", "slide", "shape", "select", "all", "allowEmpty"]);
  validateSelection(selection, "set");
  validateChartUpdate(update);
  if (selection.scope !== undefined && selection.scope !== "slides")
    throw new SelectionError("invalid-selection");
  selection = { ...selection };
  update = structuredClone(update);
  const s = await loadShared(input, context),
    records = await readCharts(
      s.source,
      {
        ...(selection.scope !== undefined ? { scope: selection.scope } : {}),
        ...(selection.slide !== undefined ? { slide: selection.slide } : {}),
        ...(selection.shape !== undefined ? { shape: selection.shape } : {}),
        ...(selection.select !== undefined ? { select: selection.select } : {})
      },
      context
    );
  if (!records.length && !selection.allowEmpty) throw new SelectionError("missing-selection");
  if (records.length > 1 && !selection.all) throw new SelectionError("ambiguous-selection");
  for (const record of records) {
    let doc = s.doc(record.chartPart);
    const ns = doc.root.name.namespace;
    if (
      ![
        "http://schemas.openxmlformats.org/drawingml/2006/chart",
        "http://purl.oclc.org/ooxml/drawingml/chart"
      ].includes(ns)
    )
      unsupported("Extended chart editing is unsupported.");
    if (
      update.style !== undefined &&
      doc.root.children.some(
        (n) =>
          n.name.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006" &&
          n.name.localName === "AlternateContent"
      )
    )
      unsupported("Conditional chart style dependencies prevent an unambiguous style edit.");
    if (update.data !== undefined) {
      const type = existingType(doc);
      validateChartData(update.data, type);
      const inspection = inspectChart(doc);
      if (inspection.unsupported.length)
        unsupported("Unknown chart extensions prevent data replacement.");
      const links = record.links.filter((x) => x.role === "workbook");
      if (
        links.length !== 1 ||
        links[0]!.external ||
        !links[0]!.targetPart ||
        !links[0]!.authoritative
      )
        unsupported("Data replacement requires one owned embedded workbook.");
      const workbookPart = links[0]!.targetPart!,
        workbook = s.reader.get(workbookPart),
        metadata = await validateChartWorkbook(workbook, context);
      if (s.index.inventory.relationships.filter((x) => x.targetPart === workbookPart).length !== 1)
        unsupported("Shared chart workbook ownership is ambiguous.");
      const sheet =
        metadata.sheetName === "Sheet1"
          ? "Sheet1"
          : `'${metadata.sheetName.split("'").join("''")}'`;
      for (const [index, series] of inspection.plots[0]!.series.entries()) {
        const scatter = variant(type).scatter,
          xColumn = scatter ? index * 2 : 0,
          yColumn = scatter ? index * 2 + 1 : index + 1;
        const channels = [
          [series.nameSource, `${sheet}!$${column(yColumn)}$1`],
          [scatter ? series.xValues : series.categories, null],
          [scatter ? series.yValues : series.values, null]
        ] as const;
        for (const [position, [source, nameFormula]] of channels.entries()) {
          if (!source || source.authority !== "referenced" || !source.cached)
            unsupported("Chart data must have simple owned cached references.");
          const count = Number(source.pointCount),
            col = position === 1 ? xColumn : yColumn;
          if (!Number.isSafeInteger(count) || count < 1)
            unsupported("Chart cache cardinality is invalid.");
          const expected = nameFormula ?? `${sheet}!$${column(col)}$2:$${column(col)}$${count + 1}`;
          if (source.formula !== expected)
            unsupported("Chart formulas must reference their owned simple data ranges.");
        }
      }
      const plot = child(required(doc.root, "chart"), "plotArea")!.children.find(
        (x) => x.name.namespace === ns && x.name.localName === inspection.plots[0]!.type
      )!;
      const series = plot.children.filter(
        (x) => x.name.namespace === ns && x.name.localName === "ser"
      );
      for (let index = 0; index < update.data.series.length; index++) {
        const generated = parseXmlPart(
          new TextEncoder().encode(
            `<c:ser xmlns:c="${ns}">${seriesXml(type, update.data, index, metadata.sheetName, metadata.date1904).slice(7, -8)}</c:ser>`
          ),
          context.xmlLimits
        );
        if (index >= series.length) {
          const currentPlot = required(required(doc.root, "chart"), "plotArea").children.find(
            (x) => x.name.namespace === ns && x.name.localName === plot.name.localName
          )!;
          const currentSeries = currentPlot.children.filter(
            (x) => x.name.namespace === ns && x.name.localName === "ser"
          );
          const insertion = currentSeries.length
            ? currentPlot.children.indexOf(currentSeries[currentSeries.length - 1]!) + 1
            : currentPlot.children.length;
          doc = doc.spliceChildren(currentPlot, insertion, 0, [
            generated.markup(generated.root, true)
          ]);
          continue;
        }
        for (const name of [
          "tx",
          variant(type).scatter ? "xVal" : "cat",
          variant(type).scatter ? "yVal" : "val"
        ]) {
          const fresh = child(generated.root, name)!;
          const updatedPlot = required(required(doc.root, "chart"), "plotArea").children.find(
              (x) => x.name.namespace === ns && x.name.localName === plot.name.localName
            )!,
            updated = updatedPlot.children.filter(
              (x) => x.name.namespace === ns && x.name.localName === "ser"
            )[index]!;
          const old = child(updated, name);
          if (!old) unsupported("Missing chart data structure.");
          doc = doc.spliceChildren(updated, updated.children.indexOf(old), 1, [
            generated.markup(fresh, true)
          ]);
        }
      }
      for (let index = series.length - 1; index >= update.data.series.length; index--) {
        const currentPlot = required(required(doc.root, "chart"), "plotArea").children.find(
          (x) => x.name.namespace === ns && x.name.localName === plot.name.localName
        )!;
        const current = currentPlot.children.filter(
          (x) => x.name.namespace === ns && x.name.localName === "ser"
        )[index]!;
        doc = doc.spliceChildren(currentPlot, currentPlot.children.indexOf(current), 1, []);
      }
      s.changes.set(
        workbookPart,
        await createChartWorkbook(
          normalizedData(update.data, metadata.date1904),
          variant(type).scatter,
          context,
          {
            source: workbook,
            date1904: metadata.date1904
          }
        )
      );
    }
    if (update.style !== undefined)
      doc = replaceChild(
        doc,
        doc.root,
        "style",
        `<c:style xmlns:c="${ns}" val="${update.style}"/>`
      );
    if (update.title !== undefined) {
      doc = replaceChild(
        doc,
        required(doc.root, "chart"),
        "title",
        titleXml(update.title, s.a, ns)
      );
      doc = replaceChild(
        doc,
        required(doc.root, "chart"),
        "autoTitleDeleted",
        `<c:autoTitleDeleted xmlns:c="${ns}" val="0"/>`
      );
    }
    if (
      update.legend !== undefined &&
      (!update.legend || !child(required(doc.root, "chart"), "legend"))
    )
      doc = replaceChild(
        doc,
        required(doc.root, "chart"),
        "legend",
        update.legend
          ? `<c:legend xmlns:c="${ns}"><c:legendPos val="r"/><c:overlay val="0"/></c:legend>`
          : undefined
      );
    s.save(record.chartPart, doc);
    const geometry = Object.fromEntries(
      Object.entries(update).filter(([k]) => ["left", "top", "width", "height"].includes(k))
    );
    if (Object.keys(geometry).length) {
      const slideDoc = s.doc(record.part);
      s.save(
        record.part,
        applyShapeUpdate(slideDoc, nodeFor(slideDoc.root, record.shapeId), geometry)
      );
    }
  }
  return (
    await s.finish(
      records[0]?.chartPart ?? s.main,
      s.index.inventory.slides
        .filter((slide) => records.some((r) => r.part === slide.part))
        .map((slide) => slide.position)
    )
  ).bytes;
}
