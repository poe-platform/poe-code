import { parseContentTypes } from "./content-types.js";
import { OfficeError } from "./errors.js";
import { readPackage, type PackageReader } from "./package-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { readRelationshipGraph } from "./relationships.js";
import type { SelectionContext } from "./selectors.js";
import { parseXmlPart, type XmlElement } from "./xml.js";

interface WorkbookData {
  readonly categories?: readonly (string | number | null)[];
  readonly categoryLevels?: readonly (readonly (string | null)[])[];
  readonly numberFormat?: string;
  readonly categoryNumberFormat?: string;
  readonly series: readonly {
    readonly name: string;
    readonly values: readonly (number | null)[];
    readonly xValues?: readonly number[];
    readonly bubbleSizes?: readonly number[];
    readonly numberFormat?: string;
  }[];
}
interface WorkbookInfo {
  readonly workbookPart: string;
  readonly stylesPart?: string;
  readonly sheetName: string;
  readonly sheetPart: string;
  readonly date1904: boolean;
}
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const encode = (text: string) => new TextEncoder().encode(text);
function unsupported(): never {
  throw new OfficeError(
    "unsupported-edit",
    "Chart data requires one simple owned worksheet without formulas or external dependencies.",
    "mutate"
  );
}
function attribute(node: XmlElement, name: string, namespace = ""): string | undefined {
  return node.attributes.find((a) => a.name.localName === name && a.name.namespace === namespace)
    ?.value;
}
function escaped(text: string): string {
  return text
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;")
    .split("\r")
    .join("&#13;");
}
function column(index: number): string {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}
function inspectWorkbook(pkg: PackageReader, context: SelectionContext): WorkbookInfo {
  const graph = readRelationshipGraph(pkg, context.relationshipLimits);
  if (graph.dangling.length) unsupported();
  for (const owner of ["/", ...graph.parts]) {
    if (graph.outgoing(owner).some((edge) => edge.external)) unsupported();
  }
  const roots = graph
    .outgoing("/")
    .filter((edge) => edge.type === `${relationships}/officeDocument`);
  if (roots.length !== 1 || !roots[0]!.targetPart) unsupported();
  const workbookPart = roots[0]!.targetPart;
  const workbook = parseXmlPart(pkg.get(workbookPart), context.xmlLimits);
  if (workbook.root.name.namespace !== ns || workbook.root.name.localName !== "workbook")
    unsupported();
  const allowed = ["fileVersion", "workbookPr", "bookViews", "sheets", "calcPr"];
  if (
    workbook.root.children.some(
      (node) => node.name.namespace !== ns || !allowed.includes(node.name.localName)
    )
  )
    unsupported();
  const sheets = workbook.root.children.filter((node) => node.name.localName === "sheets");
  if (sheets.length !== 1 || sheets[0]!.children.length !== 1) unsupported();
  const sheet = sheets[0]!.children[0]!;
  const sheetName = attribute(sheet, "name");
  const id = attribute(sheet, "id", relationships);
  const links = graph.outgoing(workbookPart);
  if (
    links.some(
      (edge) =>
        ![
          `${relationships}/worksheet`,
          `${relationships}/styles`,
          `${relationships}/sharedStrings`,
          `${relationships}/theme`
        ].includes(edge.type)
    )
  )
    unsupported();
  const worksheets = links.filter((edge) => edge.type === `${relationships}/worksheet`);
  if (
    sheet.name.localName !== "sheet" ||
    !sheetName ||
    worksheets.length !== 1 ||
    worksheets[0]!.id !== id ||
    !worksheets[0]!.targetPart
  )
    unsupported();
  const sheetPart = worksheets[0]!.targetPart;
  const types = parseContentTypes(pkg.get("/[Content_Types].xml"), {
    maxBytes: context.xmlLimits.maxBytes,
    maxEntries: context.archiveLimits.maxMembers
  });
  for (const part of graph.parts) {
    const type = types.get(part);
    if (
      type === "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml" ||
      (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" &&
        part !== sheetPart)
    )
      unsupported();
  }

  if (graph.incoming(sheetPart).length !== 1 || graph.outgoing(sheetPart).length) unsupported();
  if (
    pkg.names.some(
      (name) => name.startsWith("/xl/worksheets/") && name.endsWith(".xml") && name !== sheetPart
    )
  )
    unsupported();
  const worksheet = parseXmlPart(pkg.get(sheetPart), context.xmlLimits);
  if (worksheet.root.name.namespace !== ns || worksheet.root.name.localName !== "worksheet")
    unsupported();
  const sheetChildren = [
    "sheetPr",
    "dimension",
    "sheetViews",
    "sheetFormatPr",
    "cols",
    "sheetData",
    "pageMargins"
  ];
  if (
    worksheet.root.children.some(
      (node) => node.name.namespace !== ns || !sheetChildren.includes(node.name.localName)
    )
  )
    unsupported();
  if (worksheet.root.children.filter((node) => node.name.localName === "sheetData").length !== 1)
    unsupported();
  const visit = (node: XmlElement) => {
    if (node.name.namespace !== ns || ["f", "extLst"].includes(node.name.localName)) unsupported();
    node.children.forEach(visit);
  };
  visit(worksheet.root);
  const props = workbook.root.children.filter((node) => node.name.localName === "workbookPr");
  if (props.length > 1) unsupported();
  const date1904 = props[0] && attribute(props[0], "date1904");
  if (date1904 !== undefined && !["0", "1", "false", "true"].includes(date1904)) unsupported();
  const styles = links.filter((edge) => edge.type === `${relationships}/styles`);
  if (styles.length > 1) unsupported();
  return {
    workbookPart,
    ...(styles[0]?.targetPart ? { stylesPart: styles[0].targetPart } : {}),
    sheetName,
    sheetPart,
    date1904: date1904 === "1" || date1904 === "true"
  };
}

