import { createWorksheetIndexes, type XlsxSharedFormula } from "./worksheet-indexes.js";
import { createWorksheetStorage } from "./worksheet-storage.js";
import { createSharedStringStorage } from "./shared-string-storage.js";
import { writeXlsxTheme } from "./xlsx-theme.js";
import { writeXlsxWorkbookProtection } from "./xlsx-workbook-protection.js";
import type { Codec, WorkbookSource } from "@poe-code/spreadsheet-engine/codecs/types";
import { ownWorkbookSource } from "@poe-code/spreadsheet-engine/workbook/source";
import { IntegerTable } from "@poe-code/safe-fs/storage";
import { foldSheetName } from "@poe-code/spreadsheet-ast/case-fold";
import { XlsxExternalLinkWriter } from "./external-link-export.js";
import { resolveExternalLinks } from "./external-links.js";
import { encodeTextStream } from "@poe-code/spreadsheet-engine/encoding/encode-stream";
import { createStoredZipEntries, ZipStorageFailure, ZipWriteChain, ZipDirectoryIndex } from "@poe-code/office-package";
import { ownedRangeSource } from "@poe-code/spreadsheet-engine/range-input";
import { createZipCodec, CodecError, type ZipLimits, type ZipEntry, type ZipStreamEntry, type ZipSource } from "@poe-code/office-package";
import { expandIndexSheetAreas } from "@poe-code/spreadsheet-engine/formulas/index-sheet-areas";
import { parseXmlStream, XmlLimitError, type XmlElement, type XmlContent, type XmlStreamLimits } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext, type RangeSource } from "@poe-code/spreadsheet-engine/contracts";
import { parseA1, formatA1, type Cell, type CellValue, type Workbook, type Sheet, type Range, type RichTextRun,
  type ImportedValue, type AxisMetadata, type FormulaGroup, type NamedExpression, type UnsupportedRecord } from "@poe-code/spreadsheet-ast";
import { parseExpression } from "@poe-code/spreadsheet-engine/formulas/parser";
import { excelGrammar, gnumericGrammar } from "@poe-code/spreadsheet-engine/formulas/conventions";
import { quoteFormulaString, serializeExpression } from "@poe-code/spreadsheet-engine/formulas/serialization";
import { rewriteReferences, visitFormula } from "@poe-code/spreadsheet-engine/formulas/rewriting";
import { xlsxSchemas, xlsxNamespaces, xlsxNamespaceScanElements, type XlsxSchemaNode } from "./xlsx-schema.js";
import { converterLocale } from "@poe-code/spreadsheet-engine/locale/runtime";
import { readXlsxMetadata, readXlsxComments, gnode } from "./xlsx-metadata.js";
import { xlsxColumnWidthPoints, xlsxProtectionDefaults, xlsxPasswordAlgorithmFields } from "./xlsx-sheet-settings.js";
import { readXlsxStyles, readXlsxString } from "./xlsx-styles.js";
import { decodeXlsxString, encodeXlsxString } from "@poe-code/spreadsheet-engine/codecs/xlsx-strings";
import { createXlsxXml, escapeXlsx, writeRichString, metadataNode, type Attributes } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { snapshotXlsxWorkbook } from "./xlsx-write-input.js";
import { createXlsxStyles, styleRecord } from "./xlsx-write-styles.js";
import { writeXlsxSheetMetadata, writeXlsxProperties } from "./xlsx-write-metadata.js";
import { gnumericNumber } from "@poe-code/spreadsheet-engine/codecs/gnumeric-number";
import { recalculateWorkbook } from "@poe-code/spreadsheet-engine/formulas/evaluator";
import { formulaSemanticsAttributes, readFormulaSemantics, readOpenFormula } from "./formula-semantics.js";

