import { createZipCodec, CodecError, type ZipLimits, type ZipEntry } from "@poe-code/office-package";
import { parseXmlSteps, XmlLimitError, type XmlElement } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { parseA1, formatA1, snapshotWorkbook, type Cell, type CellValue, type Workbook, type Sheet, type Range, type RichTextRun,
  type ImportedValue, type AxisMetadata, type FormulaGroup, type NamedExpression, type UnsupportedRecord } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { excelGrammar, gnumericGrammar } from "../formulas/conventions.js";
import { serializeExpression } from "../formulas/serialization.js";
import { rewriteReferences, visitFormula } from "../formulas/rewriting.js";
import { xlsxSchemas, xlsxNamespaces, xlsxNamespaceScanElements, type XlsxSchemaNode } from "./xlsx-schema.js";
import { converterLocale } from "../locale/runtime.js";
import { readXlsxMetadata } from "./xlsx-metadata.js";
import { readXlsxStyles, readXlsxString } from "./xlsx-styles.js";
import { createXlsxXml, escapeXlsx, writeRichString, metadataNode } from "./xlsx-write-support.js";
import { createXlsxStyles, styleRecord } from "./xlsx-write-styles.js";
import { writeXlsxSheetMetadata, writeXlsxProperties } from "./xlsx-write-metadata.js";
import { gnumericNumber } from "./gnumeric-number.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { formulaSemanticsAttributes, readFormulaSemantics } from "./formula-semantics.js";

const spreadsheetNamespaces = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://schemas.openxmlformats.org/spreadsheetml/2006/7/main",
  "http://schemas.openxmlformats.org/spreadsheetml/2006/5/main",
  "http://schemas.microsoft.com/office/excel/2006/2",
  "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
]);
const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";
function warningBytes(message: string, context: CapabilityContext): Uint8Array {
  const text = converterLocale(context.environment) === "C"
    ? Array.from(message, character => character.codePointAt(0)! < 128 ? character : "?").join("") : message;
  return new TextEncoder().encode(text);
}
const schemaEdges = Object.fromEntries(Object.entries(xlsxSchemas).map(([name, schema]) => {
  const edges = new Map<string, XlsxSchemaNode[]>();
  for (const node of schema) { const key = node[0] + ":" + node[3]; const list = edges.get(key) ?? []; list.push(node); edges.set(key, list); }
  return [name, edges];
}));
async function recognize(root: XmlElement, schema: string, context: CapabilityContext): Promise<XmlElement> {
  const edges = schemaEdges[schema]; if (!edges) return root;
  const prefixes = new Map<string, string>(), namespacePrefixes = new Map<string, string>(), unknownPrefixes = new Set<string>();
  async function visit(node: XmlElement, parent: string, ancestors: readonly string[], inheritedNamespace: string): Promise<XmlElement | undefined> {
    context.signal.throwIfAborted();
    const matches = edges!.get(parent + ":" + node.localName) ?? [];
    const scans = ancestors.length === 0 || xlsxNamespaceScanElements.has(ancestors[ancestors.length - 1]!);
    let namespace = inheritedNamespace;
    if (scans) for (const attribute of node.attributes) {
      if (attribute.namespace !== "http://www.w3.org/2000/xmlns/") continue;
      const key = Object.keys(xlsxNamespaces).find(key => xlsxNamespaces[key]!.includes(attribute.value));
      if (attribute.name === "xmlns") { if (key) namespace = key; }
      else if (key) {
        const prefix = attribute.localName;
        if (!prefixes.has(prefix)) {
          prefixes.set(prefix, key);
          if (!namespacePrefixes.has(key)) namespacePrefixes.set(key, prefix);
        }
      } else unknownPrefixes.add(attribute.localName);
    }
    const colon = node.name.indexOf(":"), prefix = colon < 0 ? undefined : node.name.slice(0, colon);
    const match = matches.find(m => prefix === undefined ? m[2] === namespace : namespacePrefixes.get(m[2]) === prefix);
    if (!match) {
      if (prefix !== undefined && unknownPrefixes.has(prefix)) return undefined;
      const message = `Unexpected element '${node.name}' in state : \n\t${ancestors.join(" -> ")}\n`;
      await context.diagnostic?.({ code: "xlsx-unknown-element", severity: "warning", message,
        bytes: warningBytes(message, context) });
      return undefined;
    }
    if (node.localName === "ext") return node;
    const accepted: XmlElement[] = [];
    for (const item of node.children) {
      const child = await visit(item, match[1], [...ancestors, node.localName], namespace);
      if (child) accepted.push(child);
    }
    return { ...node, namespace: xlsxNamespaces[match[2]]?.[0] ?? node.namespace, children: accepted,
      attributes: node.attributes.map(attribute => {
        const colon = attribute.name.indexOf(":");
        const key = colon < 0 ? undefined : prefixes.get(attribute.name.slice(0, colon));
        return key ? { ...attribute, namespace: xlsxNamespaces[key]![0]! } : attribute;
      }) };
  }
  return await visit(root, "START", [], "") ?? { ...root, children: [] };
}
function invalid(message: string): never { throw new SsconvertError("io", `E Invalid XLSX: ${message}`); }
function limit(message: string): never { throw new SsconvertError("resource-limit", `ssconvert XLSX ${message} limit exceeded`); }
function children(node: XmlElement | undefined, name: string): XmlElement[] {
  return node?.children.filter(item => item.localName === name) ?? [];
}
function child(node: XmlElement | undefined, name: string): XmlElement | undefined { return children(node, name)[0]; }
function attr(node: XmlElement | undefined, name: string, namespace = ""): string | undefined {
  return node?.attributes.find(item => item.localName === name && item.namespace === namespace)?.value;
}
function number(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const result = Number(value); if (!Number.isFinite(result)) invalid(`invalid number '${value}'`); return result;
}
function integer(value: string | undefined, fallback = 0): number {
  const result = number(value, fallback); if (!Number.isSafeInteger(result) || result < 0) invalid("invalid nonnegative integer"); return result;
}
function boolean(value: string | undefined): boolean { return value === "1" || value === "true"; }
function sharedStringIndex(source: string): number | undefined {
  // xlsx_relaxed_strtol accepts decimal digits with surrounding ASCII whitespace.
  const whitespace = (character: string | undefined) => character !== undefined && " \t\n\r\v\f".includes(character);
  let offset = 0;
  while (whitespace(source[offset])) offset++;
  const negative = source[offset] === "-";
  if (negative || source[offset] === "+") offset++;
  const start = offset; let value = 0;
  while (source[offset] !== undefined && source[offset]! >= "0" && source[offset]! <= "9") {
    value = value * 10 + source.charCodeAt(offset++) - 48;
    if (!Number.isSafeInteger(value)) return undefined;
  }
  if (offset === start || negative && value !== 0) return undefined;
  while (whitespace(source[offset])) offset++;
  return offset === source.length ? value : undefined;
}
function zipLimits(context: CapabilityContext): ZipLimits {
  return { maxArchiveBytes: Math.min(context.limits.inputBytes, context.limits.compressedBytes ?? context.limits.inputBytes), maxEntryBytes: Math.min(context.limits.inputBytes, context.limits.inflatedBytes ?? context.limits.inputBytes),
    maxTotalBytes: Math.min(context.limits.inputBytes, context.limits.inflatedBytes ?? context.limits.inputBytes), maxMembers: context.limits.zipEntries ?? context.limits.workbookNodes ?? 100000,
    maxPathBytes: 4096, maxDepth: context.limits.xmlDepth ?? 128, maxPaxBytes: context.limits.inputBytes,
    maxTextBytes: context.limits.workbookTextBytes ?? context.limits.inputBytes, chunkSize: 16384 };
}
function path(base: string, target: string): string {
  // OPC URI paths are resolved without involving host paths or network capabilities.
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { return invalid("invalid relationship URI"); }
  if (decoded.includes("\\") || decoded.includes(":" ) || decoded.includes("?") || decoded.includes("#")
    || [...decoded].some(c => c.charCodeAt(0) < 32)) invalid("invalid internal relationship target");
  const components = decoded.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const component of decoded.split("/")) {
    if (component === "..") { if (!components.length) invalid("relationship escapes package"); components.pop(); }
    else if (component && component !== ".") components.push(component);
  }
  if (!components.length) invalid("empty relationship target");
  return components.join("/");
}
interface Relationship { readonly id: string; readonly type: string; readonly target: string; readonly external: boolean; }