export async function validateChartWorkbook(
  bytes: Uint8Array,
  context: SelectionContext
): Promise<WorkbookInfo> {
  return inspectWorkbook(await readPackage(bytes, context), context);
}

function workbookStyles(
  formats: readonly (string | undefined)[],
  context: SelectionContext,
  source?: Uint8Array
): { readonly indices: readonly number[]; readonly bytes?: Uint8Array } {
  if (!source && !formats.some((format) => format !== undefined && format !== "General"))
    return { indices: formats.map(() => 0) };
  let xml = parseXmlPart(
    source ??
      encode(
        `<styleSheet xmlns="${ns}"><numFmts count="0"/><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`
      ),
    context.xmlLimits
  );
  if (xml.root.name.namespace !== ns || xml.root.name.localName !== "styleSheet") unsupported();
  const child = (name: string) => {
    const matches = xml.root.children.filter(
      (node) => node.name.namespace === ns && node.name.localName === name
    );
    if (matches.length > 1) unsupported();
    return matches[0];
  };
  if (!child("numFmts"))
    xml = xml.spliceChildren(xml.root, 0, 0, [`<numFmts xmlns="${ns}" count="0"/>`]);
  if (!child("cellXfs")?.children.length) unsupported();
  const indices = formats.map((format) => {
    let numFmts = child("numFmts")!;
    const id = numFmts.children.find((node) => attribute(node, "formatCode") === format);
    let number =
      format === undefined || format === "General" ? "0" : id && attribute(id, "numFmtId");
    if (!number) {
      const used = numFmts.children.map((node) => Number(attribute(node, "numFmtId")));
      if (used.some((value) => !Number.isSafeInteger(value) || value < 0)) unsupported();
      number = String(Math.max(163, ...used) + 1);
      xml = xml.spliceChildren(numFmts, numFmts.children.length, 0, [
        `<numFmt xmlns="${ns}" numFmtId="${number}" formatCode="${escaped(format!)}"/>`
      ]);
      numFmts = child("numFmts")!;
      xml = xml.merge(numFmts, {
        attributes: [{ namespace: "", localName: "count", value: String(numFmts.children.length) }]
      });
    }
    let xfs = child("cellXfs")!;
    const existing = xfs.children.findIndex(
      (node) =>
        attribute(node, "numFmtId") === number &&
        !["0", "false"].includes(attribute(node, "applyNumberFormat") ?? "") &&
        node.attributes.every(
          (item) =>
            item.name.namespace === "http://www.w3.org/2000/xmlns/" ||
            (item.name.namespace === "" &&
              ["numFmtId", "fontId", "fillId", "borderId", "xfId", "applyNumberFormat"].includes(
                item.name.localName
              ))
        ) &&
        ["fontId", "fillId", "borderId", "xfId"].every((name) => attribute(node, name) === "0") &&
        node.children.length === 0
    );
    if (existing >= 0) return existing;
    const index = xfs.children.length;
    xml = xml.spliceChildren(xfs, index, 0, [
      `<xf xmlns="${ns}" numFmtId="${number}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
    ]);
    xfs = child("cellXfs")!;
    xml = xml.merge(xfs, {
      attributes: [{ namespace: "", localName: "count", value: String(xfs.children.length) }]
    });
    return index;
  });
  return { indices, bytes: xml.bytes() };
}

export async function createChartWorkbook(
  data: WorkbookData,
  scatter: boolean,
  context: SelectionContext,
  options: { readonly date1904?: boolean; readonly source?: Uint8Array } = {}
): Promise<Uint8Array> {
  const source = options.source ? await readPackage(options.source, context) : undefined;
  const info = source ? inspectWorkbook(source, context) : undefined;
  const columns: (readonly (string | number | null)[])[] = scatter
    ? data.series.flatMap((series) => [
        ["", ...series.xValues!],
        [series.name, ...series.values],
        ...(series.bubbleSizes ? [["Size", ...series.bubbleSizes]] : [])
      ])
    : [
        ...(data.categoryLevels ?? [data.categories!]).map((level) => [null, ...level]),
        ...data.series.map((series) => [series.name, ...series.values])
      ];
  if (columns.length > 16384 || columns.some((values) => values.length > 1048576))
    throw new OfficeError("resource-limit", "Chart worksheet grid limit exceeded.", "serialize");
  const formats = scatter
    ? data.series.flatMap((series) => [
        data.numberFormat,
        series.numberFormat ?? data.numberFormat,
        ...(series.bubbleSizes ? [data.numberFormat] : [])
      ])
    : [
        ...(data.categoryLevels ?? [data.categories!]).map(() => data.categoryNumberFormat),
        ...data.series.map((series) => series.numberFormat ?? data.numberFormat)
      ];
  const styles = workbookStyles(
    formats,
    context,
    source && info?.stylesPart ? source.get(info.stylesPart) : undefined
  );
  let rows = "";
  const count = Math.max(...columns.map((values) => values.length));
  for (let row = 0; row < count; row++) {
    let cells = "";
    columns.forEach((values, col) => {
      const value = values[row];
      if (value === null || value === undefined) return;
      const ref = `${column(col)}${row + 1}`;
      const style = row > 0 && styles.indices[col] ? ` s="${styles.indices[col]}"` : "";
      cells +=
        typeof value === "number"
          ? `<c r="${ref}"${style}><v>${value}</v></c>`
          : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escaped(value)}</t></is></c>`;
    });
    rows += `<row r="${row + 1}">${cells}</row>`;
    if (rows.length > context.xmlLimits.maxBytes)
      throw new OfficeError("resource-limit", "Chart worksheet XML limit exceeded.", "serialize");
  }
  const sheetData = `<sheetData>${rows}</sheetData>`;
  let worksheet: Uint8Array = encode(`<worksheet xmlns="${ns}">${sheetData}</worksheet>`);
  parseXmlPart(worksheet, context.xmlLimits);
  if (source && info) {
    let xml = parseXmlPart(source.get(info.sheetPart), context.xmlLimits);
    const position = xml.root.children.findIndex((node) => node.name.localName === "sheetData");
    xml = xml.spliceChildren(xml.root, position, 1, [
      `<sheetData xmlns="${ns}">${rows}</sheetData>`
    ]);
    const dimension = xml.root.children.findIndex((node) => node.name.localName === "dimension");
    if (dimension !== -1) xml = xml.spliceChildren(xml.root, dimension, 1, []);
    worksheet = xml.bytes();
    const entries = new Map(source.names.map((name) => [name, source.get(name)]));
    entries.set(info.sheetPart, worksheet);
    if (styles.bytes) {
      const stylesPart =
        info.stylesPart ??
        `${info.workbookPart.slice(0, info.workbookPart.lastIndexOf("/") + 1)}chart-styles.xml`;
      if (!info.stylesPart) {
        if (entries.has(stylesPart)) unsupported();
        const split = info.workbookPart.lastIndexOf("/");
        const relsPart = `${info.workbookPart.slice(0, split)}/_rels/${info.workbookPart.slice(split + 1)}.rels`;
        let rels = parseXmlPart(source.get(relsPart), context.xmlLimits);
        let id = "chartStyles";
        while (rels.root.children.some((node) => attribute(node, "Id") === id)) id += "_";
        rels = rels.spliceChildren(rels.root, rels.root.children.length, 0, [
          `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${id}" Type="${relationships}/styles" Target="chart-styles.xml"/>`
        ]);
        entries.set(relsPart, rels.bytes());
        let types = parseXmlPart(source.get("/[Content_Types].xml"), context.xmlLimits);
        types = types.spliceChildren(types.root, types.root.children.length, 0, [
          `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${escaped(stylesPart)}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
        ]);
        entries.set("/[Content_Types].xml", types.bytes());
      }
      entries.set(stylesPart, styles.bytes);
    }
    return writePackageArchive(
      [...entries].map(([name, bytes]) => ({ name: name.slice(1), bytes })),
      context,
      { compression: "store" }
    );
  }
  return writePackageArchive(
    [
      {
        name: "[Content_Types].xml",
        bytes: encode(
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${styles.bytes ? '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' : ""}</Types>`
        )
      },
      {
        name: "_rels/.rels",
        bytes: encode(
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
        )
      },
      {
        name: "xl/workbook.xml",
        bytes: encode(
          `<workbook xmlns="${ns}" xmlns:r="${relationships}"><workbookPr date1904="${options.date1904 ? "1" : "0"}"/><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`
        )
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        bytes: encode(
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationships}/worksheet" Target="worksheets/sheet1.xml"/>${styles.bytes ? `<Relationship Id="rId2" Type="${relationships}/styles" Target="styles.xml"/>` : ""}</Relationships>`
        )
      },
      { name: "xl/worksheets/sheet1.xml", bytes: worksheet },
      ...(styles.bytes ? [{ name: "xl/styles.xml", bytes: styles.bytes }] : [])
    ],
    context,
    { compression: "store" }
  );
}