const standardErrors = new Set(["#NAME?", "#REF!", "#VALUE!", "#NUM!", "#DIV/0!", "#N/A", "#NULL!"]);

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
async function recognize(root: XmlElement, schema: string, context: CapabilityContext,
  streamed?: { children(root: XmlElement): AsyncIterable<XmlElement>; stage(parent: XmlElement, node: XmlElement): Promise<boolean>; complete?(parent: XmlElement, node: XmlElement): void }): Promise<XmlElement> {
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
    // Streamed records serialize ordered content. Keep it aligned with the
    // recognized children rather than retaining rejected raw descendants.
    const content: XmlContent[] | undefined = streamed ? [] : undefined;
    let contentAt = 0;
    for await (const item of streamed ? streamed.children(node) : node.children) {
      if (content) {
        while (contentAt < node.content.length && node.content[contentAt] !== item) content.push(node.content[contentAt++]!);
        contentAt++;
      }
      const child = await visit(item, match[1], [...ancestors, node.localName], namespace);
      if (child && !(await streamed?.stage(node, child))) { accepted.push(child); content?.push(child); }
    }
    if (content) while (contentAt < node.content.length) content.push(node.content[contentAt++]!);
    const result = { ...node, ...(content ? { content } : {}), namespace: xlsxNamespaces[match[2]]?.[0] ?? node.namespace, children: accepted,
      attributes: node.attributes.map(attribute => {
        const colon = attribute.name.indexOf(":");
        const key = colon < 0 ? undefined : prefixes.get(attribute.name.slice(0, colon));
        return key ? { ...attribute, namespace: xlsxNamespaces[key]![0]! } : attribute;
      }) };
    streamed?.complete?.(node, result);
    return result;
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
    maxTotalBytes: Math.min(context.limits.inputBytes, context.limits.inflatedBytes ?? context.limits.inputBytes), maxMembers: context.limits.zipEntries ?? context.limits.workbookNodes ?? Infinity,
    maxPathBytes: Infinity, maxDepth: context.limits.xmlDepth ?? Infinity, maxPaxBytes: context.limits.inputBytes,
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

async function openPackage(bytes: Uint8Array | RangeSource, context: CapabilityContext) {
  context.signal.throwIfAborted();
  const bounds = zipLimits(context); const zip = createZipCodec(undefined, { rejectDuplicateNames: true, zip64: true });
  let source: ZipSource | undefined;
  if (!(bytes instanceof Uint8Array)) {
    const read = bytes.read.bind(bytes);
    source = ownedRangeSource({ size: bytes.size, async read(position, maximum, options) {
      try { return await read(position, maximum, options); }
      catch (error) { throw new ZipStorageFailure(error); }
    } }, context.signal, () => context.signal.throwIfAborted(), context.own);
  }
  const admit = (entry: ZipEntry | ZipStreamEntry) => {
    const compressedSize = "compressedSize" in entry ? entry.compressedSize : entry.data.length;
    if (entry.size > (context.limits.zipRatio ?? Infinity) * Math.max(1, compressedSize)) limit("ZIP ratio");
    if (entry.directory) return false;
    if (entry.symlink || path("", entry.name) !== entry.name) invalid("noncanonical package member");
    return true;
  };
  let entries: { get(name: string): ZipEntry | ZipStreamEntry | undefined | Promise<ZipStreamEntry | undefined> };
  let close = async () => {};
  if (source && context.createWorkingStorage) {
    const stored = createStoredZipEntries(context.createWorkingStorage.bind(context), source);
    close = stored.close;
    try {
      await zip.readZipArchive(source, bounds, context.signal, {
        storage: stored.storage, async onEntry(entry) { if (admit(entry)) await stored.set(entry); }
      });
    } catch (error) { await close(); throw error; }
    entries = stored;
  } else {
    const archive = source ? await zip.readZipArchive(source, bounds, context.signal) :
      await zip.readZipArchive(bytes as Uint8Array, bounds, context.signal);
    const retained = new Map<string, ZipEntry | ZipStreamEntry>();
    for (const entry of archive.entries) if (admit(entry)) retained.set(entry.name, entry);
    entries = retained;
  }
  let decodedBytes = 0, nodes = 0, textBytes = 0;
  let packageWork = 0;
  const maximumWork = context.limits.workbookWork ?? Infinity;
  function charge(amount: number): void {
    context.signal.throwIfAborted();
    if (amount > maximumWork - packageWork) limit("work"); packageWork += amount;
  }
  const documents = new Map<string, { root: XmlElement; restore?: (root: XmlElement) => Promise<XmlElement>; restored?: XmlElement }>();
  async function document(name: string, streamElements?: XmlStreamLimits["streamElements"], restore?: (root: XmlElement) => Promise<XmlElement>): Promise<XmlElement> {
    context.signal.throwIfAborted();
    const cached = documents.get(name);
    if (cached) {
      if (!streamElements && cached.restore) return cached.restored ??= await cached.restore(cached.root);
      return cached.root;
    }
    const entry = await entries.get(name); if (!entry) return invalid(`missing part '${name}'`);
    const xmlLimits = { ...(streamElements ? { streamElements } : {}), expectedEncoding: "UTF-8" as "UTF-8" | "UTF-16LE" | "UTF-16BE",
      maxDepth: context.limits.xmlDepth ?? Infinity,
      maxNodes: (context.limits.workbookNodes ?? Infinity) - nodes,
      maxAttributes: context.limits.workbookNodes ?? Infinity, maxTextLength: bounds.maxTextBytes,
      onElement() { nodes++; charge(1); } };
    async function* text() {
      const prefix = new Uint8Array(2); let length = 0, decoder: TextDecoder | undefined;
      for await (const bytes of zip.decodeZipEntry(entry!, bounds, context.signal)) {
        if (bytes.length > bounds.maxTotalBytes - decodedBytes) limit("decoded bytes");
        decodedBytes += bytes.length;
        if (bytes.length > (context.limits.workbookTextBytes ?? bounds.maxTotalBytes) - textBytes) limit("XML text");
        textBytes += bytes.length;
        let offset = 0;
        if (!decoder) {
          while (length < 2 && offset < bytes.length) prefix[length++] = bytes[offset++]!;
          if (length < 2) continue;
          if (prefix[0] === 255 && prefix[1] === 254 || prefix[0] === 60 && prefix[1] === 0) xmlLimits.expectedEncoding = "UTF-16LE";
          if (prefix[0] === 254 && prefix[1] === 255 || prefix[0] === 0 && prefix[1] === 60) xmlLimits.expectedEncoding = "UTF-16BE";
          decoder = new TextDecoder(xmlLimits.expectedEncoding, { fatal: true });
          yield decoder.decode(prefix, { stream: true });
        }
        yield decoder.decode(bytes.subarray(offset), { stream: true });
      }
      yield decoder ? decoder.decode() : new TextDecoder("UTF-8", { fatal: true }).decode(prefix.subarray(0, length));
    }
    let parserWork = 0, pendingUnits = 0;
    const result = await parseXmlStream(text(), xmlLimits, async units => {
      // Admit both normalization and tokenization, independently of ZIP/range
      // chunk boundaries. Node construction is charged by onElement above.
      pendingUnits += units * 2;
      charge(Math.floor(pendingUnits / 512)); pendingUnits %= 512;
      if (units && ++parserWork % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
    if (pendingUnits) charge(1);
    documents.set(name, { root: result, ...(streamElements && restore ? { restore } : {}) }); return result;
  }

  async function relations(base: string): Promise<readonly Relationship[]> {
    const slash = base.lastIndexOf("/");
    const name = base ? base.slice(0, slash + 1) + "_rels/" + base.slice(slash + 1) + ".rels" : "_rels/.rels";
    if (!await entries.get(name)) return [];
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
  return { entries, document, relations, charge, close };
}
function translateFailure(error: unknown, context: CapabilityContext): never {
  context.signal.throwIfAborted();
  if (error instanceof ZipStorageFailure) throw error.cause;
  if (error instanceof SyntaxError && error.message === "Invalid XML: DTD and entity declarations are forbidden")
    throw new SsconvertError("capability-denied", "ssconvert host denies XML DTD and entity declarations");
  if (error instanceof SsconvertError) throw error;
  if (error instanceof XmlLimitError || error instanceof CodecError && error.code === "resource-limit") limit("package");
  return invalid(error instanceof Error ? error.message : "invalid package");
}
export async function probeXlsx(bytes: Uint8Array | RangeSource, context: CapabilityContext): Promise<boolean> {
  // Native xlsx_file_probe checks member existence, without parsing workbook XML.
  try {
    const opc = await openPackage(bytes, context);
    try { return await opc.entries.get("xl/workbook.xml") !== undefined; }
    finally { await opc.close(); }
  }
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
function formula(source: string, sheet: string, row: number, column: number, context: CapabilityContext, arrayStringLiterals = false, externalLinks: ReadonlyMap<string, string | undefined> = new Map()): string {
  const parsed = parseExpression("=" + source, { maximumDepth: context.limits.formulaDepth, grammar: excelGrammar, position: { sheet, row, column }, arrayStringLiterals, signal: context.signal,
    maximumLength: context.limits.workbookTextBytes ?? context.limits.inputBytes, maximumNodes: context.limits.workbookNodes ?? Infinity });
  if (!parsed.ok) return "=" + source;
  const document = { ...parsed.document, root: resolveExternalLinks(parsed.document.root, externalLinks, context.signal) };
  let simpleSheets = true;
  visitFormula(document.root, node => {
    if (node.kind !== "reference") return;
    for (const name of [node.first.sheet, node.last?.sheet, node.first.workbook]) if (name !== undefined
      && (!name || [...name].some(c => !(c >= "A" && c <= "Z" || c >= "a" && c <= "z" || c >= "0" && c <= "9")))) simpleSheets = false;
  });
  return serializeExpression(document, simpleSheets ? { ...gnumericGrammar, unquotedSheets: true } : gnumericGrammar, false, true);
}
export async function readXlsx(bytes: Uint8Array | RangeSource, context: CapabilityContext): Promise<Workbook> {
  let close: (() => Promise<void>) | undefined;
  try {
    const opc = await openPackage(bytes, context);
    close = opc.close;
    const rootRelations = await opc.relations("");
    const workbookRelation = rootRelations.find(r => r.type === relationships + "/officeDocument");
    if (!workbookRelation || workbookRelation.external) throw new SsconvertError("io", "E No workbook stream found.");
    const workbookPath = workbookRelation.target;
    let workbook = await opc.document(workbookPath);
    if (workbook.localName !== "workbook" || !spreadsheetNamespaces.has(workbook.namespace)) return { sheets: [] };
    const workbookRelations = await opc.relations(workbookPath);
    const related = async (type: string, streamElements?: XmlStreamLimits["streamElements"]): Promise<XmlElement | undefined> => {
      const relation = workbookRelations.find(r => r.type === relationships + "/" + type);
      if (!relation) return undefined; if (relation.external) invalid(`external ${type} part`);
      return opc.document(relation.target, streamElements);
    };
    const storedStrings = context.createWorkingStorage ? createSharedStringStorage(context, namespace => spreadsheetNamespaces.has(namespace)) : undefined;
    const stringRelation = workbookRelations.find(relation => relation.type === relationships + "/sharedStrings");
    // A part used in another role may also be retained as opaque workbook metadata.
    // Keep that role's XML tree; its decoded shared-string values still use storage.
    const sharedRole = (relation: Relationship) => relation.target === stringRelation?.target && relation.type !== stringRelation?.type;
    const retainedStrings = workbookRelations.some(sharedRole) || rootRelations.some(sharedRole);
    let stringRoot = await related("sharedStrings", retainedStrings ? undefined : storedStrings?.streamElements); if (stringRoot) rootIs(stringRoot, "sst");
    if (stringRoot) stringRoot = await recognize(stringRoot, "xlsx_shared_strings_dtd", context, storedStrings);
    let theme = await related("theme"); if (theme) theme = await recognize(theme, "xlsx_theme_dtd", context);
    let styleRoot = await related("styles"); if (styleRoot) styleRoot = await recognize(styleRoot, "xlsx_styles_dtd", context);
    if (storedStrings) await storedStrings.decode();
    const strings = storedStrings ?? children(stringRoot, "si").map(node => readXlsxString(node, context));
    const cellStyles = await readXlsxStyles(styleRoot, theme, context);
    workbook = await recognize(workbook, "xlsx_workbook_dtd", context);
    const workbookRecords: UnsupportedRecord[] = children(workbook, "workbookProtection").map(node => record(node, workbookPath));
    const differentialStyles = child(styleRoot, "dxfs");
    if (differentialStyles) workbookRecords.push(record(differentialStyles, workbookRelations.find(relation => relation.type === relationships + "/styles")!.target));
    for (const type of ["theme", "externalLink", "pivotCacheDefinition"]) {
      for (const relation of workbookRelations.filter(r => r.type === relationships + "/" + type && !r.external))
        workbookRecords.push(record(await opc.document(relation.target), relation.target));
    }
    const externalLinks = new Map<string, string | undefined>();
    const externalDefinitions = new Map<string, { target: string; node: XmlElement }>();
    for (const reference of children(child(workbook, "externalReferences"), "externalReference")) {
      opc.charge(workbookRelations.length + 1);
      const id = attr(reference, "id", relationships);
      const relation = workbookRelations.find(item => item.id === id && item.type === relationships + "/externalLink" && !item.external);
      let target: string | undefined;
      if (relation) {
        const link = await opc.document(relation.target); rootIs(link, "externalLink");
        const book = child(link, "externalBook"), targetId = attr(book, "id", relationships);
        if (targetId !== undefined) {
          const relations = await opc.relations(relation.target);
          opc.charge(relations.length);
          target = relations.find(item => item.id === targetId && item.type === relationships + "/externalLinkPath" && item.external)?.target;
          if (target !== undefined) externalDefinitions.set(relation.target, { target, node: link });
        }
      }
      externalLinks.set(String(externalLinks.size + 1), target);
    }
    for (const [source, link] of externalDefinitions) {
      const externalBook = child(link.node, "externalBook");
      const sheets = children(child(externalBook, "sheetNames"), "sheetName").map(node => decodeXlsxString(attr(node, "val") ?? ""));
      const names: ImportedValue[] = [];
      for (const node of children(child(externalBook, "definedNames"), "definedName")) {
        const name = attr(node, "name"), refersTo = attr(node, "refersTo"), scope = attr(node, "sheetId");
        if (!name || !refersTo) continue;
        const index = scope === undefined ? undefined : Number(scope);
        if (index !== undefined && (!scope?.trim() || !Number.isSafeInteger(index) || index < 0 || index >= sheets.length)) continue;
        const sheet = index === undefined ? undefined : sheets[index];
        const expression = formula(decodeXlsxString(refersTo), sheet ?? sheets[0] ?? "", 0, 0, context, false, externalLinks);
        opc.charge(name.length + expression.length + (sheet?.length ?? 0) + 1);
        names.push({ name: decodeXlsxString(name), expression, ...(sheet === undefined ? {} : { sheet }) });
      }
      opc.charge(workbookRecords.length);
      const index = workbookRecords.findIndex(record => record.source === source && record.kind === "externalLink"), retained = workbookRecords[index];
      if ((names.length || sheets.length) && retained?.data && typeof retained.data === "object" && !Array.isArray(retained.data))
        workbookRecords[index] = { ...retained, data: { ...retained.data, externalNameDefinitions: { workbook: link.target, sheets, names } } };
    }
    const uniqueSheets = new Map<string, XmlElement>();
    for (const node of children(child(workbook, "sheets"), "sheet")) {
      const name = attr(node, "name");
      if (name === undefined) { await context.diagnostic?.({ code: "xlsx-sheet", severity: "warning", message: "Ignoring a sheet without a name" }); continue; }
      uniqueSheets.set(name, node);
    }
    const sheetNodes = [...uniqueSheets.values()];
    if (sheetNodes.length > context.limits.sheets) limit("sheets");
    const storedRows = context.createWorkingStorage ? createWorksheetStorage(context, namespace => spreadsheetNamespaces.has(namespace)) : undefined;
    const storedIndexes = context.createWorkingStorage ? createWorksheetIndexes(context) : undefined;
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
      let source = await opc.document(relation.target, storedRows?.streamElements, storedRows?.restore); rootIs(source, "worksheet");
      source = await recognize(source, "xlsx_sheet_dtd", context, storedRows);
      const sheetRelations = await opc.relations(relation.target);
      const cells: Cell[] = [], rows: AxisMetadata[] = [], columns: AxisMetadata[] = [], groups: FormulaGroup[] = [];
      const indexes = storedIndexes?.sheet();
      const cellIndexes = indexes?.cells ?? new Map<number, number>();
      const arrayGroups = new Map<string, FormulaGroup>();
      const shared = indexes?.shared ?? new Map<string, XlsxSharedFormula>();
      const columnStyles = children(child(source, "cols"), "col").filter(node => attr(node, "style") !== undefined)
        .map(node => ({ min: integer(attr(node, "min")) - 1, max: integer(attr(node, "max")) - 1, style: cellStyles[integer(attr(node, "style"))] }));
      const rowState = new Map<number, AxisMetadata>();
      const allocatedRowHeights = new Map<number, number>();
      const dimensions: Record<string, ImportedValue> = {};
      let defaultRowHeight = 12.75;
      let expandedRows = 0, nextRow = 0;
      function allocateRow(index: number) {
        opc.charge(1);
        if (allocatedRowHeights.has(index)) return;
        if (!rowState.has(index)) {
          if (++expandedRows > (context.limits.workbookNodes ?? Infinity)) limit("row metadata");
          rowState.set(index, { index });
        }
        allocatedRowHeights.set(index, defaultRowHeight);
      }
      for (const section of source.children) {
        if (!spreadsheetNamespaces.has(section.namespace)) continue;
        if (section.localName === "sheetFormatPr") {
          const width = attr(section, "defaultColWidth"), base = attr(section, "baseColWidth"), height = attr(section, "defaultRowHeight");
          for (const value of [width, base, height]) if (value !== undefined && number(value) < 0) invalid("negative default dimension");
          if (width !== undefined && number(width) > 0) dimensions.defaultColumnWidth = number(width) * xlsxColumnWidthPoints;
          else if (base !== undefined && number(base) > 0) dimensions.defaultColumnWidth = number(base) * xlsxColumnWidthPoints + 3.75;
          if (height !== undefined && number(height) > 0) dimensions.defaultRowHeight = defaultRowHeight = number(height);
          continue;
        }
        if (section.localName !== "sheetData") continue;
        for await (const row of storedRows ? storedRows.rows(section) : children(section, "row")) {
          const rowIndex = attr(row, "r") === undefined ? nextRow : integer(attr(row, "r")) - 1;
          if (rowIndex < 0 || rowIndex >= 1048576) invalid("invalid row"); nextRow = rowIndex + 1;
          const height = attr(row, "ht") === undefined ? undefined : number(attr(row, "ht"));
          if (++expandedRows > (context.limits.workbookNodes ?? Infinity)) limit("row metadata");
          opc.charge(1);
          let metadata: AxisMetadata = rowState.get(rowIndex) ?? { index: rowIndex, hidden: false, outlineLevel: 0, collapsed: false };
          if (height !== undefined && height > 0) metadata = { ...metadata, sizePoints: height,
            style: { gnumeric: gnode("RowInfo", { HardSize: boolean(attr(row, "customHeight")) ? 1 : 0 }) } };
          if (!allocatedRowHeights.has(rowIndex) && (height !== undefined && height > 0 || boolean(attr(row, "hidden")) ||
            attr(row, "outlineLevel") !== undefined && integer(attr(row, "outlineLevel")) >= 0)) allocatedRowHeights.set(rowIndex, defaultRowHeight);
          // Unlike columns, native rows change visibility before their outline.
          if (boolean(attr(row, "hidden")) && !metadata.hidden) {
            if ((metadata.outlineLevel ?? 0) > 0 && rowIndex < 1048575) {
              const adjacent = rowState.get(rowIndex + 1);
              if (!adjacent) {
                if (++expandedRows > (context.limits.workbookNodes ?? Infinity)) limit("row metadata");
                opc.charge(1);
              }
              if ((metadata.outlineLevel ?? 0) > (adjacent?.outlineLevel ?? 0)) {
                rowState.set(rowIndex + 1, { ...(adjacent ?? { index: rowIndex + 1 }), collapsed: true });
                if (!allocatedRowHeights.has(rowIndex + 1)) allocatedRowHeights.set(rowIndex + 1, defaultRowHeight);
              }
            }
            metadata = { ...metadata, hidden: true };
          }
          const outline = attr(row, "outlineLevel");
          if (outline !== undefined && integer(outline) >= 0) metadata = { ...metadata,
            outlineLevel: integer(outline), collapsed: boolean(attr(row, "collapsed")) };
          rowState.set(rowIndex, metadata);
          let nextColumn = 0;
          for (const node of children(row, "c")) {
            if (++cellCount > context.limits.cells) limit("cells"); context.signal.throwIfAborted();
            const position = attr(node, "r") ? parseA1(attr(node, "r")!) : { row: rowIndex, column: nextColumn };
            if (!position || position.row >= 1048576 || position.column >= 16384) invalid("invalid cell address"); nextColumn = position.column + 1;
            const raw = child(node, "v")?.text, type = attr(node, "t"), inline = child(node, "is");
            let value: CellValue = { kind: "blank" }, richText: readonly RichTextRun[] | undefined;
            if (type === "inlineStr") {
              if (inline) { const string = readXlsxString(inline, context); value = { kind: "string", value: string.value }; richText = string.richText; }
            }
            else if (type === "str" && raw !== undefined) value = { kind: "string", value: decodeXlsxString(raw) };
            else if (raw !== undefined && raw !== "") {
              if (type === "s") {
                const index = sharedStringIndex(raw), string = index === undefined ? undefined : Array.isArray(strings) ? strings[index] : await strings.get(index);
                if (string) { value = { kind: "string", value: string.value }; richText = string.richText; }
                else {
                  const message = `${name}!${formatA1(position.row, position.column)} : Invalid sst ref '${raw}'`;
                  await context.diagnostic?.({ code: "xlsx-shared-string", severity: "warning", message,
                    bytes: warningBytes(message + "\n", context) });
                }
              }
              else if (type === "b") value = { kind: "boolean", value: raw[0] !== "0" };
              else if (type === "e") value = { kind: "error", value: raw };
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
            const f = child(node, "f"); let expression: string | undefined, groupId: string | undefined, arrayRange: Range | undefined;
            let semantics = readFormulaSemantics(f);
            if (f) {
              const kind = attr(f, "t"), si = kind === "shared" ? attr(f, "si") : undefined;
              const existing = si === undefined ? undefined : await shared.get(si), ref = attr(f, "ref");
              if (existing && ref === undefined) {
                // Native followers reuse the parsed definition even if they contain text.
                semantics = existing.arrayStringLiterals ? { arrayStringLiterals: true } : {};
                const parsed = parseExpression(existing.expression, { maximumDepth: context.limits.formulaDepth, position: { sheet: id, row: existing.row, column: existing.column }, ...semantics, signal: context.signal });
                if (!parsed.ok) invalid("invalid shared formula");
                expression = rewriteReferences(parsed.document, { position: { sheet: id, ...position }, translation: "copy", signal: context.signal });
                const bounds = existing.range;
                if (bounds && position.row >= bounds.startRow && position.row <= bounds.endRow &&
                  position.column >= bounds.startColumn && position.column <= bounds.endColumn) groupId = existing.id;
              } else {
                const openFormula = readOpenFormula(f)?.source, source = decodeXlsxString(f.text);
                let start = 0;
                while (source[start] === " ") { opc.charge(1); start++; }
                if (openFormula === undefined && start === source.length) {
                  const address = formatA1(position.row, position.column);
                  const message = `${name}!${address} : At ${address}: '' Invalid expression`;
                  await context.diagnostic?.({ code: "xlsx-formula", severity: "warning", message,
                    bytes: warningBytes(message + "\n", context) });
                  expression = '=ERROR("")';
                } else expression = openFormula ?? formula(source, id, position.row, position.column, context, semantics.arrayStringLiterals, externalLinks);
                if (si !== undefined) {
                  const bounds = ref === undefined ? undefined : range(ref);
                  // Compact groups are anchored at their top-left; other definitions remain scalar.
                  if (bounds && bounds.startRow === position.row && bounds.startColumn === position.column) {
                    groupId = `shared-${si}-${cellCount}`;
                    groups.push({ id: groupId, kind: "shared", expression, range: bounds, ...semantics });
                  }
                  await shared.set(si, { expression, ...position, ...(groupId && bounds ? { id: groupId, range: bounds } : {}), ...semantics });
                } else if (kind === "array" && ref !== undefined) {
                  groupId = `array-${position.row}-${position.column}`; arrayRange = range(ref);
                }
              }
            }
            if (value.kind !== "blank" || expression !== undefined) allocateRow(position.row);
            if (expression !== undefined) {
              opc.charge(arrayGroups.size * 4);
              const arrays = [...arrayGroups.values()];
              if (arrayRange) {
                const target = arrayRange;
                const overlaps = arrays.filter(group => group.range.startRow <= target.endRow && group.range.endRow >= target.startRow &&
                  group.range.startColumn <= target.endColumn && group.range.endColumn >= target.startColumn);
                const splits = overlaps.some(group => group.range.startRow < target.startRow || group.range.endRow > target.endRow ||
                  group.range.startColumn < target.startColumn || group.range.endColumn > target.endColumn);
                if (splits) {
                  // Native array assignment refuses partitioning, then still assigns a supplied cache.
                  expression = undefined; groupId = undefined; arrayRange = undefined;
                } else {
                  for (const group of overlaps) arrayGroups.delete(group.id);
                  opc.charge(cells.length);
                  for (let index = 0; index < cells.length; index++) {
                    const cell = cells[index]!;
                    if (cell.row < target.startRow || cell.row > target.endRow || cell.column < target.startColumn || cell.column > target.endColumn) continue;
                    const { formula: ignoredFormula, cachedResult: ignoredCache, formulaDirty: ignoredDirty,
                      formulaGroup: ignoredGroup, arrayStringLiterals: ignoredSemantics, ...retained } = cell;
                    cells[index] = { ...retained, formulaGroup: groupId! };
                  }
                  arrayGroups.set(groupId!, { id: groupId!, kind: "array", expression, range: target, ...semantics });
                }
              } else {
                const array = arrays.find(group => group.range.startRow <= position.row && group.range.endRow >= position.row &&
                  group.range.startColumn <= position.column && group.range.endColumn >= position.column);
                if (array) {
                  if (array.range.startRow !== array.range.endRow || array.range.startColumn !== array.range.endColumn) {
                    // A scalar expression cannot replace one member of a multi-cell array.
                    if (style) {
                      const key = position.row * 16384 + position.column, index = await cellIndexes.get(key);
                      if (index === undefined) { await cellIndexes.set(key, cells.length); cells.push({ ...position, value: { kind: "blank" }, formulaGroup: array.id, ...style }); }
                      else cells[index] = { ...cells[index]!, ...style };
                    }
                    continue;
                  }
                  arrayGroups.delete(array.id);
                }
              }
            }
            if (arrayRange) for (let index = arrayRange.startRow; index <= arrayRange.endRow; index++) allocateRow(index);
            if (type === "inlineStr" && !inline && !f && expression === undefined && style === undefined) continue;
            const hasCache = type === "inlineStr" ? inline !== undefined
              : raw !== undefined && (raw !== "" || type === "str");
            const key = position.row * 16384 + position.column, index = await cellIndexes.get(key);
            const previous = index === undefined ? undefined : cells[index];
            let retained: Partial<Cell> = previous ?? {};
            const cache = hasCache ? value : previous?.value.kind === "blank" ? undefined : previous?.value;
            if (value.kind !== "blank" || hasCache) {
              const { richText: ignoredRichText, ...rest } = retained;
              retained = rest;
            }
            if (expression !== undefined) {
              const { formula: ignoredFormula, cachedResult: ignoredCache, formulaDirty: ignoredDirty,
                formulaGroup: ignoredGroup, arrayStringLiterals: ignoredSemantics, ...rest } = retained;
              retained = rest;
            }
            // A value-only record updates the existing cell without removing its expression.
            const cell: Cell = { ...(previous ? {} : cellStyles[0] ?? {}), ...retained, ...position,
              value: value.kind === "blank" && (expression === undefined || !hasCache) && previous ? previous.value : value,
              ...(expression === undefined ? previous?.formula && value.kind !== "blank" ? { cachedResult: value } : {}
                : { formula: expression, ...semantics, formulaDirty: arrayRange !== undefined || !hasCache, ...(cache === undefined ? {} : { cachedResult: cache }) }),
              ...(f && expression === undefined && !hasCache && previous?.formula ? { formulaDirty: true } : {}),
              ...(groupId ? { formulaGroup: groupId } : {}), ...(style ?? {}), ...(richText ? { richText } : {}) };
            if (index === undefined) { await cellIndexes.set(key, cells.length); cells.push(cell); }
            else cells[index] = cell;
          }
        }
      }
      let completeSharedGroups = groups;
      if (groups.length) {
        // A shared ref bounds explicitly recorded members; it does not create cells.
        // Keep compact rectangular groups only when every member still belongs to them.
        opc.charge(cells.length * 2 + groups.length * 3);
        const sharedRanges = new Map(groups.map(group => [group.id, group.range]));
        const sharedCounts = new Map<string, number>();
        for (const cell of cells) {
          const bounds = cell.formulaGroup && sharedRanges.get(cell.formulaGroup);
          if (bounds && cell.row >= bounds.startRow && cell.row <= bounds.endRow &&
            cell.column >= bounds.startColumn && cell.column <= bounds.endColumn) {
            sharedCounts.set(cell.formulaGroup!, (sharedCounts.get(cell.formulaGroup!) ?? 0) + 1);
          }
        }
        completeSharedGroups = groups.filter(group => sharedCounts.get(group.id) ===
          (group.range.endRow - group.range.startRow + 1) * (group.range.endColumn - group.range.startColumn + 1));
        const completeSharedIds = new Set(completeSharedGroups.map(group => group.id));
        for (let index = 0; index < cells.length; index++) {
          const cell = cells[index]!;
          if (cell.formulaGroup && sharedRanges.has(cell.formulaGroup) && !completeSharedIds.has(cell.formulaGroup)) {
            const { formulaGroup: ignoredGroup, ...retained } = cell;
            cells[index] = retained;
          }
        }
      }
      for (const metadata of rowState.values()) {
        const allocatedHeight = allocatedRowHeights.get(metadata.index);
        rows.push(metadata.sizePoints === undefined && allocatedHeight !== undefined && allocatedHeight !== defaultRowHeight
          ? { ...metadata, sizePoints: allocatedHeight, style: { gnumeric: gnode("RowInfo", { HardSize: 0 }) } } : metadata);
      }
      const columnState = new Map<number, AxisMetadata>();
      let expandedColumns = 0;
      for (const node of children(child(source, "cols"), "col")) {
        const min = integer(attr(node, "min")), max = integer(attr(node, "max"));
        if (min < 1 || max < min || max > 16384) invalid("invalid column span");
        const count = max - min + 1;
        if (count > (context.limits.workbookNodes ?? Infinity) - expandedColumns) limit("column metadata");
        expandedColumns += count;
        opc.charge(count);
        const width = attr(node, "width") === undefined ? undefined : number(attr(node, "width"));
        const sizePoints = width === undefined ? undefined : width * (130 / 18.5703125) * (72 / 96);
        const style = sizePoints === undefined || sizePoints <= 4 ? undefined : { xlsxWidth: width!, gnumeric: gnode("ColInfo", {
          HardSize: boolean(attr(node, "customWidth")) && !boolean(attr(node, "bestFit")) ? 1 : 0 }) };
        const outlineLevel = integer(attr(node, "outlineLevel"));
        for (let index = min - 1; index < max; index++) {
          const previous = columnState.get(index) ?? { index, hidden: false, outlineLevel: 0, collapsed: false };
          columnState.set(index, { ...previous,
            ...(outlineLevel > 0 ? { outlineLevel, collapsed: boolean(attr(node, "collapsed")) } : {}),
            ...(style === undefined ? {} : { sizePoints: sizePoints!, style }) });
        }
        // Native XLSX applies outlines before hiding. Only newly hidden columns
        // change adjacent summary markers; absent/false hidden never unhides.
        if (boolean(attr(node, "hidden"))) {
          opc.charge(count);
          let changed = false, previousOutline = 0;
          for (let index = min - 1; index < max; index++) {
            const column = columnState.get(index)!;
            const collapsed = changed && previousOutline > (column.outlineLevel ?? 0) ? false : column.collapsed ?? false;
            changed = !column.hidden;
            if (changed) previousOutline = column.outlineLevel ?? 0;
            columnState.set(index, { ...column, hidden: true, collapsed });
          }
          if (changed && max < 16384 && previousOutline > 0) {
            const adjacent = columnState.get(max);
            if (!adjacent) {
              if (expandedColumns >= (context.limits.workbookNodes ?? Infinity)) limit("column metadata");
              expandedColumns++; opc.charge(1);
            }
            if (previousOutline > (adjacent?.outlineLevel ?? 0)) {
              columnState.set(max, { ...(adjacent ?? { index: max }), collapsed: true });
            }
          }
        }
      }
      columns.push(...columnState.values());
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
      records.push(...readXlsxMetadata(source));
      if (comments) records.push(readXlsxComments(comments, context));
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
      const protection = child(source, "sheetProtection");
      const protectedAllow = protection ? Object.fromEntries(Object.entries(xlsxProtectionDefaults).map(([name, fallback]) =>
        [name, !(attr(protection, name) === undefined ? fallback : boolean(attr(protection, name)))])) : undefined;
      const password = attr(protection, "password");
      const protectedPasswordHash = protection && !xlsxPasswordAlgorithmFields.some(name => attr(protection, name) !== undefined)
        ? password === undefined ? 0 : password.length > 0 && password.length <= 4 &&
          [...password].every(character => "0123456789abcdefABCDEF".includes(character)) ? Number.parseInt(password, 16) : undefined
        : undefined;
      if (protection) viewAttributes.Protected = boolean(attr(child(source, "sheetProtection"), "sheet")) ? "1" : "0";
      sheets.push({ id, name, cells, size: { rows: 1048576, columns: 16384 },
        visibility: visibility === "hidden" ? "hidden" : visibility === "veryHidden" ? "very-hidden" : "visible", rows, columns,
        merges: children(child(source, "mergeCells"), "mergeCell").map(node => range(attr(node, "ref"))), formulaGroups: [...completeSharedGroups, ...arrayGroups.values()],
        view: { ...dimensions, ...(protectedPasswordHash === undefined ? {} : { protectedPasswordHash }), ...(protectedAllow ? { protectedAllow } : {}), ...(child(source, "sheetViews") ? { xlsx: data(child(source, "sheetViews")!) } : {}),
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
      const expression = decodeXlsxString(node.text);
      if (expression && !parseExpression("=" + expression, { maximumDepth: context.limits.formulaDepth, grammar: excelGrammar, position, signal: context.signal }).ok) {
        const message = `At A1: '${expression}' Invalid expression\n`;
        await context.diagnostic?.({ code: "xlsx-name-expression", severity: "warning", message,
          bytes: warningBytes(message, context) }); continue;
      }
      const semantics = readFormulaSemantics(node);
      const openFormula = readOpenFormula(node);
      const imported = { name, ...(openFormula?.position ? { position: { ...openFormula.position, sheet: sheets.find(s => s.name === openFormula.position!.sheet)?.id ?? openFormula.position.sheet } } : {}), expression: openFormula?.source ?? (expression ? formula(expression, position.sheet, 0, 0, context, semantics.arrayStringLiterals, externalLinks) : "=#REF!"), ...semantics, ...(sheet ? { sheet: sheet.id } : {}) };
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
  finally { await close?.(); }
}

/** Both native savers use transitional namespaces, but different edition handlers. */
export function createXlsxWriter(edition: "2006" | "2008"): NonNullable<import("@poe-code/spreadsheet-engine/codecs/types").Codec["write"]> {
  const stream = createXlsxStreamWriter(edition);
  return async (book, options, context) => {
    const chunks: Uint8Array[] = []; let length = 0;
    for await (const bytes of stream(book, options, context)) { chunks.push(bytes.slice()); length += bytes.length; }
    const result = new Uint8Array(length); let offset = 0;
    for (const bytes of chunks) { result.set(bytes, offset); offset += bytes.length; }
    return result;
  };
}

export function createXlsxStreamWriter(edition: "2006" | "2008"): NonNullable<Codec["writeStream"]> & NonNullable<Codec["writeWorkbookSource"]> {
  return async function* (input: Workbook | WorkbookSource, _options, context) {
    let storage: import("@poe-code/spreadsheet-engine/contracts").WorkingStorage | undefined;
    let closed = false, closing: Promise<void> | undefined, failure: { error: unknown } | undefined;
    const close = () => {
      closed = true;
      return closing ??= Promise.resolve().then(async () => { await storage?.close(); });
    };
    context.own(close);
    try {
    context.signal.throwIfAborted();
    const { element: xml, stream: xmlStream, charge } = createXlsxXml(context);
    const source = "metadata" in input ? await ownWorkbookSource(input, context.limits, () => context.signal.throwIfAborted()) : undefined;
    let book = snapshotXlsxWorkbook(source?.metadata ?? input as Workbook, context, charge);
    const suppliedCells = (sheet: Sheet) => source?.cells(sheet.id) ?? sheet.cells;
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
    const differentialRecord = book.unsupportedRecords?.find(record => record.kind === "dxfs" && metadataNode(record.data, charge)?.namespace === namespace);
    const differentialNode = metadataNode(differentialRecord?.data, charge);
    if (differentialNode && (differentialNode.name !== "dxfs" || Object.keys(differentialNode.attributes).some(key => key !== "count") || differentialNode.children.some(node => node.name !== "dxf")))
      throw new SsconvertError("unsupported-feature", "Unsupported XLSX differential style table");
    const styles = createXlsxStyles(xml, edition, namespace, charge, differentialNode?.children);
    const zip = createZipCodec(); const bounds = { ...zipLimits(context), maxArchiveBytes: context.limits.outputBytes,
      maxEntryBytes: context.limits.outputBytes, maxTotalBytes: context.limits.outputBytes, maxTextBytes: context.limits.outputBytes };
    if (closed) throw new SsconvertError("invalid-request", "XLSX writer is closed");
    storage = context.createWorkingStorage?.();
    if (closed) throw new SsconvertError("invalid-request", "XLSX writer is closed");
    const staged = storage ? zip.createStagedWriter(storage, bounds, context.signal) : undefined;
    let members = 0;
    const entries: ZipEntry[] = [], types: { name: string; type: string }[] = [
      { name: "xl/workbook.xml", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" }
    ];
    let plainBytes = 0;
    const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const modified = new Date(context.clock?.now() ?? Date.UTC(2000, 0, 1));
    async function add(name: string, content: string | AsyncIterable<Uint8Array>, type?: string): Promise<void> {
      context.signal.throwIfAborted();
      if (members >= bounds.maxMembers) limit("members");
      const attributes = { modified, mode: 0o644, directory: false, symlink: false, compression: "deflate" as const };
      async function* text() {
        yield declaration;
        if (typeof content === "string") { charge(content.length); yield content; }
        else {
          // Keep the existing UTF-16 work accounting while replaying staged UTF-8.
          const decoder = new TextDecoder();
          for await (const chunk of content) { charge(decoder.decode(chunk, { stream: true }).length); yield chunk; }
          charge(decoder.decode().length);
        }
        yield "\n";
      }
      async function* bytes() {
        for await (const chunk of encodeTextStream(text(), "UTF-8", false, context)) {
          if (chunk.length > context.limits.outputBytes - plainBytes) limit("output bytes");
          plainBytes += chunk.length; yield chunk;
        }
      }
      if (staged) await staged.addSource(name, bytes(), attributes);
      else {
        // Explicit SDK convenience when the caller supplies no working storage.
        const chunks: Uint8Array[] = []; let length = 0;
        for await (const chunk of bytes()) { chunks.push(chunk.slice()); length += chunk.length; }
        const payload = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.length; }
        entries.push(await zip.makeZipEntry(name, payload, attributes, bounds, context.signal));
      }
      members++;
      if (type) types.push({ name, type });
    }
    const relationshipXml = (items: readonly { id: string; type: string; target: string; external?: boolean }[]) =>
      xml("Relationships", { xmlns: packageRelationships }, [...items].reverse().map(r => xml("Relationship", {
        Id: r.id, Type: r.type, Target: r.target, ...(r.external ? { TargetMode: "External" } : {}) })).join(""));
    const workbookRelations: { id: string; type: string; target: string }[] = [];
    const externalLinks = new XlsxExternalLinkWriter(book, charge);
    // States 1/2 mean seen once/repeated; state >= 3 stores assigned ID + 3.
    // The same external key table serves both counting and stable ID lookup.
    const stringIndex = storage ? new ZipDirectoryIndex(storage, { maximumKeyLength: Infinity, signal: context.signal }) : new Map<string, number>();
    const shared: Cell[] = [];
    const sharedTape = storage ? new ZipWriteChain(storage, 16384, context.signal, async signal => { signal.throwIfAborted(); }) : undefined;
    const sharedBuffer = new Uint8Array(16384); let sharedBytes = 0, sharedTotal = 0;
    let sharedReferences = 0, sharedCount = 0;
    let totalCells = 0;
    const sourceCounts = source ? new Map<string, number>() : undefined;
    for (const sheet of book.sheets) {
      let count = 0;
      for await (const cell of suppliedCells(sheet)) {
        charge(); count++; if (++totalCells > context.limits.cells) limit("cells");
        const value = cell.formula ? cell.cachedResult ?? cell.value : cell.value;
        if (!cell.formula && value.kind === "string") {
          const key = JSON.stringify([value.value, cell.richText ?? []]), count = await stringIndex.get(key) ?? 0;
          if (count < 2) await stringIndex.set(key, count + 1);
        }
      }
      sourceCounts?.set(sheet.id, count);
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
      const addresses = storage ? new IntegerTable(storage, 128) : new Map<bigint, bigint>();
      const coordinate = (row: number, column: number) => BigInt(row) << 14n | BigInt(column);
      let inputCellCount = 0;
      for await (const cell of suppliedCells(sheet)) {
        context.signal.throwIfAborted();
        if (!Number.isSafeInteger(cell.row) || !Number.isSafeInteger(cell.column) || cell.row >= rows || cell.column >= columns || cell.row < 0 || cell.column < 0)
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: XLSX cell outside writer sheet limits");
        if (sourceCounts && inputCellCount >= sourceCounts.get(sheet.id)!)
          throw new SsconvertError("invalid-request", "XLSX source coordinates changed during replay");
        await addresses.set(coordinate(cell.row, cell.column), BigInt(inputCellCount++));
      }
      if (sourceCounts && inputCellCount !== sourceCounts.get(sheet.id))
        throw new SsconvertError("invalid-request", "XLSX source coordinates changed during replay");
      // Regions keep one template each. Their potentially millions of blank cells
      // are reconstructed from indexed coordinates during bounded traversal.
      const styled: Omit<Cell, "row" | "column">[] = [];
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
          const template = BigInt(inputCellCount + styled.length);
          styled.push({ value: { kind: "blank" }, format: a.Format ?? node.attributes.Format ?? "General", style: { gnumeric: node as unknown as ImportedValue } });
          for (let row = r.startRow; row <= r.endRow; row++) for (let column = r.startColumn; column <= r.endColumn; column++) {
            context.signal.throwIfAborted();
            const key = coordinate(row, column);
            if (await addresses.get(key) === undefined) {
              if (++totalCells > context.limits.cells) limit("styled cells");
              await addresses.set(key, template);
            }
          }
        }
      }
      async function* cells(): AsyncGenerator<Cell> {
        const entries = addresses instanceof Map ? [...addresses].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) : addresses.entries();
        const cursor = source?.cells(sheet.id)[Symbol.asyncIterator](); let read = 0;
        try {
          for await (const [key, value] of entries) {
            context.signal.throwIfAborted(); const index = Number(value);
            if (index >= inputCellCount) {
              yield { ...styled[index - inputCellCount]!, row: Number(key >> 14n), column: Number(key & 0x3fffn) };
            } else if (cursor) {
              const next = await cursor.next();
              if (next.done || index !== read++ || coordinate(next.value.row, next.value.column) !== key)
                throw new SsconvertError("invalid-request", "XLSX source coordinates changed during replay");
              yield next.value;
            } else yield sheet.cells[index]!;
          }
          if (cursor && !(await cursor.next()).done)
            throw new SsconvertError("invalid-request", "XLSX source coordinates changed during replay");
        } finally { await cursor?.return?.(); }
      }
      let endRow = 0, endColumn = 0, startRow = 0, startColumn = columns - 1, cellCount = 0;
      for await (const cell of cells()) {
        if (!cellCount++) startRow = cell.row;
        endRow = Math.max(endRow, cell.row); endColumn = Math.max(endColumn, cell.column); startColumn = Math.min(startColumn, cell.column);
      }
      for (const merge of sheet.merges ?? []) { endRow = Math.max(endRow, merge.endRow); endColumn = Math.max(endColumn, merge.endColumn); startRow = Math.min(startRow, merge.startRow); startColumn = Math.min(startColumn, merge.startColumn); }
      for (const row of sheet.rows ?? []) { charge(); endRow = Math.max(endRow, row.index); }
      for (const column of sheet.columns ?? []) { charge(); endColumn = Math.max(endColumn, column.index); }
      if (!cellCount && !sheet.merges?.length) startColumn = 0;
      const rangeText = (r: Range) => formatA1(r.startRow, r.startColumn) + (r.startRow === r.endRow && r.startColumn === r.endColumn ? "" : ":" + formatA1(r.endRow, r.endColumn));
      const dimension = rangeText({ startRow, startColumn, endRow, endColumn });
      const rowInfo = new Map((sheet.rows ?? []).map(r => [r.index, r]));
      async function* rowXml() {
        const rowKeys = [...rowInfo.keys()].filter(row => row <= endRow).sort((a, b) => a - b);
        const cursor = cells(); let next = await cursor.next(), axis = 0;
        try {
          while (!next.done || axis < rowKeys.length) {
            const row = Math.min(next.done ? Infinity : next.value.row, rowKeys[axis] ?? Infinity);
            if (rowKeys[axis] === row) axis++;
            const info = rowInfo.get(row);
            async function* content() {
              while (!next.done && next.value.row === row) {
                const cell = next.value;
                charge(); const value = cell.formula ? cell.cachedResult ?? cell.value : cell.value;
                const valueFormat = value.kind === "number" ? value.format : undefined;
                const style = cell.style || cell.format ? styles.register(cell) : valueFormat !== undefined ? styles.register(cell, columnDefaultStyle) : columnDefaultStyle;
                const stringKey = value.kind === "string" ? JSON.stringify([value.value, cell.richText ?? []]) : "";
                let type: string | undefined, body = "";
                charge(sheet.formulaGroups?.length ?? 0);
                const array = sheet.formulaGroups?.find(g => g.kind === "array" && g.range.startRow <= cell.row && g.range.endRow >= cell.row && g.range.startColumn <= cell.column && g.range.endColumn >= cell.column);
                if (cell.formula && (!array || cell.row === array.range.startRow && cell.column === array.range.startColumn))
                  body += xml("f", { ...(array ? { t: "array", ref: rangeText(array.range) } : {}),
                    ...formulaSemanticsAttributes(array?.arrayStringLiterals ?? cell.arrayStringLiterals, true, cell.formula) },
                    escapeXlsx(encodeXlsxString(exportXlsxFormula(book, cell.formula, sheet, cell.row, cell.column, context, array?.arrayStringLiterals ?? cell.arrayStringLiterals, externalLinks))));
                const stringState = !cell.formula && value.kind === "string" ? await stringIndex.get(stringKey) ?? 0 : 0;
                if (value.kind === "string") {
                  if (cell.formula) { type = "str"; body += xml("v", {}, escapeXlsx(encodeXlsxString(value.value))); }
                  else if (stringState >= 2) {
                    sharedReferences++;
                    type = "s"; const id = stringState >= 3 ? stringState - 3 : sharedCount++;
                    if (stringState === 2) {
                      await stringIndex.set(stringKey, id + 3);
                      if (sharedTape) {
                        const text = xml("si", {}, writeRichString(value.value, cell.richText, xml, charge));
                        async function* content() { yield text; }
                        for await (const bytes of encodeTextStream(content(), "UTF-8", false, context)) {
                          if (bytes.length > context.limits.outputBytes - sharedTotal) limit("output bytes");
                          sharedTotal += bytes.length;
                          for (let offset = 0; offset < bytes.length;) {
                            const take = Math.min(sharedBuffer.length - sharedBytes, bytes.length - offset);
                            sharedBuffer.set(bytes.subarray(offset, offset + take), sharedBytes);
                            sharedBytes += take; offset += take;
                            if (sharedBytes === sharedBuffer.length) { await sharedTape.append([sharedBuffer], sharedBytes); sharedBytes = 0; }
                          }
                        }
                      } else shared.push({ ...cell, value });
                    }
                    body += xml("v", {}, String(id));
                  } else { type = "inlineStr"; body += xml("is", {}, writeRichString(value.value, cell.richText, xml, charge)); }
                } else if (value.kind !== "blank") {
                  type = value.kind === "boolean" ? "b" : value.kind === "error" ? "e" : undefined;
                  body += xml("v", {}, value.kind === "boolean" ? value.value ? "1" : "0" : value.kind === "number" ? gnumericNumber(value.value) : escapeXlsx(standardErrors.has(value.value) ? value.value : "#" + quoteFormulaString(value.value, '"', gnumericGrammar)));
                }
                yield xml("c", { r: formatA1(cell.row, cell.column), s: style !== columnDefaultStyle ? style : undefined, t: type }, body);
                next = await cursor.next();
              }
            }
            const importedRow = metadataNode(info?.style?.gnumeric, charge);
            yield* xmlStream("row", { r: row + 1, spans: `${startColumn + 1}:${endColumn + 1}`,
              customHeight: info?.sizePoints === undefined || importedRow?.name === "RowInfo" && !Number(importedRow.attributes.HardSize) ? undefined : 1, ht: info?.sizePoints,
              collapsed: info?.collapsed ? 1 : undefined, hidden: info?.hidden ? 1 : undefined, outlineLevel: info?.outlineLevel || (info?.collapsed ? 0 : undefined) }, content());
          }
        } finally { await cursor.return(undefined); }
      }
      // Serialize rows before metadata to preserve style/shared-string registration
      // order. Only bounded encoded pieces stay resident while the tape is written.
      const rowTape = storage ? new ZipWriteChain(storage, 16384, context.signal, async signal => { signal.throwIfAborted(); }) : undefined;
      const bufferedRows: Uint8Array[] = [];
      const rowBuffer = new Uint8Array(16384); let rowBytes = 0;
      for await (const bytes of xmlStream("sheetData", {}, rowXml())) {
        if (!rowTape) { bufferedRows.push(bytes.slice()); continue; }
        for (let offset = 0; offset < bytes.length;) {
          const take = Math.min(rowBuffer.length - rowBytes, bytes.length - offset);
          rowBuffer.set(bytes.subarray(offset, offset + take), rowBytes);
          rowBytes += take; offset += take;
          if (rowBytes === rowBuffer.length) { await rowTape.append([rowBuffer], rowBytes); rowBytes = 0; }
        }
      }
      if (rowTape && rowBytes) await rowTape.append([rowBuffer.subarray(0, rowBytes)], rowBytes);
      async function* sheetData() {
        if (rowTape) yield* rowTape.read();
        else yield* bufferedRows;
      }
      const view = sheet.view?.gnumeric && typeof sheet.view.gnumeric === "object" && !Array.isArray(sheet.view.gnumeric)
        ? sheet.view.gnumeric as Readonly<Record<string, ImportedValue>> : {};
      const viewAttrs: Record<string, string | number | undefined> = { workbookViewId: 0,
        zoomScale: typeof sheet.view?.zoom === "number" && sheet.view.zoom !== 1 ? Math.round(sheet.view.zoom * 100) : undefined,
        tabSelected: index === active ? 1 : undefined };
      for (const [gnm, xlsx, invert] of [["DisplayFormulas", "showFormulas", false], ["HideZero", "showZeros", true], ["HideGrid", "showGridLines", true], ["HideColHeader", "showRowColHeaders", true], ["DisplayOutlines", "showOutlineSymbols", false], ["RTL_Layout", "rightToLeft", false]] as const)
        if (view[gnm] !== undefined) viewAttrs[xlsx] = (invert ? !Number(view[gnm]) : !!Number(view[gnm])) ? 1 : 0;
      const metadata = await writeXlsxSheetMetadata(sheet, index + 1, xml, context, namespace, exportXlsxFormula.bind(null, book), styles, charge, source?.cells(sheet.id));
      let cols = "", nextColumn = 0;
      let columnRun: { first: number; last: number; attributes: Attributes } | undefined;
      const appendColumn = (first: number, last: number, attributes: Attributes) => {
        charge(1 + Object.keys(attributes).length + (columnRun ? Object.keys(columnRun.attributes).length : 0));
        if (columnRun && columnRun.last + 1 === first &&
          Object.entries(attributes).every(([key, value]) => columnRun!.attributes[key] === value) &&
          Object.entries(columnRun.attributes).every(([key, value]) => attributes[key] === value)) {
          columnRun.last = last;
        } else {
          if (columnRun) cols += xml("col", { min: columnRun.first, max: columnRun.last, ...columnRun.attributes });
          columnRun = { first, last, attributes };
        }
      };
      for (const c of [...sheet.columns ?? []].sort((a, b) => a.index - b.index)) {
        const importedColumn = metadataNode(c.style?.gnumeric, charge);
        if (c.index > nextColumn) appendColumn(nextColumn + 1, c.index, { style: columnDefaultStyle, width: metadata.defaultColumnWidth / xlsxColumnWidthPoints });
        appendColumn(c.index + 1, c.index + 1, {
          style: styleRecord(c.style) ? styles.register(c.style ? { style: c.style } : {}) : columnDefaultStyle,
          width: typeof c.style?.xlsxWidth === "number" ? c.style.xlsxWidth : (c.sizePoints ?? metadata.defaultColumnWidth) / xlsxColumnWidthPoints,
          customWidth: c.sizePoints === undefined || importedColumn?.name === "ColInfo" && !Number(importedColumn.attributes.HardSize) ? undefined : 1, hidden: c.hidden ? 1 : undefined, outlineLevel: c.outlineLevel || undefined, collapsed: c.collapsed ? 1 : undefined });
        nextColumn = c.index + 1;
      }
      if (nextColumn < columns) appendColumn(nextColumn + 1, columns, { style: columnDefaultStyle, width: metadata.defaultColumnWidth / xlsxColumnWidthPoints });
      if (columnRun) cols += xml("col", { min: columnRun.first, max: columnRun.last, ...columnRun.attributes });
      const rels: { id: string; type: string; target: string; external?: boolean }[] = [];
      let legacyDrawing: string | undefined;
      for (const part of metadata.parts) {
        const id = `rId${rels.length + 1}`; rels.push({ id, type: relationships + "/" + part.relation, target: "../" + part.name });
        if (part.relation === "vmlDrawing") legacyDrawing = id;
        await add("xl/" + part.name, part.content, part.relation === "vmlDrawing" ? undefined : part.type);
      }
      let hyperlinks = "";
      for await (const cell of cells()) {
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
      async function* worksheet() {
        yield metadata.properties;
        yield xml("dimension", { ref: dimension });
        yield xml("sheetViews", {}, xml("sheetView", viewAttrs, xml("selection", { activeCell: "A1", sqref: "A1" })));
        yield metadata.format; yield xml("cols", {}, cols);
        yield* sheetData();
        yield metadata.protection; yield metadata.filters;
        if (sheet.merges?.length) yield xml("mergeCells", {}, sheet.merges.map(r => xml("mergeCell", { ref: rangeText(r) })).join(""));
        yield metadata.rules;
        if (hyperlinks) yield xml("hyperlinks", {}, hyperlinks);
        yield metadata.print;
        if (legacyDrawing) yield xml("legacyDrawing", { "r:id": legacyDrawing });
      }
      const sheetXml = xmlStream("worksheet", { xmlns: namespace, "xmlns:r": relationships, "xmlns:gnmx": "http://www.gnumeric.org/ext/spreadsheetml" }, worksheet());
      const partName = `worksheets/sheet${index + 1}.xml`;
      await add("xl/" + partName, sheetXml);
      if (rels.length) await add(`xl/worksheets/_rels/sheet${index + 1}.xml.rels`, relationshipXml(rels));
      const id = `rId${workbookRelations.length + 1}`; workbookRelations.push({ id, type: relationships + "/worksheet", target: partName });
      // Upstream writes no visibility attribute, even for hidden sheets.
      sheetNodes.push(xml("sheet", { name: sheet.name, sheetId: index + 1, "r:id": id }));
    }
    if (sharedCount) {
      if (sharedTape && sharedBytes) await sharedTape.append([sharedBuffer.subarray(0, sharedBytes)], sharedBytes);
      async function* strings() {
        if (sharedTape) { yield* sharedTape.read(); return; }
        for (const cell of shared) yield xml("si", {}, writeRichString(cell.value.kind === "string" ? cell.value.value : "", cell.richText, xml, charge));
      }
      await add("xl/sharedStrings.xml", xmlStream("sst", { xmlns: namespace, uniqueCount: sharedCount, count: sharedReferences }, strings()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml");
      workbookRelations.push({ id: `rId${workbookRelations.length + 1}`, type: relationships + "/sharedStrings", target: "sharedStrings.xml" });
    }
    await add("xl/styles.xml", styles.serialize(), "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml");
    workbookRelations.push({ id: `rId${workbookRelations.length + 1}`, type: relationships + "/styles", target: "styles.xml" });
    const theme = writeXlsxTheme(book, xml, charge);
    if (theme) {
      await add("xl/theme/theme1.xml", theme.content, "application/vnd.openxmlformats-officedocument.theme+xml");
      workbookRelations.push({ id: `rId${workbookRelations.length + 1}`, type: relationships + "/theme", target: "theme/theme1.xml" });
    }
    const properties = writeXlsxProperties(book, xml);
    const protection = writeXlsxWorkbookProtection(book, xml, charge);
    await add("docProps/app.xml", properties.app, "application/vnd.openxmlformats-officedocument.extended-properties+xml");
    await add("docProps/core.xml", properties.core, "application/vnd.openxmlformats-package.core-properties+xml");
    await add("docProps/custom.xml", properties.custom, "application/vnd.openxmlformats-officedocument.custom-properties+xml");
    let names = "";
    for (const name of book.names ?? []) {
      charge(); const index = name.sheet === undefined ? -1 : book.sheets.findIndex(s => s.id === name.sheet);
      if (name.sheet !== undefined && index < 0) continue;
      const sheet = book.sheets[index < 0 ? 0 : index]; if (!sheet) continue;
      names += xml("definedName", { name: ["Print_Area", "Sheet_Title"].includes(name.name) ? "_xlnm." + name.name : name.name,
        localSheetId: index < 0 ? undefined : index, ...formulaSemanticsAttributes(name.arrayStringLiterals, true, name.expression, name.position ? { ...name.position, sheet: book.sheets.find(s => s.id === name.position!.sheet)?.name ?? name.position.sheet } : undefined) },
        escapeXlsx(encodeXlsxString(exportXlsxFormula(book, name.expression, sheet, name.position?.row ?? 0, name.position?.column ?? 0, context, name.arrayStringLiterals, externalLinks))));
    }
    for (const [index, sheet] of book.sheets.entries()) {
      for (const [name, expression] of [["Sheet_Title", '"' + sheet.name.split('"').join('""') + '"'], ["Print_Area", "#REF!"]])
        if (!book.names?.some(n => n.name === name && n.sheet === sheet.id))
          names += xml("definedName", { name: "_xlnm." + name, localSheetId: index }, escapeXlsx(encodeXlsxString(expression!)));
    }
    let externalReferences = "";
    for (const [target, link] of externalLinks.books) {
      let definitions = "";
      for (const [key, name] of link.names) {
        const definition = link.definitions.get(key);
        if (!definition) {
          await context.diagnostic?.({ code: "xlsx-write-loss", severity: "warning",
            message: `XLSX writer does not export definition for external name '${name.name}' in '${target}'` });
          continue;
        }
        const expression = exportXlsxFormula(book, definition.expression, book.sheets[0]!, 0, 0, context, false, externalLinks);
        charge(link.sheets.size);
        definitions += xml("definedName", { name: encodeXlsxString(definition.name), refersTo: encodeXlsxString(expression),
          sheetId: definition.sheet === undefined ? undefined : [...link.sheets.keys()].indexOf(foldSheetName(definition.sheet)) });
      }
      const filename = `externalLink${link.index}.xml`, id = `rId${workbookRelations.length + 1}`;
      workbookRelations.push({ id, type: relationships + "/externalLink", target: "externalLinks/" + filename });
      externalReferences += xml("externalReference", { "r:id": id });
      await add("xl/externalLinks/" + filename, xml("externalLink", { xmlns: namespace, "xmlns:r": relationships },
        xml("externalBook", { "r:id": "rId1" }, xml("sheetNames", {}, [...link.sheets.values()].map(sheet => xml("sheetName", { val: encodeXlsxString(sheet) })).join("")) + (definitions ? xml("definedNames", {}, definitions) : "") + xml("sheetDataSet", {}))),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml");
      await add("xl/externalLinks/_rels/" + filename + ".rels", relationshipXml([
        { id: "rId1", type: relationships + "/externalLinkPath", target, external: true }
      ]));
    }
    await add("xl/workbook.xml", xml("workbook", { xmlns: namespace, "xmlns:r": relationships },
      xml("fileVersion", { lastEdited: 4, lowestEdited: 4, rupBuild: 3820 }) + xml("workbookPr", { date1904: book.dateSystem === "1904" ? 1 : 0 }) +
      protection.content + xml("bookViews", {}, xml("workbookView", { activeTab: active })) + xml("sheets", {}, sheetNodes.join("")) + (externalReferences ? xml("externalReferences", {}, externalReferences) : "") + xml("definedNames", {}, names) +
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
      if (protection.handled.has(record) || record === theme?.record || record === differentialRecord) continue;
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
    if (staged) yield* staged.finish();
    else yield await zip.writeZipArchive({ entries, comment: new Uint8Array() }, bounds, context.signal);
    } catch (error) {
      try {
        context.signal.throwIfAborted();
        if (error instanceof CodecError && error.code === "resource-limit") limit("output package");
        throw error;
      } catch (cause) { failure = { error: cause }; throw cause; }
    } finally {
      await close().catch(error => {
        if (failure) throw new AggregateError([failure.error, error], "XLSX export and storage cleanup failed");
        throw error;
      });
    }
  };
}
function exportXlsxFormula(book: Workbook, source: string, sheet: Sheet, row: number, column: number, context: CapabilityContext, arrayStringLiterals = false, externalLinks?: XlsxExternalLinkWriter): string {
  const position = { sheet: sheet.id, row, column };
  let work = 0;
  const onWork = () => {
    context.signal.throwIfAborted();
    if (++work > (context.limits.workbookNodes ?? Infinity))
      throw new SsconvertError("resource-limit", "ssconvert XLSX formula node limit exceeded");
  };
  const parsed = parseExpression(source.startsWith("=") || source.startsWith("of:=") ? source : "=" + source, { maximumDepth: context.limits.formulaDepth, position, arrayStringLiterals,
    workbook: book, signal: context.signal, maximumLength: context.limits.workbookTextBytes ?? context.limits.outputBytes,
    maximumNodes: context.limits.workbookNodes ?? Infinity });
  if (!parsed.ok) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: unparsed XLSX formula");
  const result = serializeExpression(expandIndexSheetAreas(parsed.document, onWork), excelGrammar, false, true, { relativeSheets: "fixed",
    ...(externalLinks ? { externalReference: node => externalLinks.reference(node, position), externalName: node => externalLinks.name(node) } : {}) });
  return result.startsWith("=") ? result.slice(1) : result;
}