async function openPackage(bytes: Uint8Array, context: CapabilityContext) {
  context.signal.throwIfAborted();
  const bounds = zipLimits(context); const zip = createZipCodec(undefined, { rejectDuplicateNames: true, zip64: true });
  const archive = await zip.readZipArchive(bytes, bounds, context.signal);
  for (const entry of archive.entries) {
    if (entry.size > (context.limits.zipRatio ?? 1000) * Math.max(1, entry.data.length)) limit("ZIP ratio");
  }
  const entries = new Map<string, ZipEntry>();
  for (const entry of archive.entries) {
    if (entry.directory) continue;
    if (entry.symlink || path("", entry.name) !== entry.name) invalid("noncanonical package member");
    entries.set(entry.name, entry);
  }
  let decodedBytes = 0, nodes = 0, textBytes = 0;
  let packageWork = 0;
  const maximumWork = context.limits.workbookWork ?? 10000000;
  function charge(amount: number): void {
    context.signal.throwIfAborted();
    if (amount > maximumWork - packageWork) limit("work"); packageWork += amount;
  }
  const documents = new Map<string, XmlElement>();
  async function document(name: string): Promise<XmlElement> {
    context.signal.throwIfAborted();
    const cached = documents.get(name); if (cached) return cached;
    const entry = entries.get(name); if (!entry) return invalid(`missing part '${name}'`);
    const chunks: Uint8Array[] = []; let length = 0;
    for await (const bytes of zip.decodeZipEntry(entry, bounds, context.signal)) {
      if (bytes.length > bounds.maxTotalBytes - decodedBytes) limit("decoded bytes");
      decodedBytes += bytes.length; length += bytes.length; chunks.push(bytes);
    }
    const plain = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { plain.set(chunk, offset); offset += chunk.length; }
    let encoding: "UTF-8" | "UTF-16LE" | "UTF-16BE" = "UTF-8";
    if (plain[0] === 255 && plain[1] === 254 || plain[0] === 60 && plain[1] === 0) encoding = "UTF-16LE";
    if (plain[0] === 254 && plain[1] === 255 || plain[0] === 0 && plain[1] === 60) encoding = "UTF-16BE";
    const text = new TextDecoder(encoding, { fatal: true }).decode(plain);
    textBytes += plain.length;
    if (textBytes > (context.limits.workbookTextBytes ?? bounds.maxTotalBytes)) limit("XML text");
    const parser = parseXmlSteps(text, { expectedEncoding: encoding, maxDepth: context.limits.xmlDepth ?? 128,
      maxNodes: (context.limits.workbookNodes ?? 100000) - nodes,
      maxAttributes: context.limits.workbookNodes ?? 100000, maxTextLength: bounds.maxTextBytes,
      onElement() { nodes++; charge(1); } });
    let step = parser.next(), parserWork = 0;
    while (!step.done) {
      context.signal.throwIfAborted();
      if (++parserWork % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      step = parser.next();
    }
    documents.set(name, step.value); return step.value;
  }
  async function relations(base: string): Promise<readonly Relationship[]> {
    const slash = base.lastIndexOf("/");
    const name = base ? base.slice(0, slash + 1) + "_rels/" + base.slice(slash + 1) + ".rels" : "_rels/.rels";
    if (!entries.has(name)) return [];
    const root = await document(name);
    if (root.localName !== "Relationships" || root.namespace !== packageRelationships) invalid("invalid relationships root");
    const result: Relationship[] = []; const ids = new Set<string>();
    for (const item of root.children) {
      if (item.localName !== "Relationship" || item.namespace !== packageRelationships) continue;
      const id = attr(item, "Id"), type = attr(item, "Type"), target = attr(item, "Target");
      if (!id || !type || !target || ids.has(id)) invalid("invalid or duplicate relationship"); ids.add(id);
      const external = attr(item, "TargetMode") === "External";
      result.push({ id, type, target: external ? target : path(base, target), external });
    }
    return result;
  }
  return { entries, document, relations, charge };
}
function translateFailure(error: unknown, context: CapabilityContext): never {
  context.signal.throwIfAborted();
  if (error instanceof SyntaxError && error.message === "Invalid XML: DTD and entity declarations are forbidden")
    throw new SsconvertError("capability-denied", "ssconvert host denies XML DTD and entity declarations");
  if (error instanceof SsconvertError) throw error;
  if (error instanceof XmlLimitError || error instanceof CodecError && error.code === "resource-limit") limit("package");
  return invalid(error instanceof Error ? error.message : "invalid package");
}
export async function probeXlsx(bytes: Uint8Array, context: CapabilityContext): Promise<boolean> {
  // Native xlsx_file_probe checks member existence, without parsing workbook XML.
  try { return (await openPackage(bytes, context)).entries.has("xl/workbook.xml"); }
  catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof CodecError && error.code === "invalid-package" || error instanceof SsconvertError && error.code === "io") return false;
    return translateFailure(error, context);
  }
}
function rootIs(root: XmlElement, name: string): void {
  if (root.localName !== name || !spreadsheetNamespaces.has(root.namespace)) invalid(`unsupported ${name} namespace`);
}
function range(source: string | undefined): Range {
  if (!source) return invalid("missing range");
  const endpoints = source.split(":"); const first = parseA1(endpoints[0]!), last = parseA1(endpoints[1] ?? endpoints[0]!);
  if (endpoints.length > 2 || !first || !last || first.row > last.row || first.column > last.column
    || last.row >= 1048576 || last.column >= 16384) invalid("invalid cell range");
  return { startRow: first.row, startColumn: first.column, endRow: last.row, endColumn: last.column };
}
function data(node: XmlElement): ImportedValue {
  return { name: node.localName, namespace: node.namespace, attributes: Object.fromEntries(node.attributes
    .filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/").map(a => [a.name, a.value])),
    text: node.text, children: node.children.map(data) };
}
function record(node: XmlElement, source: string): UnsupportedRecord {
  return { source, kind: node.localName, disposition: "retained", data: data(node) };
}
function formula(source: string, sheet: string, row: number, column: number, context: CapabilityContext, arrayStringLiterals = false): string {
  const parsed = parseExpression("=" + source, { grammar: excelGrammar, position: { sheet, row, column }, arrayStringLiterals, signal: context.signal,
    maximumLength: context.limits.workbookTextBytes ?? context.limits.inputBytes, maximumNodes: context.limits.workbookNodes ?? 100000 });
  if (!parsed.ok) return "=" + source;
  let simpleSheets = true;
  visitFormula(parsed.document.root, node => {
    if (node.kind !== "reference") return;
    for (const name of [node.first.sheet, node.last?.sheet, node.first.workbook]) if (name !== undefined
      && (!name || [...name].some(c => !(c >= "A" && c <= "Z" || c >= "a" && c <= "z" || c >= "0" && c <= "9")))) simpleSheets = false;
  });
  return serializeExpression(parsed.document, simpleSheets ? { ...gnumericGrammar, unquotedSheets: true } : gnumericGrammar, false, true);
}
export async function readXlsx(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  try {
    const opc = await openPackage(bytes, context);
    const rootRelations = await opc.relations("");
    const workbookRelation = rootRelations.find(r => r.type === relationships + "/officeDocument");
    if (!workbookRelation || workbookRelation.external) throw new SsconvertError("io", "E No workbook stream found.");
    const workbookPath = workbookRelation.target;
    let workbook = await opc.document(workbookPath);
    if (workbook.localName !== "workbook" || !spreadsheetNamespaces.has(workbook.namespace)) return { sheets: [] };
    const workbookRelations = await opc.relations(workbookPath);
    const related = async (type: string): Promise<XmlElement | undefined> => {
      const relation = workbookRelations.find(r => r.type === relationships + "/" + type);
      if (!relation) return undefined; if (relation.external) invalid(`external ${type} part`);
      return opc.document(relation.target);
    };
    let stringRoot = await related("sharedStrings"); if (stringRoot) rootIs(stringRoot, "sst");
    if (stringRoot) stringRoot = await recognize(stringRoot, "xlsx_shared_strings_dtd", context);
    let theme = await related("theme"); if (theme) theme = await recognize(theme, "xlsx_theme_dtd", context);
    let styleRoot = await related("styles"); if (styleRoot) styleRoot = await recognize(styleRoot, "xlsx_styles_dtd", context);
    const strings = children(stringRoot, "si").map(node => readXlsxString(node, context)), cellStyles = await readXlsxStyles(styleRoot, theme, context);
    workbook = await recognize(workbook, "xlsx_workbook_dtd", context);
    const workbookRecords: UnsupportedRecord[] = [];
    for (const type of ["theme", "externalLink", "pivotCacheDefinition"]) {
      for (const relation of workbookRelations.filter(r => r.type === relationships + "/" + type && !r.external))
        workbookRecords.push(record(await opc.document(relation.target), relation.target));
    }
    const uniqueSheets = new Map<string, XmlElement>();
    for (const node of children(child(workbook, "sheets"), "sheet")) {
      const name = attr(node, "name");
      if (name === undefined) { await context.diagnostic?.({ code: "xlsx-sheet", severity: "warning", message: "Ignoring a sheet without a name" }); continue; }
      uniqueSheets.set(name, node);
    }
    const sheetNodes = [...uniqueSheets.values()];
    if (sheetNodes.length > context.limits.sheets) limit("sheets");
    let cellCount = 0;
    const sheets: Sheet[] = [];
    for (const sheetNode of sheetNodes) {
      context.signal.throwIfAborted();
      const name = attr(sheetNode, "name") ?? "Sheet" + (sheets.length + 1), id = "sheet-" + (sheets.length + 1);
      const relation = workbookRelations.find(r => r.id === attr(sheetNode, "id", relationships));
      if (!relation || relation.external) invalid("missing worksheet relationship");
      if (relation.type !== relationships + "/worksheet") {
        workbookRecords.push({ source: relation.target, kind: "non-worksheet", disposition: "dropped" }); continue;
      }
      let source = await opc.document(relation.target); rootIs(source, "worksheet");
      source = await recognize(source, "xlsx_sheet_dtd", context);
      const sheetRelations = await opc.relations(relation.target);
      const cells: Cell[] = [], rows: AxisMetadata[] = [], columns: AxisMetadata[] = [], groups: FormulaGroup[] = [];
      const shared = new Map<string, { expression: string; row: number; column: number; id: string; arrayStringLiterals?: boolean }>();
      const columnStyles = children(child(source, "cols"), "col").filter(node => attr(node, "style") !== undefined)
        .map(node => ({ min: integer(attr(node, "min")) - 1, max: integer(attr(node, "max")) - 1, style: cellStyles[integer(attr(node, "style"))] }));
      let nextRow = 0;
      for (const row of children(child(source, "sheetData"), "row")) {
        const rowIndex = attr(row, "r") === undefined ? nextRow : integer(attr(row, "r")) - 1;
        if (rowIndex < 0 || rowIndex >= 1048576) invalid("invalid row"); nextRow = rowIndex + 1;
        rows.push({ index: rowIndex, ...(attr(row, "ht") === undefined ? {} : { sizePoints: number(attr(row, "ht")) }),
          hidden: boolean(attr(row, "hidden")), outlineLevel: integer(attr(row, "outlineLevel")), collapsed: boolean(attr(row, "collapsed")) });
        let nextColumn = 0;
        for (const node of children(row, "c")) {
          if (++cellCount > context.limits.cells) limit("cells"); context.signal.throwIfAborted();
          const position = attr(node, "r") ? parseA1(attr(node, "r")!) : { row: rowIndex, column: nextColumn };
          if (!position || position.row >= 1048576 || position.column >= 16384) invalid("invalid cell address"); nextColumn = position.column + 1;
          const raw = child(node, "v")?.text, type = attr(node, "t");
          let value: CellValue = { kind: "blank" }, richText: readonly RichTextRun[] | undefined;
          if (type === "inlineStr") { const string = readXlsxString(child(node, "is"), context); value = { kind: "string", value: string.value }; richText = string.richText; }
          else if (raw !== undefined && raw !== "") {
            if (type === "s") {
              const index = sharedStringIndex(raw), string = index === undefined ? undefined : strings[index];
              if (string) { value = { kind: "string", value: string.value }; richText = string.richText; }
              else {
                const message = `${name}!${formatA1(position.row, position.column)} : Invalid sst ref '${raw}'`;
                await context.diagnostic?.({ code: "xlsx-shared-string", severity: "warning", message,
                  bytes: warningBytes(message + "\n", context) });
              }
            }
            else if (type === "b") value = { kind: "boolean", value: raw[0] !== "0" };
            else if (type === "e") value = { kind: "error", value: raw };
            else if (type === "str") value = { kind: "string", value: raw };
            else {
              if (type && type !== "n") await context.diagnostic?.({ code: "xlsx-cell-type", severity: "warning",
                message: `${name}!${formatA1(position.row, position.column)} : Unknown enum value '${type}' for attribute t` });
              const parsed = Number.parseFloat(raw);
              value = { kind: "number", value: Number.isNaN(parsed) ? 0 : parsed };
            }
          }
          opc.charge(columnStyles.length);
          let inheritedStyle;
          for (const column of columnStyles) if (position.column >= column.min && position.column <= column.max) inheritedStyle = column.style;
          if (boolean(attr(row, "customFormat")) && attr(row, "s") !== undefined) inheritedStyle = cellStyles[integer(attr(row, "s"))];
          const styleId = attr(node, "s"), style = styleId === undefined ? inheritedStyle : cellStyles[integer(styleId)];
          const f = child(node, "f"); let expression: string | undefined, groupId: string | undefined;
          let semantics = readFormulaSemantics(f);
          if (f) {
            const kind = attr(f, "t");
            if (kind === "shared") {
              const si = attr(f, "si") ?? "0"; const existing = shared.get(si);
              if (f.text) {
                expression = formula(f.text, id, position.row, position.column, context, semantics.arrayStringLiterals); groupId = `shared-${si}`;
                shared.set(si, { expression, ...position, id: groupId, ...semantics });
                if (attr(f, "ref")) groups.push({ id: groupId, kind: "shared", expression, range: range(attr(f, "ref")), ...semantics });
              } else if (existing) {
                semantics = existing.arrayStringLiterals ? { arrayStringLiterals: true } : {};
                const parsed = parseExpression(existing.expression, { position: { sheet: id, row: existing.row, column: existing.column }, ...semantics, signal: context.signal });
                if (!parsed.ok) invalid("invalid shared formula");
                expression = rewriteReferences(parsed.document, { position: { sheet: id, ...position }, translation: "copy", signal: context.signal }); groupId = existing.id;
              } else invalid("shared formula has no preceding definition");
            } else {
              expression = formula(f.text, id, position.row, position.column, context, semantics.arrayStringLiterals);
              if (kind === "array") { groupId = `array-${position.row}-${position.column}`; groups.push({ id: groupId, kind: "array", expression, range: range(attr(f, "ref")), ...semantics }); }
            }
          }
          cells.push({ ...position, value, ...(expression === undefined ? {} : { formula: expression, ...semantics, formulaDirty: raw === undefined || raw === "",
            ...(raw === undefined || raw === "" ? {} : { cachedResult: value }) }), ...(groupId ? { formulaGroup: groupId } : {}),
            ...(style ?? {}), ...(richText ? { richText } : {}) });
        }
      }
      for (const node of children(child(source, "cols"), "col")) {
        const min = integer(attr(node, "min")), max = integer(attr(node, "max"));
        if (min < 1 || max < min || max > 16384) invalid("invalid column span");
        if (max - min + 1 > (context.limits.workbookNodes ?? 100000) - columns.length) limit("column metadata");
        opc.charge(max - min + 1);
        for (let index = min - 1; index < max; index++) columns.push({ index, hidden: boolean(attr(node, "hidden")),
          outlineLevel: integer(attr(node, "outlineLevel")), collapsed: boolean(attr(node, "collapsed")),
          ...(attr(node, "width") === undefined ? {} : { sizePoints: number(attr(node, "width")) * (130 / 18.5703125) * (72 / 96),
            style: { xlsxWidth: number(attr(node, "width")) } }) });
      }
      const records: UnsupportedRecord[] = [];
      const hyperlinkRegions: ImportedValue[] = [];
      for (const link of children(child(source, "hyperlinks"), "hyperlink")) {
        const bounds = range(attr(link, "ref"));
        const location = attr(link, "location"), tooltip = attr(link, "tooltip");
        const relationId = [...source.namespaces.values()].includes(relationships) ? attr(link, "id", relationships) : undefined;
        const external = sheetRelations.find(part => part.id === relationId && part.external && part.type === relationships + "/hyperlink");
        let target: string | undefined, type: string | undefined;
        if (external) { const url = external.target.toLowerCase(); type = url.startsWith("mailto:") ? "GnmHLinkEMail" : url.startsWith("http:") || url.startsWith("https:") ? "GnmHLinkURL" : "GnmHLinkExternal"; target = external.target + (location === undefined ? "" : "#" + location); }
        else if (location && relationId === undefined) { target = location; type = "GnmHLinkCurWB"; }
        if (!target || !type) { await context.diagnostic?.({ severity: "warning", code: "xlsx-hyperlink",
          message: `${name}!${formatA1(nextRow, cells.length ? cells[cells.length - 1]!.column + 1 : 0)} : Unknown type of hyperlink` }); continue; }
        const hyperlink: ImportedValue = { name: "HyperLink", namespace: "http://www.gnumeric.org/v10.dtd", text: "", children: [],
          attributes: Object.entries({ type, target, ...(tooltip === undefined ? {} : { tip: tooltip }) }).map(([name, value]) => ({ name, namespace: "", value })) };
        const style: ImportedValue = { name: "Style", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [], children: [hyperlink] };
        hyperlinkRegions.push({ name: "StyleRegion", namespace: "http://www.gnumeric.org/v10.dtd", text: "",
          attributes: Object.entries({ startCol: bounds.startColumn, startRow: bounds.startRow, endCol: bounds.endColumn, endRow: bounds.endRow }).map(([name, value]) => ({ name, namespace: "", value: String(value) })), children: [style] });
        // Merge metadata into existing cell styles so later per-cell style export cannot overwrite the link.
        opc.charge(cells.length);
        for (let index = 0; index < cells.length; index++) {
          const cell = cells[index]!;
          if (cell.row < bounds.startRow || cell.row > bounds.endRow || cell.column < bounds.startColumn || cell.column > bounds.endColumn) continue;
          const saved = cell.style?.gnumeric;
          const original = saved && !Array.isArray(saved) && typeof saved === "object" ? saved as { readonly [key: string]: ImportedValue } : undefined;
          cells[index] = { ...cell, style: { ...cell.style, gnumeric: { ...(original ?? style as { readonly [key: string]: ImportedValue }),
            children: [...(Array.isArray(original?.children) ? original.children : []), hyperlink] } } };
        }
      }
      if (hyperlinkRegions.length) records.push({ source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: {
        name: "Styles", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [], children: hyperlinkRegions } });
      const commentsPart = sheetRelations.find(part => !part.external && part.type === relationships + "/comments");
      let comments = commentsPart ? await opc.document(commentsPart.target) : undefined;
      if (comments) comments = await recognize(comments, "xlsx_comments_dtd", context);
      records.push(...readXlsxMetadata(source, comments));
      for (const extension of children(child(source, "extLst"), "ext")) {
        if (attr(extension, "uri") === undefined) await context.diagnostic?.({ severity: "warning", code: "xlsx-extension",
          message: `${name}!${formatA1(nextRow, cells.length ? cells[cells.length - 1]!.column + 1 : 0)} : Encountered uninterpretable "ext" extension with missing namespace` });
      }
      const handled = new Set(["sheetData", "cols", "dimension", "mergeCells", "sheetViews"]);
      for (const node of source.children) if (spreadsheetNamespaces.has(node.namespace) && !handled.has(node.localName)) records.push(record(node, relation.target));
      for (const part of sheetRelations) {
        if (part.external) continue;
        const referencedDrawing = ["drawing", "legacyDrawing", "legacyDrawingHF"].some(type => children(source, type)
          .some(node => attr(node, "id", relationships) === part.id));
        if (["comments", "pivotTable"].some(type => part.type === relationships + "/" + type)
          || referencedDrawing && ["drawing", "vmlDrawing"].some(type => part.type === relationships + "/" + type))
          records.push(record(await opc.document(part.target), part.target));
      }
      const visibility = attr(sheetNode, "state");
      const sheetView = child(child(source, "sheetViews"), "sheetView");
      const viewAttributes: Record<string, ImportedValue> = {};
      for (const [source, target, invert] of [["showFormulas", "DisplayFormulas", false], ["showZeros", "HideZero", true],
        ["showGridLines", "HideGrid", true], ["showRowColHeaders", "HideColHeader", true], ["showRowColHeaders", "HideRowHeader", true],
        ["showOutlineSymbols", "DisplayOutlines", false], ["rightToLeft", "RTL_Layout", false]] as const) {
        const value = attr(sheetView, source); if (value !== undefined) viewAttributes[target] = (invert ? !boolean(value) : boolean(value)) ? "1" : "0";
      }
      if (child(source, "sheetProtection")) viewAttributes.Protected = boolean(attr(child(source, "sheetProtection"), "sheet")) ? "1" : "0";
      sheets.push({ id, name, cells, size: { rows: 1048576, columns: 16384 },
        visibility: visibility === "hidden" ? "hidden" : visibility === "veryHidden" ? "very-hidden" : "visible", rows, columns,
        merges: children(child(source, "mergeCells"), "mergeCell").map(node => range(attr(node, "ref"))), formulaGroups: groups,
        view: { ...(child(source, "sheetViews") ? { xlsx: data(child(source, "sheetViews")!) } : {}),
          gnumeric: viewAttributes, ...(attr(sheetView, "zoomScale") === undefined ? {} : { zoom: number(attr(sheetView, "zoomScale")) / 100 }) },
        ...(records.length ? { unsupportedRecords: records } : {}) });
    }
    const names: NamedExpression[] = [];
    for (const node of children(child(workbook, "definedNames"), "definedName")) {
      const importedName = attr(node, "name"); if (!importedName) continue;
      const name = importedName.startsWith("_xlnm.") ? importedName.slice(6) : importedName;
      if (importedName.startsWith("_xlnm.") && name === "Print_Area" && node.text === "!#REF!") continue;
      const sheetIndex = attr(node, "localSheetId"), sheet = sheetIndex === undefined ? undefined : sheets[integer(sheetIndex)];
      const position = { sheet: sheet?.id ?? sheets[0]?.id ?? "sheet-1", row: 0, column: 0 };
      if (node.text && !parseExpression("=" + node.text, { grammar: excelGrammar, position, signal: context.signal }).ok) {
        const message = `At A1: '${node.text}' Invalid expression\n`;
        await context.diagnostic?.({ code: "xlsx-name-expression", severity: "warning", message,
          bytes: warningBytes(message, context) }); continue;
      }
      const semantics = readFormulaSemantics(node);
      const imported = { name, expression: node.text ? formula(node.text, position.sheet, 0, 0, context, semantics.arrayStringLiterals) : "=#REF!", ...semantics, ...(sheet ? { sheet: sheet.id } : {}) };
      opc.charge(names.length);
      const existing = names.findIndex(n => n.name === name && n.sheet === sheet?.id);
      if (existing < 0) names.push(imported); else names[existing] = imported;
    }
    const calc = child(workbook, "calcPr"), properties = child(workbook, "workbookPr");
    const view = child(child(workbook, "bookViews"), "workbookView"), active = sheets[integer(attr(view, "activeTab"))];
    const documentProperties: Record<string, ImportedValue> = {};
    const coreRelation = rootRelations.find(r => !r.external && r.type === packageRelationships + "/metadata/core-properties");
    if (coreRelation) {
      const core = await recognize(await opc.document(coreRelation.target), "xlsx_docprops_core_dtd", context);
      const fields: Readonly<Record<string, string>> = { title: "dc:title", subject: "dc:subject", description: "dc:description", creator: "meta:initial-creator", language: "dc:language",
        lastModifiedBy: "dc:creator", lastPrinted: "meta:print-date", created: "meta:creation-date", modified: "dc:date", revision: "meta:editing-cycles" };
      for (const node of core.children) {
        if (!["XL_NS_PROP_CP", "XL_NS_PROP_DC", "XL_NS_PROP_DCTERMS"].some(ns => xlsxNamespaces[ns]?.includes(node.namespace))) continue;
        const key = fields[node.localName]; if (key && node.text) documentProperties[key] = node.text;
        if (node.localName === "keywords" && node.text) documentProperties["dc:keywords"] = node.text.split(" ").filter(Boolean);
      }
    }
    return { sheets, names, dateSystem: boolean(attr(properties, "date1904")) || attr(properties, "date1904") === "on" ? "1904" : "1900",
      calculationMode: attr(calc, "calcMode") === "manual" ? "manual" : "automatic",
      ...(calc ? { iteration: { enabled: boolean(attr(calc, "iterate")), maximum: integer(attr(calc, "iterateCount"), 100), tolerance: number(attr(calc, "iterateDelta"), 0.001) } } : {}),
      ...(active ? { activeSheet: active.id } : {}), ...(view ? { view: { xlsx: data(view) } } : {}),
      ...(Object.keys(documentProperties).length ? { properties: documentProperties } : {}),
      ...(workbookRecords.length ? { unsupportedRecords: workbookRecords } : {}) };
  } catch (error) { return translateFailure(error, context); }
}

/** Both native savers use transitional namespaces, but different edition handlers. */
export function createXlsxWriter(edition: "2006" | "2008"): NonNullable<import("./types.js").Codec["write"]> {
  return async (book, _options, context) => {
    context.signal.throwIfAborted();
    const { element: xml, charge } = createXlsxXml(context);
    // Preserve the codec's established coordinate diagnostic before the shared
    // snapshot rejects nonfinite numbers. Inspect data descriptors only: this
    // admission must never execute workbook accessors or traverse unbounded arrays.
    const suppliedSheets = Object.getOwnPropertyDescriptor(book, "sheets")?.value as unknown;
    if (Array.isArray(suppliedSheets) && suppliedSheets.length <= context.limits.sheets) {
      let cells = 0;
      for (let sheetIndex = 0; sheetIndex < suppliedSheets.length; sheetIndex++) {
        charge();
        const sheet = Object.getOwnPropertyDescriptor(suppliedSheets, String(sheetIndex))?.value as unknown;
        if (sheet === null || typeof sheet !== "object") continue;
        const suppliedCells = Object.getOwnPropertyDescriptor(sheet, "cells")?.value as unknown;
        if (!Array.isArray(suppliedCells)) continue;
        cells += suppliedCells.length;
        if (cells > context.limits.cells) break;
        for (let index = 0; index < suppliedCells.length; index++) {
          charge();
          const cell = Object.getOwnPropertyDescriptor(suppliedCells, String(index))?.value as unknown;
          if (cell === null || typeof cell !== "object") continue;
          const row = Object.getOwnPropertyDescriptor(cell, "row"), column = Object.getOwnPropertyDescriptor(cell, "column");
          if (row && column && Object.hasOwn(row, "value") && Object.hasOwn(column, "value") &&
            (![row.value, column.value].every(Number.isSafeInteger) || row.value < 0 || column.value < 0 || row.value >= 1048576 || column.value >= 16384))
            throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: XLSX cell outside writer sheet limits");
        }
      }
    }
    book = snapshotWorkbook(book, context.limits);
    if (book.sheets.length > context.limits.sheets) limit("sheets");
    let admittedCells = 0;
    for (const sheet of book.sheets) { charge(); admittedCells += sheet.cells.length; if (admittedCells > context.limits.cells) limit("cells"); }
    let missingCache = false;
    const missing = new Map<string, Set<Cell>>();
    const sheets = book.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell => {
      charge();
      if (!cell.formula || cell.cachedResult !== undefined || cell.value.kind !== "blank") return { ...cell, formulaDirty: false };
      missingCache = true;
      const cells = missing.get(sheet.id) ?? new Set<Cell>(); cells.add(cell); missing.set(sheet.id, cells);
      return { ...cell, formulaDirty: true };
    }) }));
    if (missingCache) {
      const calculated = recalculateWorkbook({ ...book, calculationMode: "automatic", sheets }, context);
      book = { ...book, sheets: book.sheets.map((sheet, index) => {
        const values = new Map(calculated.sheets[index]!.cells.map(cell => { charge(); return [`${cell.row}:${cell.column}`, cell] as const; }));
        return { ...sheet, cells: sheet.cells.map(cell => {
          charge();
          return missing.get(sheet.id)?.has(cell) ? values.get(`${cell.row}:${cell.column}`) ?? cell : cell;
        }) };
      }) };
    }
    const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    const styles = createXlsxStyles(xml, edition, namespace, charge);
    const zip = createZipCodec(); const bounds = { ...zipLimits(context), maxArchiveBytes: context.limits.outputBytes,
      maxEntryBytes: context.limits.outputBytes, maxTotalBytes: context.limits.outputBytes, maxTextBytes: context.limits.outputBytes };
    const entries: ZipEntry[] = [], types: { name: string; type: string }[] = [
      { name: "xl/workbook.xml", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" }
    ];
    const encoder = new TextEncoder(); let plainBytes = 0;
    const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const modified = new Date(context.clock?.now() ?? Date.UTC(2000, 0, 1));
    async function add(name: string, content: string, type?: string): Promise<void> {
      context.signal.throwIfAborted(); charge(content.length);
      const length = encoder.encode(declaration + content + "\n").length;
      if (length > context.limits.outputBytes - plainBytes) limit("output bytes");
      if (entries.length >= bounds.maxMembers) limit("members");
      plainBytes += length;
      entries.push(await zip.makeZipEntry(name, encoder.encode(declaration + content + "\n"),
        { modified, mode: 0o644, directory: false, symlink: false, compression: "deflate" }, bounds, context.signal));
      if (type) types.push({ name, type });
    }
    const relationshipXml = (items: readonly { id: string; type: string; target: string; external?: boolean }[]) =>
      xml("Relationships", { xmlns: packageRelationships }, [...items].reverse().map(r => xml("Relationship", {
        Id: r.id, Type: r.type, Target: r.target, ...(r.external ? { TargetMode: "External" } : {}) })).join(""));
    const workbookRelations: { id: string; type: string; target: string }[] = [];
    const shared: Cell[] = [], sharedIds = new Map<string, number>(), stringCounts = new Map<string, number>();
    let totalCells = 0;
    for (const sheet of book.sheets) for (const cell of sheet.cells) {
      charge(); if (++totalCells > context.limits.cells) limit("cells");
      const value = cell.formula ? cell.cachedResult ?? cell.value : cell.value;
      if (value.kind === "string") { const key = JSON.stringify([value.value, cell.richText ?? []]); stringCounts.set(key, (stringCounts.get(key) ?? 0) + 1); }
    }
    if (book.sheets.length > context.limits.sheets) limit("sheets");
    const active = Math.max(0, book.sheets.findIndex(sheet => sheet.id === book.activeSheet));
    const sheetNodes: string[] = [];
    for (const [index, sheet] of book.sheets.entries()) {
      context.signal.throwIfAborted();
      types.push({ name: `xl/worksheets/sheet${index + 1}.xml`, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" });
      const rows = Math.min(sheet.size?.rows ?? 65536, 1048576), columns = Math.min(sheet.size?.columns ?? 256, 16384);
      const validateRange = (r: Range) => {
        charge();
        if (![r.startRow, r.endRow, r.startColumn, r.endColumn].every(Number.isSafeInteger) || r.startRow < 0 || r.startColumn < 0 || r.endRow < r.startRow || r.endColumn < r.startColumn || r.endRow >= rows || r.endColumn >= columns)
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: XLSX range outside writer sheet limits");
      };
      for (const r of sheet.merges ?? []) validateRange(r);
      for (const group of sheet.formulaGroups ?? []) validateRange(group.range);
      for (const [axis, maximum] of [[sheet.rows ?? [], rows], [sheet.columns ?? [], columns]] as const)
        for (const info of axis) if (!Number.isSafeInteger(info.index) || info.index < 0 || info.index >= maximum)
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: XLSX axis outside writer sheet limits");
      for (const cell of sheet.cells) if (!Number.isSafeInteger(cell.row) || !Number.isSafeInteger(cell.column) || cell.row >= rows || cell.column >= columns || cell.row < 0 || cell.column < 0)
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: XLSX cell outside writer sheet limits");
      const addresses = new Map(sheet.cells.map(c => [`${c.row}:${c.column}`, c]));
      let columnDefaultStyle = 0;
      for (const record of sheet.unsupportedRecords ?? []) if (record.kind === "Styles") {
        const source = metadataNode(record.data, charge);
        for (const region of source?.children ?? []) {
          const a = region.attributes, node = region.children.find(n => n.name === "Style"); if (!node) continue;
          const r = { startRow: Number(a.startRow), endRow: Number(a.endRow), startColumn: Number(a.startCol), endColumn: Number(a.endCol) };
          validateRange(r);
          // A full-sheet baseline belongs on columns, rather than millions of empty cells.
          if (r.startRow === 0 && r.startColumn === 0 && r.endRow === rows - 1 && r.endColumn === columns - 1) {
            columnDefaultStyle = styles.register({ style: { gnumeric: node as unknown as ImportedValue } }); continue;
          }
          const count = (r.endRow - r.startRow + 1) * (r.endColumn - r.startColumn + 1);
          if (count > context.limits.cells) limit("styled cells");
          charge(count);
          for (let row = r.startRow; row <= r.endRow; row++) for (let column = r.startColumn; column <= r.endColumn; column++) {
            const key = `${row}:${column}`;
            if (!addresses.has(key)) {
              if (++totalCells > context.limits.cells) limit("styled cells");
              addresses.set(key, { row, column, value: { kind: "blank" }, format: a.Format ?? node.attributes.Format ?? "General", style: { gnumeric: region.children.find(n => n.name === "Style") as unknown as ImportedValue } });
            }
          }
        }
      }
      const cells = [...addresses.values()].sort((a, b) => a.row - b.row || a.column - b.column);
      let endRow = 0, endColumn = 0, startRow = cells[0]?.row ?? 0, startColumn = columns - 1;
      for (const cell of cells) { endRow = Math.max(endRow, cell.row); endColumn = Math.max(endColumn, cell.column); startColumn = Math.min(startColumn, cell.column); }
      for (const merge of sheet.merges ?? []) { endRow = Math.max(endRow, merge.endRow); endColumn = Math.max(endColumn, merge.endColumn); startRow = Math.min(startRow, merge.startRow); startColumn = Math.min(startColumn, merge.startColumn); }
      for (const row of sheet.rows ?? []) { charge(); endRow = Math.max(endRow, row.index); }
      for (const column of sheet.columns ?? []) { charge(); endColumn = Math.max(endColumn, column.index); }
      if (!cells.length && !sheet.merges?.length) startColumn = 0;
      const rangeText = (r: Range) => formatA1(r.startRow, r.startColumn) + (r.startRow === r.endRow && r.startColumn === r.endColumn ? "" : ":" + formatA1(r.endRow, r.endColumn));
      const dimension = rangeText({ startRow, startColumn, endRow, endColumn });
      const rowGroups = new Map<number, Cell[]>();
      for (const cell of cells) { const group = rowGroups.get(cell.row) ?? []; group.push(cell); rowGroups.set(cell.row, group); }
      for (const row of sheet.rows ?? []) if (row.index <= endRow && !rowGroups.has(row.index)) rowGroups.set(row.index, []);
      let sheetData = "";
      const rowInfo = new Map((sheet.rows ?? []).map(r => [r.index, r]));
      for (const [row, group] of [...rowGroups].sort((a, b) => a[0] - b[0])) {
        const info = rowInfo.get(row); let content = "";
        for (const cell of group) {
          charge(); const value = cell.formula ? cell.cachedResult ?? cell.value : cell.value;
          const valueFormat = value.kind === "number" ? value.format : undefined;
          const style = cell.style || cell.format ? styles.register(cell) : valueFormat !== undefined ? styles.register(cell, columnDefaultStyle) : columnDefaultStyle;
          const stringKey = value.kind === "string" ? JSON.stringify([value.value, cell.richText ?? []]) : "";
          let type: string | undefined, body = "";
          charge(sheet.formulaGroups?.length ?? 0);
          const array = sheet.formulaGroups?.find(g => g.kind === "array" && g.range.startRow <= cell.row && g.range.endRow >= cell.row && g.range.startColumn <= cell.column && g.range.endColumn >= cell.column);
          if (cell.formula && (!array || cell.row === array.range.startRow && cell.column === array.range.startColumn))
            body += xml("f", { ...(array ? { t: "array", ref: rangeText(array.range) } : {}),
              ...formulaSemanticsAttributes(array?.arrayStringLiterals ?? cell.arrayStringLiterals, true) },
              escapeXlsx(exportXlsxFormula(cell.formula, sheet, cell.row, cell.column, context, array?.arrayStringLiterals ?? cell.arrayStringLiterals)));
          if (value.kind === "string") {
            if ((stringCounts.get(stringKey) ?? 0) > 1) {
              type = "s"; let id = sharedIds.get(stringKey);
              if (id === undefined) { id = shared.length; sharedIds.set(stringKey, id); shared.push({ ...cell, value }); }
              body += xml("v", {}, String(id));
            } else if (cell.formula) { type = "str"; body += xml("v", {}, escapeXlsx(value.value)); }
            else { type = "inlineStr"; body += xml("is", {}, writeRichString(value.value, cell.richText, xml, charge)); }
          } else if (value.kind !== "blank") {
            type = value.kind === "boolean" ? "b" : value.kind === "error" ? "e" : undefined;
            body += xml("v", {}, value.kind === "boolean" ? value.value ? "1" : "0" : value.kind === "number" ? gnumericNumber(value.value) : escapeXlsx(value.value));
          }
          content += xml("c", { r: formatA1(cell.row, cell.column), s: style !== columnDefaultStyle ? style : undefined, t: type }, body);
        }
        const importedRow = metadataNode(info?.style?.gnumeric, charge);
        sheetData += xml("row", { r: row + 1, spans: `${startColumn + 1}:${endColumn + 1}`,
          customHeight: info?.sizePoints === undefined || importedRow?.name === "RowInfo" && !Number(importedRow.attributes.HardSize) ? undefined : 1, ht: info?.sizePoints,
          collapsed: info?.collapsed ? 1 : undefined, hidden: info?.hidden ? 1 : undefined, outlineLevel: info?.outlineLevel || undefined }, content);
      }
      const view = sheet.view?.gnumeric && typeof sheet.view.gnumeric === "object" && !Array.isArray(sheet.view.gnumeric)
        ? sheet.view.gnumeric as Readonly<Record<string, ImportedValue>> : {};
      const viewAttrs: Record<string, string | number | undefined> = { workbookViewId: 0,
        zoomScale: typeof sheet.view?.zoom === "number" && sheet.view.zoom !== 1 ? Math.round(sheet.view.zoom * 100) : undefined,
        tabSelected: index === active ? 1 : undefined };
      for (const [gnm, xlsx, invert] of [["DisplayFormulas", "showFormulas", false], ["HideZero", "showZeros", true], ["HideGrid", "showGridLines", true], ["HideColHeader", "showRowColHeaders", true], ["DisplayOutlines", "showOutlineSymbols", false], ["RTL_Layout", "rightToLeft", false]] as const)
        if (view[gnm] !== undefined) viewAttrs[xlsx] = (invert ? !Number(view[gnm]) : !!Number(view[gnm])) ? 1 : 0;
      let cols = "", nextColumn = 0;
      for (const c of [...sheet.columns ?? []].sort((a, b) => a.index - b.index)) {
        const importedColumn = metadataNode(c.style?.gnumeric, charge);
        if (c.index > nextColumn) cols += xml("col", { min: nextColumn + 1, max: c.index, style: columnDefaultStyle, width: 48 / ((130 / 18.5703125) * (72 / 96)) });
        cols += xml("col", { min: c.index + 1, max: c.index + 1,
          style: styleRecord(c.style) ? styles.register(c.style ? { style: c.style } : {}) : columnDefaultStyle,
          width: typeof c.style?.xlsxWidth === "number" ? c.style.xlsxWidth : (c.sizePoints ?? 48) / ((130 / 18.5703125) * (72 / 96)),
          customWidth: c.sizePoints === undefined || importedColumn?.name === "ColInfo" && !Number(importedColumn.attributes.HardSize) ? undefined : 1, hidden: c.hidden ? 1 : undefined, outlineLevel: c.outlineLevel || undefined, collapsed: c.collapsed ? 1 : undefined });
        nextColumn = c.index + 1;
      }
      if (nextColumn < columns) cols += xml("col", { min: nextColumn + 1, max: columns, style: columnDefaultStyle, width: 48 / ((130 / 18.5703125) * (72 / 96)) });
      const protection = xml("sheetProtection", { sheet: Number(view.Protected) ? 1 : undefined,
        formatCells: 0, formatColumns: 0, formatRows: 0, insertColumns: 0, insertRows: 0, insertHyperlinks: 0,
        deleteColumns: 0, deleteRows: 0, selectLockedCells: 1, sort: 0, autoFilter: 0, pivotTables: 0, selectUnlockedCells: 1 });
      const rels: { id: string; type: string; target: string; external?: boolean }[] = [];
      const metadata = await writeXlsxSheetMetadata(sheet, index + 1, xml, context, namespace, exportXlsxFormula, styles, charge);
      let legacyDrawing: string | undefined;
      for (const part of metadata.parts) {
        const id = `rId${rels.length + 1}`; rels.push({ id, type: relationships + "/" + part.relation, target: "../" + part.name });
        if (part.relation === "vmlDrawing") legacyDrawing = id;
        await add("xl/" + part.name, part.content, part.relation === "vmlDrawing" ? undefined : part.type);
      }
      let hyperlinks = "";
      for (const cell of cells) {
        const link = styleRecord(cell.style)?.children.find(n => n.name === "HyperLink"); if (!link) continue;
        let target = link.attributes.target; if (!target) continue;
        const isInternal = link.attributes.type === "GnmHLinkCurWB";
        const separator = target.indexOf("#"); const location = isInternal ? target : separator < 0 ? undefined : target.slice(separator + 1);
        if (!isInternal && separator >= 0) target = target.slice(0, separator);
        const id = `rId${rels.length + 1}`;
        if (!isInternal) rels.push({ id, type: relationships + "/hyperlink", target, external: true });
        hyperlinks += xml("hyperlink", { ref: formatA1(cell.row, cell.column), "r:id": isInternal ? undefined : id,
          location, tooltip: link.attributes.tip });
      }
      const sheetXml = xml("worksheet", { xmlns: namespace, "xmlns:r": relationships, "xmlns:gnmx": "http://www.gnumeric.org/ext/spreadsheetml" },
        xml("sheetPr", {}, xml("pageSetUpPr", { fitToPage: metadata.fitToPage ? 1 : 0 })) + xml("dimension", { ref: dimension }) +
        xml("sheetViews", {}, xml("sheetView", viewAttrs, xml("selection", { activeCell: "A1", sqref: "A1" }))) +
        xml("sheetFormatPr", { defaultColWidth: 48, defaultRowHeight: 12.75,
          outlineLevelRow: (sheet.rows ?? []).reduce((maximum, row) => { charge(); return Math.max(maximum, row.outlineLevel ?? 0); }, 0) || undefined,
          outlineLevelCol: (sheet.columns ?? []).reduce((maximum, column) => { charge(); return Math.max(maximum, column.outlineLevel ?? 0); }, 0) || undefined }) + xml("cols", {}, cols) + xml("sheetData", {}, sheetData) + protection +
        metadata.filters + (sheet.merges?.length ? xml("mergeCells", {}, sheet.merges.map(r => xml("mergeCell", { ref: rangeText(r) })).join("")) : "") +
        metadata.rules + (hyperlinks ? xml("hyperlinks", {}, hyperlinks) : "") + metadata.print + (legacyDrawing ? xml("legacyDrawing", { "r:id": legacyDrawing }) : ""));
      const partName = `worksheets/sheet${index + 1}.xml`;
      await add("xl/" + partName, sheetXml);
      if (rels.length) await add(`xl/worksheets/_rels/sheet${index + 1}.xml.rels`, relationshipXml(rels));
      const id = `rId${workbookRelations.length + 1}`; workbookRelations.push({ id, type: relationships + "/worksheet", target: partName });
      // Upstream writes no visibility attribute, even for hidden sheets.
      sheetNodes.push(xml("sheet", { name: sheet.name, sheetId: index + 1, "r:id": id }));
    }
    if (shared.length) {
      await add("xl/sharedStrings.xml", xml("sst", { xmlns: namespace, uniqueCount: shared.length, count: shared.length }, shared.map(cell =>
        xml("si", {}, writeRichString(cell.value.kind === "string" ? cell.value.value : "", cell.richText, xml, charge))).join("")), "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml");
      workbookRelations.push({ id: `rId${workbookRelations.length + 1}`, type: relationships + "/sharedStrings", target: "sharedStrings.xml" });
    }
    await add("xl/styles.xml", styles.serialize(), "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml");
    workbookRelations.push({ id: `rId${workbookRelations.length + 1}`, type: relationships + "/styles", target: "styles.xml" });
    const properties = writeXlsxProperties(book, xml);
    await add("docProps/app.xml", properties.app, "application/vnd.openxmlformats-officedocument.extended-properties+xml");
    await add("docProps/core.xml", properties.core, "application/vnd.openxmlformats-package.core-properties+xml");
    await add("docProps/custom.xml", properties.custom, "application/vnd.openxmlformats-officedocument.custom-properties+xml");
    let names = "";
    for (const name of book.names ?? []) {
      charge(); const index = name.sheet === undefined ? -1 : book.sheets.findIndex(s => s.id === name.sheet);
      if (name.sheet !== undefined && index < 0) continue;
      const sheet = book.sheets[index < 0 ? 0 : index]; if (!sheet) continue;
      names += xml("definedName", { name: ["Print_Area", "Sheet_Title"].includes(name.name) ? "_xlnm." + name.name : name.name,
        localSheetId: index < 0 ? undefined : index, ...formulaSemanticsAttributes(name.arrayStringLiterals, true) },
        escapeXlsx(exportXlsxFormula(name.expression, sheet, name.position?.row ?? 0, name.position?.column ?? 0, context, name.arrayStringLiterals)));
    }
    for (const [index, sheet] of book.sheets.entries()) {
      for (const [name, expression] of [["Sheet_Title", '"' + sheet.name.split('"').join('""') + '"'], ["Print_Area", "#REF!"]])
        if (!book.names?.some(n => n.name === name && n.sheet === sheet.id))
          names += xml("definedName", { name: "_xlnm." + name, localSheetId: index }, escapeXlsx(expression!));
    }
    await add("xl/workbook.xml", xml("workbook", { xmlns: namespace, "xmlns:r": relationships },
      xml("fileVersion", { lastEdited: 4, lowestEdited: 4, rupBuild: 3820 }) + xml("workbookPr", { date1904: book.dateSystem === "1904" ? 1 : 0 }) +
      xml("bookViews", {}, xml("workbookView", { activeTab: active })) + xml("sheets", {}, sheetNodes.join("")) + xml("definedNames", {}, names) +
      xml("calcPr", { calcMode: book.calculationMode === "manual" ? "manual" : "auto", iterate: book.iteration?.enabled === false ? 0 : 1,
        iterateCount: book.iteration?.maximum ?? 100, iterateDelta: book.iteration?.tolerance ?? 0.001 }) +
      xml("webPublishing", { allowPng: 1, css: 0, ...(edition === "2006" ? { codePage: 1252 } : { characterSet: "UTF-8" }) })));
    await add("xl/_rels/workbook.xml.rels", relationshipXml(workbookRelations));
    // libgsf visits sibling package children in reverse creation order, including directories.
    interface ContentNode { type?: string; children: Map<string, ContentNode>; }
    const contentTree = new Map<string, ContentNode>();
    for (const part of types) {
      let tree = contentTree; const components = part.name.split("/");
      for (const [index, component] of components.entries()) {
        let node = tree.get(component); if (!node) { node = { children: new Map() }; tree.set(component, node); }
        if (index === components.length - 1) node.type = part.type;
        tree = node.children;
      }
    }
    function overrides(tree: typeof contentTree, prefix = ""): string {
      let result = "";
      for (const [name, node] of [...tree].reverse()) {
        const path = prefix + "/" + name;
        result += node.type ? xml("Override", { PartName: path, ContentType: node.type }) : overrides(node.children, path);
      }
      return result;
    }
    await add("[Content_Types].xml", xml("Types", { xmlns: "http://schemas.openxmlformats.org/package/2006/content-types" },
      [["rels", "application/vnd.openxmlformats-package.relationships+xml"], ["xlbin", "application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"], ["xml", "application/xml"], ["vml", "application/vnd.openxmlformats-officedocument.vmlDrawing"]].map(([Extension, ContentType]) => xml("Default", { Extension, ContentType })).join("") +
      overrides(contentTree)));
    await add("_rels/.rels", relationshipXml([
      { id: "rId1", type: relationships + "/officeDocument", target: "xl/workbook.xml" },
      { id: "rId2", type: relationships + "/extended-properties", target: "docProps/app.xml" },
      { id: "rId3", type: packageRelationships + "/metadata/core-properties", target: "docProps/core.xml" },
      { id: "rId4", type: relationships + "/custom-properties", target: "docProps/custom.xml" }
    ]));
    for (const record of book.unsupportedRecords ?? []) {
      const node = metadataNode(record.data, charge);
      const office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0", meta = "urn:oasis:names:tc:opendocument:xmlns:meta:1.0";
      if (record.kind === "document-meta" && node?.namespace === office && node.children.length === 1 &&
        node.children[0]?.name === "meta" && node.children[0].namespace === office && node.children[0].children.every(field => {
          charge();
          if (field.children.length) return false;
          const key = field.namespace === meta ? field.name === "user-defined" ? field.attributes.name : field.name === "keyword" ? "dc:keywords" : "meta:" + field.name
            : field.namespace === "http://purl.org/dc/elements/1.1/" ? "dc:" + field.name : undefined;
          return key !== undefined && properties.exportedKeys.has(key);
        })) continue;
      await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning",
        message: `XLSX writer does not export workbook record '${record.kind}'` });
    }
    context.signal.throwIfAborted();
    try { return await zip.writeZipArchive({ entries, comment: new Uint8Array() }, bounds, context.signal); }
    catch (error) { context.signal.throwIfAborted(); if (error instanceof CodecError && error.code === "resource-limit") limit("output package"); throw error; }
  };
}
function exportXlsxFormula(source: string, sheet: Sheet, row: number, column: number, context: CapabilityContext, arrayStringLiterals = false): string {
  const position = { sheet: sheet.id, row, column };
  const parsed = parseExpression(source.startsWith("=") ? source : "=" + source, { grammar: gnumericGrammar, position, arrayStringLiterals,
    signal: context.signal, maximumLength: context.limits.workbookTextBytes ?? context.limits.outputBytes,
    maximumNodes: context.limits.workbookNodes ?? 100000 });
  if (!parsed.ok) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: unparsed XLSX formula");
  const result = serializeExpression(parsed.document, excelGrammar, false, true);
  return result.startsWith("=") ? result.slice(1) : result;
}
