import { parseXmlSteps, XmlLimitError, type XmlElement } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { DEFAULT_SHEET_SIZE, formatA1, parseA1, validSheetSize, type AxisMetadata, type Cell, type CellValue,
  type ImportedValue, type NamedExpression, type Range, type RichTextRun, type Sheet, type UnsupportedRecord, type Workbook } from "../workbook.js";
import { gnumericChildren, gnumericAttributes, objectChildren } from "./gnumeric-schema.js";
import { parseExpression } from "../formulas/parser.js";
import { gnumericGrammar } from "../formulas/conventions.js";
import { quoteFormulaString } from "../formulas/serialization.js";
import { rewriteReferences } from "../formulas/rewriting.js";
import { encodingName } from "../encoding/names.js";
import { singleByteTables } from "../encoding/tables.js";
import { gnumericNumber } from "./gnumeric-number.js";
import { objectKinds } from "../objects/registry.js";
import { clipboardStyles } from "../conversion/clipboard-styles.js";
import { clipboardObjectRecords } from "../conversion/clipboard-objects.js";
import { clipboardMerges } from "../conversion/clipboard-merges.js";
import { foldSheetName } from "../workbook/case-fold.js";

const namespace = "http://www.gnumeric.org/v10.dtd";
const namespaces = new Set(["http://www.gnome.org/gnumeric/",
  ...[2, 3, 4, 5, 6, 7].map(version => `http://www.gnome.org/gnumeric/v${version}`),
  ...[8, 9, 10, 11, 12, 13, 14].map(version => `http://www.gnumeric.org/v${version}.dtd`)]);
const xmlns = "http://www.w3.org/2000/xmlns/";
const officeNamespace = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const metaNamespace = "urn:oasis:names:tc:opendocument:xmlns:meta:1.0";
const dcNamespace = "http://purl.org/dc/elements/1.1/";
const metadataFields = new Set(["meta:generator", "dc:title", "dc:description", "dc:subject", "meta:initial-creator", "dc:creator",
  "meta:printed-by", "meta:creation-date", "dc:date", "meta:print-date", "dc:language", "meta:editing-cycles", "meta:editing-duration"]);

function limit(message: string): never { throw new SsconvertError("resource-limit", `ssconvert ${message} limit exceeded`); }
function invalid(message: string): never { throw new SsconvertError("io", `E Invalid Gnumeric XML: ${message}`); }

async function transform(bytes: Uint8Array, compressed: boolean, maximum: number, context: CapabilityContext): Promise<Uint8Array> {
  context.signal.throwIfAborted();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let writer: ReturnType<CompressionStream["writable"]["getWriter"]> | undefined;
  let closed = false;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    if (!cleanupPromise) {
      closed = true;
      cleanupPromise = Promise.allSettled([reader?.cancel(), writer?.abort()]).then(() => undefined);
    }
    return cleanupPromise;
  };
  context.own(cleanup);
  const abort = () => { void cleanup(); };
  context.signal.addEventListener("abort", abort, { once: true });
  try {
    context.signal.throwIfAborted();
    if (closed) invalid("gzip operation is closed");
    const stream = compressed ? new CompressionStream("gzip") : new DecompressionStream("gzip");
    reader = stream.readable.getReader(); writer = stream.writable.getWriter();
    const producer = writer;
    // Observe producer failures even when a byte bound terminates consumption.
    const production = (async () => { await producer.write(new Uint8Array(bytes)); await producer.close(); })();
    void production.catch(() => {});
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const next = await reader.read(); context.signal.throwIfAborted();
      if (next.done) break;
      if (next.value.byteLength > maximum - length) limit(compressed ? "output bytes" : "decompressed bytes");
      length += next.value.byteLength; chunks.push(new Uint8Array(next.value));
    }
    await production; context.signal.throwIfAborted();
    const output = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof SsconvertError) throw error;
    return invalid(compressed ? "gzip output failed" : "invalid gzip stream");
  } finally { context.signal.removeEventListener("abort", abort); await cleanup(); }
}

async function document(bytes: Uint8Array, context: CapabilityContext): Promise<XmlElement> {
  context.signal.throwIfAborted();
  if (bytes.byteLength > context.limits.inputBytes) limit("input bytes");
  const gzip = bytes[0] === 31 && bytes[1] === 139;
  if (gzip && bytes.length > (context.limits.compressedBytes ?? context.limits.inputBytes)) limit("compressed bytes");
  const maximum = Math.min(context.limits.inputBytes, context.limits.inflatedBytes ?? context.limits.inputBytes);
  // ISIZE is a modulo-2^32 trailer declaration, not a trusted total for
  // concatenated members. Refuse an oversized declaration before acquisition;
  // incremental admission still bounds forged or multi-member streams.
  if (gzip && bytes.length >= 18 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4, true) > maximum)
    limit("decompressed bytes");
  const plain = gzip ? await transform(bytes, false, maximum, context) : bytes;
  if (plain.length > maximum) limit("decompressed bytes");
  let encoding: "UTF-8" | "UTF-16LE" | "UTF-16BE" = "UTF-8";
  if (plain[0] === 255 && plain[1] === 254 || plain[0] === 60 && plain[1] === 0) encoding = "UTF-16LE";
  if (plain[0] === 254 && plain[1] === 255 || plain[0] === 0 && plain[1] === 60) encoding = "UTF-16BE";
  try {
    let text: string;
    const header = new TextDecoder("ascii").decode(plain.subarray(0, Math.min(plain.length, 1024)));
    const encodingAt = header.startsWith("<?xml") && " \t\r\n".includes(header[5] ?? "\0") ? header.indexOf("encoding") : -1;
    let declared: string | undefined;
    if (encodingAt >= 0) {
      let at = encodingAt + 8; while (" \t\r\n".includes(header[at] ?? "\0")) at++;
      if (header[at++] !== "=") invalid("malformed encoding declaration");
      while (" \t\r\n".includes(header[at] ?? "\0")) at++;
      const quote = header[at++]; if (quote !== "'" && quote !== '"') invalid("malformed encoding declaration");
      const end = header.indexOf(quote, at); if (end < 0) invalid("malformed encoding declaration"); declared = header.slice(at, end);
    }
    if (encoding === "UTF-8" && declared && !["utf-8", "utf8"].includes(declared.toLowerCase())) {
      const table = singleByteTables[encodingName(declared)];
      if (!table) throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: XML encoding ${declared}`);
      const characters: string[] = [];
      for (const byte of plain) { const character = table[byte]!; if (character === "\uffff") invalid("invalid encoded XML byte"); characters.push(character); }
      text = characters.join("");
      // The declaration is validated by the XML parser after decoding its bytes.
      const at = text.indexOf(declared, encodingAt + 8); text = text.slice(0, at) + "UTF-8" + text.slice(at + declared.length);
    } else text = new TextDecoder(encoding, { fatal: true }).decode(plain);
    const parser = parseXmlSteps(text, { expectedEncoding: encoding, maxDepth: context.limits.xmlDepth ?? 128,
      maxNodes: context.limits.workbookNodes ?? 100000, maxAttributes: context.limits.workbookNodes ?? 100000,
      maxTextLength: context.limits.workbookTextBytes ?? context.limits.inputBytes });
    let step = parser.next(); let work = 0;
    while (!step.done) {
      context.signal.throwIfAborted();
      if ((work += step.value) >= 16384) { work = 0; await new Promise<void>(resolve => setTimeout(resolve, 0)); }
      step = parser.next();
    }
    return step.value;
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof SyntaxError && error.message === "Invalid XML: DTD and entity declarations are forbidden")
      throw new SsconvertError("capability-denied", "ssconvert host denies XML DTD and entity declarations");
    if (error instanceof XmlLimitError) limit("XML nodes/text");
    if (error instanceof SsconvertError) throw error;
    return invalid(error instanceof Error ? error.message : "malformed document");
  }
}

export async function probeGnumeric(bytes: Uint8Array, context: CapabilityContext): Promise<boolean> {
  try { const root = await document(bytes, context); return root.localName === "Workbook" && namespaces.has(root.namespace); }
  catch (error) { if (error instanceof SsconvertError && error.code === "io") return false; throw error; }
}

function children(node: XmlElement | undefined, name: string): XmlElement[] {
  return node?.children.filter(child => child.localName === name && namespaces.has(child.namespace)) ?? [];
}
function child(node: XmlElement | undefined, name: string): XmlElement | undefined { return children(node, name)[0]; }
function sheetName(node: XmlElement): string | undefined {
  const name = child(node, "Name");
  if (!name) return undefined;
  // libgsf collects character data even inside rejected children of this
  // content-bearing SAX leaf. Preserve order, excluding comments and PIs.
  const parts: string[] = [];
  const collect = (element: XmlElement): void => {
    for (const item of element.content) {
      if (item.kind === "element") collect(item);
      else if (item.kind === "text" || item.kind === "cdata") parts.push(item.text);
    }
  };
  collect(name);
  return parts.join("");
}
function attribute(node: XmlElement | undefined, name: string, qualified = false): string | undefined {
  return node?.attributes.find(attr => attr.localName === name && (qualified ? namespaces.has(attr.namespace) : attr.namespace === ""))?.value;
}
function number(node: XmlElement | undefined, name: string, fallback: number, qualified = false): number {
  const value = attribute(node, name, qualified); if (value === undefined) return fallback;
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback;
}
function boolean(node: XmlElement | undefined, name: string, fallback: boolean): boolean {
  const value = attribute(node, name);
  return value === undefined ? fallback : value.toLowerCase() !== "false" && value !== "0";
}
function range(text: string): Range {
  const [start, end = start] = text.split(":"); const first = parseA1(start!), last = parseA1(end!);
  if (!first || !last) invalid(`invalid range '${text}'`);
  return { startRow: first.row, startColumn: first.column, endRow: last.row, endColumn: last.column };
}
function xmlRange(node: XmlElement): Range {
  return { startRow: number(node, "startRow", 0), startColumn: number(node, "startCol", 0),
    endRow: number(node, "endRow", 0), endColumn: number(node, "endCol", 0) };
}
function value(type: string | undefined, text: string): CellValue {
  if (type === "20") return { kind: "boolean", value: text.toUpperCase() === "TRUE" || text === "1" };
  if (type === "40") { const n = Number(text); if (!Number.isFinite(n)) invalid(`invalid numeric value '${text}'`); return { kind: "number", value: n }; }
  if (type === "50") {
    if (text.startsWith('#"')) {
      const parsed = parseExpression("=" + text, { position: { sheet: "", row: 0, column: 0 }, maximumLength: text.length + 1 });
      if (parsed.ok && parsed.document.root.kind === "literal" && parsed.document.root.value.kind === "error") return parsed.document.root.value;
    }
    return { kind: "error", value: text };
  }
  if (type === "10") return { kind: "blank" };
  return { kind: "string", value: text };
}

const richAttributes = new Set(["family", "size", "rise", "scale", "italic", "bold", "strikethrough", "underline", "color", "subscript", "superscript"]);
function richText(format: string | undefined): RichTextRun[] | undefined {
  if (!format?.startsWith("@[")) return undefined;
  const runs: RichTextRun[] = []; let offset = 1;
  while (offset < format.length) {
    if (format[offset] !== "[") return undefined;
    const close = format.indexOf("]", offset), equal = format.indexOf("=", offset);
    if (close < 0 || equal < offset || equal > close) return undefined;
    const key = format.slice(offset + 1, equal), parts = format.slice(equal + 1, close).split(":");
    if (parts.length !== 3) return undefined;
    const start = Number(parts[1]), end = Number(parts[2]);
    if (richAttributes.has(key) && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < end && end <= 4294967295) {
      const raw = parts[0]!; const numeric = Number(raw);
      runs.push({ start, end, attributes: { [key]: ["family", "underline", "color"].includes(key) ? raw : Number.isFinite(numeric) ? numeric : 0 } });
    }
    offset = close + 1;
  }
  return runs;
}
function richFormat(runs: readonly RichTextRun[]): string {
  let result = "@";
  for (const run of runs) for (const [key, val] of Object.entries(run.attributes)) {
    if (!richAttributes.has(key) || typeof val !== "string" && typeof val !== "number") invalid("unsupported rich text attribute");
    if (String(val).includes(":") || String(val).includes("]")) invalid("invalid rich text attribute value");
    result += `[${key}=${val}:${run.start}:${run.end}]`;
  }
  return result;
}

/** Owned, namespace-aware records keep print/style/object surfaces independently of cells. */
function record(node: XmlElement, unrestricted = false, parent?: XmlElement): ImportedValue {
  // Drawing/GOffice Style records use a separate, unqualified grammar.
  const margin = !unrestricted && namespaces.has(node.namespace) && parent?.localName === "Margins" && namespaces.has(parent.namespace);
  const coreAttributes = !unrestricted && namespaces.has(node.namespace) &&
    (node.localName === "Style" || node.localName === "Font" || margin)
    ? gnumericAttributes[node.localName] : undefined;
  return { name: node.localName, namespace: namespaces.has(node.namespace) ? namespace : node.namespace, text: node.text,
    attributes: node.attributes.filter(attr => attr.namespace !== xmlns && (coreAttributes === undefined ||
      !attr.namespace && coreAttributes.includes(attr.localName) && !(node.localName === "Style" && attr.localName === "Orient"))).map(attr => ({ name: attr.localName,
      namespace: namespaces.has(attr.namespace) ? namespace : attr.namespace,
      value: margin && attr.localName === "PrefUnit" ?
        ["cm", "mm", "centimeter", "millimeter"].includes(attr.value.toLowerCase()) ? "mm" :
        ["inch", "in", "inches"].includes(attr.value.toLowerCase()) ? "inch" : "points" : attr.value })),
    children: node.children.filter(next => unrestricted || accepted(node, next, parent?.localName)).map(next => record(next, unrestricted, node)) };
}
const objectTypes = new Set(Object.keys(objectKinds));
function accepted(parent: XmlElement, next: XmlElement, context?: string): boolean {
  // Sheet/Name is a leaf; Names/Name has expression properties. Their local
  // names coincide, but the native SAX states have different child grammars.
  if (namespaces.has(parent.namespace) && parent.localName === "Name" && context !== "Names") return false;
  // GOPersist pushes the GOStyle reader onto the property itself, without a
  // wrapping Style element. Scalar properties retain the GogObject grammar.
  if (!parent.namespace && parent.localName === "property" && context === "GogObject" &&
    attribute(parent, "name") === "style" && attribute(parent, "type") === "GogStyle" &&
    !next.namespace && objectChildren.Style?.includes(next.localName)) return true;
  return namespaces.has(next.namespace) && (gnumericChildren[parent.localName]?.includes(next.localName) || parent.localName === "Objects" && objectTypes.has(next.localName)) ||
    !next.namespace && !!objectChildren[parent.localName]?.includes(next.localName) && (!parent.namespace || parent.localName !== "Style") ||
    !next.namespace && parent.localName === "Name" && ["name", "value", "position"].includes(next.localName);
}
function retained(node: XmlElement): UnsupportedRecord {
  return { source: "Gnumeric_XmlIO:sax", kind: node.localName, disposition: "retained",
    data: record(node, node.localName === "document-meta" || node.localName === "GODoc") };
}

function metadata(root: XmlElement): Readonly<Record<string, ImportedValue>> {
  const properties: Record<string, ImportedValue> = Object.create(null) as Record<string, ImportedValue>;
  const doc = root.children.find(n => n.namespace === officeNamespace && n.localName === "document-meta");
  const meta = doc?.children.find(n => n.namespace === officeNamespace && n.localName === "meta");
  for (const n of meta?.children ?? []) {
    const key = (n.namespace === dcNamespace ? "dc:" : n.namespace === metaNamespace ? "meta:" : "") + n.localName;
    if (metadataFields.has(key)) properties[key] = key === "meta:editing-cycles" ? Number(n.text) : n.text;
    else if (key === "meta:keyword") {
      const keywords = properties["dc:keywords"]; properties["dc:keywords"] = [...(Array.isArray(keywords) ? keywords : []), n.text];
    } else if (key === "meta:user-defined") {
      const prop = (name: string) => n.attributes.find(a => a.namespace === metaNamespace && a.localName === name)?.value;
      const name = prop("name") ?? "", type = prop("value-type") ?? prop("type") ?? "string";
      properties[name] = type === "float" ? Number(n.text) : type === "boolean" ? n.text === "true" : n.text;
    }
  }
  return properties;
}

async function warnUnknown(node: XmlElement, context: CapabilityContext, path: readonly string[] = []): Promise<void> {
  if (node.localName === "Calculation" && namespaces.has(node.namespace)) {
    const convention = attribute(node, "DateConvention");
    if (convention !== undefined && convention !== "Apple:1904" && convention !== "Lotus:1900") {
      const message = "Ignoring invalid date conventions.\n";
      await context.diagnostic?.({ code: "gnumeric-xml", severity: "warning", message, bytes: new TextEncoder().encode(message) });
    }
  }
  for (const next of node.children) {
    context.signal.throwIfAborted();
    const delegated = next.localName === "document-meta" && next.namespace === "urn:oasis:names:tc:opendocument:xmlns:office:1.0" || next.localName === "GODoc" && !next.namespace;
    if (delegated) continue;
    if (!accepted(node, next, path.at(-1))) {
      const message = `Unexpected element '${next.name}' in state : \n\t${[...path, node.localName].join(" -> ")}\n`;
      await context.diagnostic?.({ code: "gnumeric-xml", severity: "warning", message, bytes: new TextEncoder().encode(message) });
    } else await warnUnknown(next, context, [...path, node.localName]);
  }
}

function names(node: XmlElement, sheet: string): NamedExpression[] {
  return children(child(node, "Names"), "Name").flatMap(item => {
    const prop = (name: string) => item.children.find(c => c.localName === name && (namespaces.has(c.namespace) || !c.namespace))?.text;
    const name = prop("name"), expression = prop("value"); if (!name || expression === undefined) return [];
    const pos = parseA1(prop("position") ?? "A1");
    return [{ name, expression, ...(node.localName === "Sheet" ? { sheet } : {}),
      ...(pos ? { position: { sheet, ...pos } } : {}) }];
  });
}
function axes(node: XmlElement | undefined, axis: "RowInfo" | "ColInfo", maximum: number, admit: (count: number) => void): AxisMetadata[] {
  const result: AxisMetadata[] = [];
  for (const item of children(node, axis)) {
    const start = number(item, "No", -1), count = number(item, "Count", 1);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 1 || count > maximum - start) invalid("invalid axis interval");
    admit(count);
    for (let i = 0; i < count; i++) result.push({ index: start + i, sizePoints: number(item, "Unit", 0),
      hidden: number(item, "Hidden", 0) !== 0, collapsed: number(item, "Collapsed", 0) !== 0, outlineLevel: number(item, "OutlineLevel", 0),
      style: { gnumeric: record(item) } });
  }
  return result;
}

export async function readGnumeric(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  const root = await document(bytes, context);
  if (root.localName !== "Workbook" || !namespaces.has(root.namespace)) invalid("unsupported workbook namespace");
  await warnUnknown(root, context);
  const index = children(child(root, "SheetNameIndex"), "SheetName");
  const dataSheets = children(child(root, "Sheets"), "Sheet");
  let dateSystem: "1900" | "1904" = "1900";
  let manualRecalc = false;
  let iteration = { enabled: true, maximum: 100, tolerance: 0.001 };
  for (const node of root.children) {
    if (!namespaces.has(node.namespace)) continue;
    if (node.localName === "DateConvention") dateSystem = node.text === "1904" ? "1904" : "1900";
    else if (node.localName === "Calculation") {
      manualRecalc = boolean(node, "ManualRecalc", manualRecalc);
      iteration = { enabled: boolean(node, "EnableIteration", iteration.enabled), maximum: number(node, "MaxIterations", iteration.maximum), tolerance: number(node, "IterationTolerance", iteration.tolerance) };
      const convention = attribute(node, "DateConvention");
      if (convention === "Apple:1904") dateSystem = "1904";
      else if (convention === "Lotus:1900") dateSystem = "1900";
    }
  }
  // Native XML version selection depends on the literal historical prefixes.
  // A generic prefix alone leaves the reader in its legacy unknown-version mode.
  let version = 0;
  for (const declaration of root.attributes) {
    if (version || declaration.name !== "xmlns:gnm" && declaration.name !== "xmlns:gmr") continue;
    const selected = Array.from(namespaces).indexOf(declaration.value);
    if (selected >= 0) version = selected + 1;
  }
  const availableNames = new Set<string>();
  for (const node of root.children) {
    if (!namespaces.has(node.namespace)) continue;
    if (node.localName === "Version") version = 11;
    else if (node.localName === "SheetNameIndex") for (const name of children(node, "SheetName")) availableNames.add(name.text);
    else if (node.localName === "Sheets") {
      if (version >= 7 && children(node, "Sheet").some(sheet => !availableNames.has(sheetName(sheet) ?? ""))) {
        throw new SsconvertError("io", "E File has inconsistent SheetNameIndex element.");
      }
      for (const sheet of children(node, "Sheet")) availableNames.add(sheetName(sheet) ?? "");
    }
  }
  const byName = new Map(dataSheets.map(n => [sheetName(n), n]));
  const indexedNames = new Set(index.map(n => n.text));
  const sheetNodes = index.length ? [...index.map(n => byName.get(n.text) ?? { ...n, localName: "Sheet", children: [] }),
    ...dataSheets.filter(n => !indexedNames.has(sheetName(n) ?? ""))] : dataSheets;
  if (sheetNodes.length > context.limits.sheets) limit("sheets");
  let count = 0, work = 0; const shared = new Map<string, { formula: string; row: number; column: number; sheet: string }>();
  let expandedAxes = 0;
  const admitAxes = (count: number) => {
    context.signal.throwIfAborted();
    if (count > (context.limits.workbookNodes ?? 100000) - expandedAxes) limit("axis nodes");
    expandedAxes += count;
  };
  const tick = () => { context.signal.throwIfAborted(); if (++work > (context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32)) limit("XML relationship work"); };
  const knownSheets = new Set(index.map(node => foldSheetName(node.text)));
  const sheets: Sheet[] = [];
  for (const [i, node] of sheetNodes.entries()) {
    context.signal.throwIfAborted();
    const name = sheetName(node) ?? index[i]?.text ?? `Sheet${i + 1}`;
    knownSheets.add(foldSheetName(name));
    const indexed = index.find(n => n.text === name);
    const size = { rows: number(indexed, "Rows", DEFAULT_SHEET_SIZE.rows, true), columns: number(indexed, "Cols", DEFAULT_SHEET_SIZE.columns, true) };
    if (!validSheetSize(size)) invalid("invalid sheet dimensions");
    const styles = children(child(node, "Styles"), "StyleRegion");
    const groups: NonNullable<Sheet["formulaGroups"]>[number][] = [];
    const cells: Cell[] = []; const addresses = new Map<string, number>();
    for (const item of children(child(node, "Cells"), "Cell")) {
      context.signal.throwIfAborted(); if (++count > context.limits.cells) limit("cells");
      const row = number(item, "Row", -1), column = number(item, "Col", -1);
      if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column) || row < 0 || column < 0 || row >= size.rows || column >= size.columns) invalid("invalid cell position");
      const text = child(item, "Content")?.text ?? item.text;
      const type = attribute(item, "ValueType"), cached = attribute(item, "Value"), id = attribute(item, "ExprID");
      let formula = text.startsWith("=") && (type === undefined || cached !== undefined) ? text : undefined;
      if (!text && id && shared.has(id)) {
        const original = shared.get(id)!;
        const parsed = parseExpression(original.formula, { position: original, signal: context.signal });
        if (!parsed.ok) invalid("invalid shared expression");
        formula = rewriteReferences(parsed.document, { position: { sheet: name, row, column }, translation: "copy", signal: context.signal });
      }
      // XML's ordinary-cell parser recovers a rejected sheet-qualified name
      // as a constant expression. Array corners use a separate native path.
      const rows = number(item, "Rows", 1), cols = number(item, "Cols", 1);
      const array = attribute(item, "Rows") !== undefined && attribute(item, "Cols") !== undefined && rows > 0 && cols > 0;
      if (formula && !array) {
        let missingSheet: string | undefined;
        const parsed = parseExpression(formula, { position: { sheet: name, row, column }, signal: context.signal,
          onName(_name, sheet) {
            if (missingSheet === undefined && sheet !== undefined && !knownSheets.has(foldSheetName(sheet))) missingSheet = sheet;
          } });
        if (parsed.ok && missingSheet !== undefined) {
          const message = `Unparsable expression for ${formatA1(row, column)}: ${formula} (Unknown sheet '${missingSheet}')\n`;
          await context.diagnostic?.({ code: "gnumeric-xml", severity: "warning", message, bytes: new TextEncoder().encode(message) });
          context.signal.throwIfAborted();
          formula = "=" + quoteFormulaString(formula.slice(1), '"', gnumericGrammar);
        }
      }
      if (id && formula && !shared.has(id)) shared.set(id, { formula, row, column, sheet: name });
      const stored = formula ? cached === undefined ? { kind: "blank" } as const : value(type, cached) : value(type, text);
      const valueFormat = attribute(item, "ValueFormat"); const runs = richText(valueFormat);
      let style: ImportedValue | undefined; let format = valueFormat;
      for (const region of styles) {
        tick();
        const bounds = xmlRange(region); if (row < bounds.startRow || row > bounds.endRow || column < bounds.startColumn || column > bounds.endColumn) continue;
        const s = child(region, "Style"); if (s) { style = record(s); format = attribute(s, "Format") ?? format; }
      }
      const group = formula && array ? `array-${row}-${column}` : undefined;
      if (group) {
        if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(cols) || rows < 1 || cols < 1 || rows > size.rows - row || cols > size.columns - column) invalid("invalid array dimensions");
        groups.push({ id: group, kind: "array", range: { startRow: row, startColumn: column, endRow: row + rows - 1, endColumn: column + cols - 1 }, expression: formula! });
      }
      const cell: Cell = { row, column, value: stored, ...(formula ? { formula, formulaDirty: true, ...(cached !== undefined ? { cachedResult: stored } : {}) } : {}),
        ...(group ? { formulaGroup: group } : {}), ...(format ? { format } : {}), ...(runs ? { richText: runs } : {}),
        ...(style || valueFormat ? { style: { ...(style ? { gnumeric: style } : {}), ...(valueFormat ? { gnumericValueFormat: valueFormat } : {}) } } : {}) };
      const address = `${row}:${column}`, previous = addresses.get(address);
      if (previous === undefined) { addresses.set(address, cells.length); cells.push(cell); } else cells[previous] = cell;
    }
    const visibility = attribute(node, "Visibility")?.toLowerCase();
    sheets.push({ id: `s${i + 1}`, name, size, cells,
      visibility: visibility?.includes("very_hidden") || visibility === "very-hidden" ? "very-hidden" : visibility?.includes("hidden") ? "hidden" : "visible",
      rows: axes(child(node, "Rows"), "RowInfo", size.rows, admitAxes), columns: axes(child(node, "Cols"), "ColInfo", size.columns, admitAxes),
      merges: children(child(node, "MergedRegions"), "Merge").map(n => range(n.text)), formulaGroups: groups,
      view: { gnumeric: Object.fromEntries(node.attributes.filter(a => !a.namespace && gnumericAttributes.Sheet?.includes(a.localName)).map(a => [a.localName, a.value])), zoom: Number(child(node, "Zoom")?.text ?? 1),
        ...(attribute(child(node, "Cols"), "DefaultSizePts") === undefined ? {} : { defaultColumnWidth: number(child(node, "Cols"), "DefaultSizePts", 48) }),
        ...(attribute(child(node, "Rows"), "DefaultSizePts") === undefined ? {} : { defaultRowHeight: number(child(node, "Rows"), "DefaultSizePts", 12.75) }) },
      unsupportedRecords: node.children.filter(n => namespaces.has(n.namespace) && ["PrintInformation", "Styles", "Cols", "Rows", "Selections", "Objects", "SheetLayout", "Filters", "Solver", "Scenarios"].includes(n.localName)).map(retained) });
  }
  const selected = number(child(root, "UIData"), "SelectedTab", 0);
  const allNames = [...names(root, sheets[0]?.id ?? "s1"), ...sheetNodes.flatMap((n, i) => names(n, sheets[i]!.id))];
  return { sheets, ...(sheets[selected] ? { activeSheet: sheets[selected]!.id } : {}), names: allNames, properties: metadata(root),
    dateSystem,
    calculationMode: manualRecalc ? "manual" : "automatic", iteration,
    unsupportedRecords: root.children.filter(n => namespaces.has(n.namespace) && ["Attributes", "Geometry"].includes(n.localName) ||
      n.localName === "document-meta" && n.namespace === "urn:oasis:names:tc:opendocument:xmlns:office:1.0" || n.localName === "GODoc" && !n.namespace).map(retained) };
}

function escape(text: string): string {
  return text.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split('"').join("&quot;")
    .split("\r").join("&#13;");
}
function utf8Length(text: string): number {
  let length = 0;
  for (const character of text) { const point = character.codePointAt(0)!; length += point <= 127 ? 1 : point <= 2047 ? 2 : point <= 65535 ? 3 : 4; }
  return length;
}
class XmlWriter {
  private length = 0;
  private work = 0;
  constructor(private readonly maximum: number, private readonly context: CapabilityContext) {}
  element(name: string, attrs: Readonly<Record<string, string | number>> = {}, text = "", nested = "", depth = 0, explicitContent = false): string {
    this.context.signal.throwIfAborted();
    if (++this.work > (this.context.limits.workbookWork ?? this.context.limits.inputBytes + this.context.limits.cells * 32)) limit("XML serialization work");
    if (text.length > this.maximum - this.length) limit("output bytes");
    const indent = "  ".repeat(depth); let attributes = "";
    for (const [key, val] of Object.entries(attrs)) {
      const raw = String(val); if (raw.length + key.length > this.maximum - this.length - attributes.length) limit("output bytes");
      attributes += ` ${key}="${escape(raw).split("\n").join("&#10;").split("\t").join("&#9;")}"`;
    }
    const opening = `${indent}<${name}${attributes}`;
    const ending = nested ? `>\n${indent}</${name}>\n` : text || explicitContent ? `>${escape(text)}</${name}>\n` : "/>\n";
    const size = utf8Length(opening) + utf8Length(ending);
    if (size > this.maximum - this.length) limit("output bytes");
    this.length += size;
    return nested ? opening + ">\n" + nested + `${indent}</${name}>\n` : opening + ending;
  }
}

function object(value: ImportedValue | undefined): { readonly [key: string]: ImportedValue } | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as { readonly [key: string]: ImportedValue } : undefined;
}
function importedStyle(style: Readonly<Record<string, ImportedValue>> | undefined, format: string | undefined, writer: XmlWriter, reset = false, depth = 5): string {
  const attrs: Record<string, string | number> = reset ? { HAlign: "GNM_HALIGN_GENERAL", VAlign: "GNM_VALIGN_BOTTOM", WrapText: 0,
    ShrinkToFit: 0, Rotation: 0, Shade: 0, Indent: 0, Locked: 1, Hidden: 0, Fore: "0:0:0", Back: "FFFF:FFFF:FFFF", PatternColor: "0:0:0" } : {};
  if (format !== undefined) attrs.Format = format;
  for (const [key, name, prefix, values] of [
    ["horizontalAlignment", "HAlign", "GNM_HALIGN_", ["general", "left", "center", "right", "fill", "justify", "distributed"]],
    ["verticalAlignment", "VAlign", "GNM_VALIGN_", ["bottom", "center", "top", "justify", "distributed"]]
  ] as const) {
    const value = style?.[key];
    if (typeof value === "string" && values.some(v => v === value)) attrs[name] = prefix + value.toUpperCase();
  }
  if (typeof style?.wrapText === "boolean") attrs.WrapText = Number(style.wrapText);
  const alignments: Record<number, string> = { 1: "GENERAL", 2: "LEFT", 4: "RIGHT", 8: "CENTER", 16: "FILL", 32: "JUSTIFY", 64: "CENTER_ACROSS_SELECTION", 128: "DISTRIBUTED" };
  if (typeof style?.HAlign === "number") attrs.HAlign = alignments[style.HAlign] ? `GNM_HALIGN_${alignments[style.HAlign]}` : style.HAlign;
  for (const [key, name] of [["pattern", "Shade"], ["hidden", "Hidden"]] as const) {
    const value = style?.[key];
    if (typeof value === "number" || typeof value === "boolean") attrs[name] = Number(value);
  }
  for (const [key, name] of [["fontColor", "Fore"], ["backgroundColor", "Back"], ["patternColor", "PatternColor"]] as const) {
    const value = style?.[key];
    if (typeof value === "string" && value.length === 7 && value[0] === "#" &&
      Array.from(value.slice(1)).every(c => "0123456789abcdefABCDEF".includes(c)))
      attrs[name] = [1, 3, 5].map(at => (parseInt(value.slice(at, at + 2), 16) * 257).toString(16).toUpperCase()).join(":");
  }
  const font: Record<string, string | number> = reset ? { Unit: 10, Bold: 0, Italic: 0, Underline: 0, StrikeThrough: 0 } : {};
  for (const [key, name] of [["fontSize", "Unit"], ["bold", "Bold"], ["italic", "Italic"], ["underline", "Underline"], ["strike", "StrikeThrough"]] as const) {
    const value = style?.[key];
    if (typeof value === "number" || typeof value === "boolean") font[name] = Number(value);
  }
  const fontName = typeof style?.fontName === "string" ? style.fontName : reset ? "Sans" : "";
  if (typeof style?.Script === "number") font.Script = style.Script;
  const saved = reset ? undefined : object(style?.gnumeric);
  if (saved?.name === "Style" && typeof saved.namespace === "string" && namespaces.has(saved.namespace)) {
    const mergeAttributes = (node: Readonly<Record<string, ImportedValue>>, patch: Readonly<Record<string, string | number>>): ImportedValue[] => [
      ...(Array.isArray(node.attributes) ? node.attributes.filter(value => {
        const a = object(value);
        return a?.namespace !== "" || typeof a.name !== "string" || !Object.hasOwn(patch, a.name);
      }) : []),
      ...Object.entries(patch).map(([name, value]) => ({ name, namespace: "", value: String(value) }))
    ];
    let replacedFont = false;
    const nested = Array.isArray(saved.children) ? saved.children.map(value => {
      const node = object(value);
      if (node?.name !== "Font" || typeof node.namespace !== "string" || !namespaces.has(node.namespace)) return value;
      replacedFont = true;
      return { ...node, attributes: mergeAttributes(node, font), ...(typeof style?.fontName === "string" ? { text: fontName } : {}) };
    }) : [];
    if (!replacedFont && (Object.keys(font).length || fontName)) nested.push({ name: "Font", namespace, text: fontName, attributes: mergeAttributes({}, font), children: [] });
    return emitRecord({ ...saved, attributes: mergeAttributes(saved, attrs), children: nested }, depth, writer);
  }
  return writer.element("gnm:Style", attrs, "", Object.keys(font).length || fontName ? writer.element("gnm:Font", font, fontName, "", depth + 1) : "", depth);
}
function validateRecordName(name: string): void {
  // SDK records are data, never permission to emit XML syntax.
  try {
    const parser = parseXmlSteps(`<${name}/>`, { maxNodes: 1 });
    let step = parser.next(); while (!step.done) step = parser.next();
    if (step.value.localName !== name || step.value.namespace || step.value.attributes.length) invalid("invalid XML record name");
  } catch { invalid("invalid XML record name"); }
}
function emitRecord(value: ImportedValue | undefined, depth: number, writer: XmlWriter): string {
  if (depth > 128) limit("XML depth");
  const node = object(value); if (!node || typeof node.name !== "string" || typeof node.namespace !== "string") return "";
  const attrs: Record<string, string> = {};
  const qualify = (name: string, ns: string): string => {
    validateRecordName(name);
    if (ns === xmlns) invalid("reserved XML namespace in record");
    if (ns === "http://www.w3.org/XML/1998/namespace") return `xml:${name}`;
    if (!ns) return name; if (ns === namespace) return `gnm:${name}`;
    const prefix = `ns${Object.keys(attrs).filter(k => k.startsWith("xmlns:")).length}`; attrs[`xmlns:${prefix}`] = ns; return `${prefix}:${name}`;
  };
  const name = qualify(node.name, node.namespace);
  if (Array.isArray(node.attributes)) for (const a of node.attributes) { const attr = object(a);
    if (attr && typeof attr.name === "string" && typeof attr.namespace === "string" && typeof attr.value === "string") attrs[qualify(attr.name, attr.namespace)] = attr.value;
  }
  const nested = Array.isArray(node.children) ? node.children.map(n => emitRecord(n, depth + 1, writer)).join("") : "";
  return writer.element(name, attrs, typeof node.text === "string" ? node.text : "", nested, depth);
}
function emitRetained(records: readonly UnsupportedRecord[] | undefined, kind: string, depth: number, writer: XmlWriter): string {
  return records?.filter(r => r.source === "Gnumeric_XmlIO:sax" && r.kind === kind && r.disposition === "retained").map(r => emitRecord(r.data, depth, writer)).join("") ?? "";
}
function emitNames(book: Workbook, sheet: Sheet | undefined, depth: number, writer: XmlWriter): string {
  const entries = book.names?.filter(n => n.sheet === sheet?.id).map(n => writer.element("gnm:Name", {}, "",
    writer.element("gnm:name", {}, n.name, "", depth + 2) + writer.element("gnm:value", {}, n.expression.startsWith("=") ? n.expression.slice(1) : n.expression, "", depth + 2) +
    writer.element("gnm:position", {}, n.position ? formatA1(n.position.row, n.position.column) : "A1", "", depth + 2), depth + 1)).join("") ?? "";
  return entries ? writer.element("gnm:Names", {}, "", entries, depth) : "";
}
function emitMetadata(book: Workbook, writer: XmlWriter): string {
  if (book.properties === undefined) return emitRetained(book.unsupportedRecords, "document-meta", 1, writer);
  let entries = "";
  for (const [key, val] of Object.entries(book.properties).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (key === "dc:keywords" && Array.isArray(val)) {
      for (const keyword of val) if (typeof keyword === "string") entries += writer.element("meta:keyword", {}, keyword, "", 3);
    } else if (metadataFields.has(key)) {
      if (typeof val !== "string" && typeof val !== "number") invalid("invalid workbook metadata type");
      entries += writer.element(key, {}, String(val), "", 3);
    } else if (val !== null) {
      if (typeof val !== "string" && typeof val !== "number" && typeof val !== "boolean") throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: XML metadata value type");
      entries += writer.element("meta:user-defined", { "meta:name": key, "meta:value-type": typeof val === "number" ? "float" : typeof val === "boolean" ? "boolean" : "string" }, String(val), "", 3);
    }
  }
  if (!entries) return "";
  return writer.element("office:document-meta", { "xmlns:office": officeNamespace, "xmlns:xlink": "http://www.w3.org/1999/xlink", "xmlns:dc": dcNamespace,
    "xmlns:meta": metaNamespace, "xmlns:ooo": "http://openoffice.org/2004/office", "office:version": "1.2" }, "", writer.element("office:meta", {}, "", entries, 2), 1);
}
const types = { blank: 10, boolean: 20, number: 40, error: 50, string: 60, "byte-string": 60 } as const;
function valueText(value: CellValue, context: CapabilityContext): string {
  if (value.kind === "byte-string") throw new SsconvertError("unsupported-feature", "Native byte-string cannot be serialized as Unicode XML text");
  if (value.kind === "error" && !["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"].includes(value.value))
    return "#" + quoteFormulaString(value.value, '"', gnumericGrammar);
  return value.kind === "blank" ? "" : value.kind === "boolean" ? value.value ? "TRUE" : "FALSE" :
    value.kind === "number" ? gnumericNumber(value.value, context.environment.env.GNM_SHORTREP_FILES !== undefined) : value.value;
}

/** Resolved copied styles are shared by native and table clipboard serializers. */
export function clipboardStyleRecords(sheet: Sheet, range: import("../workbook.js").CellRange, context: CapabilityContext): readonly UnsupportedRecord[] {
  const styleNode = (style: Readonly<Record<string, ImportedValue>> | undefined, format: string | undefined, reset = false) => {
    const xml = `<Root xmlns:gnm="${namespace}">` + importedStyle(style, format, new XmlWriter(context.limits.outputBytes, context), reset, 0) + "</Root>";
    const parser = parseXmlSteps(xml, { maxNodes: context.limits.workbookNodes ?? 100000, maxTextLength: context.limits.workbookTextBytes ?? context.limits.inputBytes });
    let step = parser.next(); while (!step.done) { context.signal.throwIfAborted(); step = parser.next(); }
    return record(step.value.children[0]!, true);
  };
  const children = clipboardStyles(sheet, range, styleNode({ Script: 0 }, "General", true), styleNode, context)
    .map(region => ({ name: "StyleRegion", namespace, text: "", attributes: Object.entries({ startCol: region.range.startColumn - range.startColumn,
      startRow: region.range.startRow - range.startRow, endCol: region.range.endColumn - range.startColumn,
      endRow: region.range.endRow - range.startRow }).map(([name, value]) => ({ name, namespace: "", value: String(value) })), children: [region.style] }));
  return [{ source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: { name: "Styles", namespace, text: "", attributes: [], children } }];
}

/** Native cell-region XML shares the workbook value/style serializers. */
export function writeClipboardGnumeric(book: Workbook, sheet: Sheet, range: import("../workbook.js").CellRange, context: CapabilityContext): Uint8Array {
  const writer = new XmlWriter(context.limits.outputBytes, context);
  let body = "";
  for (const [kind, info, entries, defaultSize] of [["Cols", "ColInfo", sheet.columns, 48], ["Rows", "RowInfo", sheet.rows, 12.75]] as const) {
    const start = kind === "Cols" ? range.startColumn : range.startRow;
    const end = kind === "Cols" ? range.endColumn : range.endRow;
    body += writer.element(`gnm:${kind}`, { DefaultSizePts: Number(sheet.view?.[kind === "Cols" ? "defaultColumnWidth" : "defaultRowHeight"] ?? defaultSize) }, "",
      entries?.filter(axis => { context.signal.throwIfAborted(); return axis.index >= start && axis.index <= end; }).map(axis => writer.element(`gnm:${info}`, {
        No: axis.index, Unit: axis.sizePoints ?? defaultSize,
        ...Object.fromEntries((Array.isArray(object(axis.style?.gnumeric)?.attributes) ? object(axis.style?.gnumeric)?.attributes as readonly ImportedValue[] : []).flatMap(raw => {
          const attr = object(raw); return attr?.name === "HardSize" && typeof attr.value === "string" ? [["HardSize", attr.value]] : [];
        })),
        ...(axis.hidden ? { Hidden: 1 } : {})
      }, "", "", 2)).join("") ?? "", 1);
  }
  let cells = "";
  const arrays = sheet.formulaGroups?.filter(group => {
    context.signal.throwIfAborted();
    return group.kind === "array" && group.range.startRow <= range.endRow && group.range.endRow >= range.startRow &&
      group.range.startColumn <= range.endColumn && group.range.endColumn >= range.startColumn;
  }) ?? [];
  const dividedArray = arrays.some(group => group.range.startRow < range.startRow || group.range.endRow > range.endRow ||
    group.range.startColumn < range.startColumn || group.range.endColumn > range.endColumn);
  let copiedCells = arrays.length > 0;
  const expressions = new Map<string, number>();
  for (const cell of [...sheet.cells].sort((a, b) => a.row - b.row || a.column - b.column)) {
    context.signal.throwIfAborted();
    if (cell.row < range.startRow || cell.row > range.endRow || cell.column < range.startColumn || cell.column > range.endColumn) continue;
    copiedCells = true;
    const array = sheet.formulaGroups?.find(group => group.kind === "array" && cell.row >= group.range.startRow && cell.row <= group.range.endRow && cell.column >= group.range.startColumn && cell.column <= group.range.endColumn);
    if (array && (cell.row !== array.range.startRow || cell.column !== array.range.startColumn)) continue;
    const value = cell.cachedResult ?? cell.value;
    const attrs: Record<string, string | number> = { Row: cell.row, Col: cell.column };
    let repeated = false;
    if (cell.formula) {
      const key = cell.formulaGroup ?? `${cell.row}:${cell.column}`;
      const existing = expressions.get(key);
      repeated = existing !== undefined;
      const id = existing ?? expressions.size + 1;
      expressions.set(key, id);
      attrs.ExprID = id;
    }
    if (array) { attrs.Rows = array.range.endRow - array.range.startRow + 1; attrs.Cols = array.range.endColumn - array.range.startColumn + 1; }
    if (repeated) { cells += writer.element("gnm:Cell", attrs, "", "", 2); continue; }
    attrs.ValueType = types[value.kind];
    const format = cell.richText ? richFormat(cell.richText) : typeof cell.style?.gnumericValueFormat === "string" ? cell.style.gnumericValueFormat : undefined;
    if (format) attrs.ValueFormat = format;
    if (cell.formula && value.kind !== "byte-string") attrs.Value = valueText(value, context);
    cells += writer.element("gnm:Cell", attrs, cell.formula ?? valueText(value, context), "", 2, true);
  }
  body += emitRetained(clipboardStyleRecords(sheet, range, context), "Styles", 1, writer);
  const merges = clipboardMerges(sheet, range, context);
  const position = (row: number, column: number) => column < 0 ? `[C${column}]${row + 1}` : formatA1(0, column).slice(0, -1) + String(row + 1);
  if (merges.length) body += writer.element("gnm:MergedRegions", {}, "", merges.map(r => writer.element("gnm:Merge", {},
    position(r.startRow, r.startColumn) + (r.startRow === r.endRow && r.startColumn === r.endColumn ? "" : `:${position(r.endRow, r.endColumn)}`), "", 2)).join(""), 1);
  if (copiedCells) body += writer.element("gnm:Cells", {}, "", cells, 1);
  body += emitRetained(clipboardObjectRecords(sheet, range, context), "Objects", 1, writer);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + writer.element("gnm:ClipboardRange", {
    "xmlns:gnm": namespace, xmlns: namespace, Cols: range.endColumn - range.startColumn + 1, Rows: range.endRow - range.startRow + 1,
    BaseCol: range.startColumn, BaseRow: range.startRow, ...(book.dateSystem === "1904" ? { "gnm:DateConvention": "Apple:1904" } : {}), FloatRadix: 2, FloatDigits: 53,
    ...(dividedArray ? { NotAsContent: 1 } : {})
  }, "", body);
  if (utf8Length(xml) > context.limits.outputBytes) limit("output bytes");
  return new TextEncoder().encode(xml);
}

export async function writeGnumeric(book: Workbook, _options: readonly string[], context: CapabilityContext): Promise<Uint8Array> {
  const maximum = context.limits.outputBytes;
  const writer = new XmlWriter(maximum, context);
  context.signal.throwIfAborted(); let output = '<?xml version="1.0" encoding="UTF-8"?>\n';
  let body = writer.element("gnm:Version", { Epoch: 1, Major: 12, Minor: 61, Full: "1.12.61" }, "", "", 1);
  body += emitRetained(book.unsupportedRecords, "Attributes", 1, writer) + emitMetadata(book, writer);
  if (book.dateSystem === "1904") body += writer.element("gnm:DateConvention", {}, "1904", "", 1);
  body += writer.element("gnm:Calculation", { ManualRecalc: book.calculationMode === "manual" ? 1 : 0,
    EnableIteration: book.iteration?.enabled === false ? 0 : 1, MaxIterations: book.iteration?.maximum ?? 100,
    IterationTolerance: book.iteration?.tolerance ?? 0.001, ...(book.dateSystem === "1904" ? { "gnm:DateConvention": "Apple:1904" } : {}), FloatRadix: 2, FloatDigits: 53 }, "", "", 1);
  body += writer.element("gnm:SheetNameIndex", {}, "", book.sheets.map(sheet => writer.element("gnm:SheetName",
    { "gnm:Cols": sheet.size?.columns ?? 256, "gnm:Rows": sheet.size?.rows ?? 65536 }, sheet.name, "", 2)).join(""), 1);
  body += emitNames(book, undefined, 1, writer) + emitRetained(book.unsupportedRecords, "Geometry", 1, writer);
  let sheetXml = "";
  for (const sheet of book.sheets) {
    context.signal.throwIfAborted();
    const view = object(sheet.view?.gnumeric); const attrs: Record<string, string | number> = {
      DisplayFormulas: 0, HideZero: 0, HideGrid: 0, HideColHeader: 0, HideRowHeader: 0, DisplayOutlines: 1, OutlineSymbolsBelow: 1, OutlineSymbolsRight: 1 };
    if (view) for (const [key, val] of Object.entries(view)) if (typeof val === "string" && gnumericAttributes.Sheet?.includes(key)) attrs[key] = val;
    attrs.Visibility = sheet.visibility === "very-hidden" ? "GNM_SHEET_VISIBILITY_VERY_HIDDEN" : sheet.visibility === "hidden" ? "GNM_SHEET_VISIBILITY_HIDDEN" : "GNM_SHEET_VISIBILITY_VISIBLE";
    const extent = sheet.cells.reduce((max, cell) => ({ row: Math.max(max.row, cell.row), column: Math.max(max.column, cell.column) }), { row: 0, column: 0 });
    let content = writer.element("gnm:Name", {}, sheet.name, "", 3) +
      writer.element("gnm:MaxCol", {}, String(extent.column), "", 3) +
      writer.element("gnm:MaxRow", {}, String(extent.row), "", 3) +
      writer.element("gnm:Zoom", {}, gnumericNumber(Number(sheet.view?.zoom ?? 1), false, 4), "", 3) + emitNames(book, sheet, 3, writer);
    content += emitRetained(sheet.unsupportedRecords, "PrintInformation", 3, writer);
    const sourceStyles = sheet.unsupportedRecords?.find(r => r.kind === "Styles" && r.source === "Gnumeric_XmlIO:sax");
    const savedStyle = object(sourceStyles?.data);
    let regions = Array.isArray(savedStyle?.children) ? savedStyle.children.map(r => emitRecord(r, 4, writer)).join("") : "";
    for (const record of sheet.unsupportedRecords ?? []) {
      if (record.disposition !== "retained" || record.kind !== "FormatRange" && record.kind !== "StyleRange") continue;
      const range = object(record.data); if (!range) continue;
      const bounds = [range.startColumn, range.startRow, range.endColumn, range.endRow];
      if (!bounds.every(v => typeof v === "number" && Number.isInteger(v) && v >= 0) || Number(bounds[0]) > Number(bounds[2]) || Number(bounds[1]) > Number(bounds[3])) invalid("invalid style range");
      regions += writer.element("gnm:StyleRegion", { startCol: Number(bounds[0]), startRow: Number(bounds[1]), endCol: Number(bounds[2]), endRow: Number(bounds[3]) }, "",
        importedStyle(object(range.style), typeof range.format === "string" ? range.format : undefined, writer, range.reset === true), 4);
    }
    regions += sheet.cells.filter(c => c.style || c.format).flatMap(c => {
        const saved = object(c.style?.gnumeric);
        const format = c.format?.startsWith("@[") ? undefined : c.format;
        let original: ImportedValue | undefined;
        if (Array.isArray(savedStyle?.children)) for (const region of savedStyle.children) {
          const r = object(region); if (!Array.isArray(r?.attributes) || !Array.isArray(r.children)) continue;
          const bounds = Object.fromEntries(r.attributes.flatMap(a => { const attr = object(a); return attr && typeof attr.name === "string" ? [[attr.name, Number(attr.value)]] : []; }));
          if (c.row >= bounds.startRow! && c.row <= bounds.endRow! && c.column >= bounds.startCol! && c.column <= bounds.endCol!) original = r.children.find(s => object(s)?.name === "Style");
        }
        const originalStyle = object(original);
        const originalFormat = Array.isArray(originalStyle?.attributes) ? originalStyle.attributes.find(a => object(a)?.name === "Format") : undefined;
        if (original && JSON.stringify(original) === JSON.stringify(saved) && (!format || format === object(originalFormat)?.value)) return [];
        const modified = saved ? { ...saved, attributes: [
          ...(Array.isArray(saved.attributes) ? saved.attributes.filter(a => object(a)?.name !== "Format") : []),
          ...(format ? [{ name: "Format", namespace: "", value: format }] : [])] } : undefined;
        const style = modified ? emitRecord(modified, 5, writer) : importedStyle(c.style, format, writer);
        return [writer.element("gnm:StyleRegion", { startCol: c.column, startRow: c.row, endCol: c.column, endRow: c.row }, "", style, 4)];
      }).join("");
    content += regions ? writer.element("gnm:Styles", {}, "", regions, 3) : "";
    for (const [kind, info, entries] of [["Cols", "ColInfo", sheet.columns], ["Rows", "RowInfo", sheet.rows]] as const) {
      const source = object(sheet.unsupportedRecords?.find(r => r.kind === kind && r.source === "Gnumeric_XmlIO:sax")?.data);
      const axisAttrs = Object.fromEntries((Array.isArray(source?.attributes) ? source.attributes : []).flatMap(a => {
        const attr = object(a);
        if (!attr || typeof attr.name !== "string" || typeof attr.value !== "string") return [];
        validateRecordName(attr.name);
        return gnumericAttributes[kind]?.includes(attr.name) ? [[attr.name, attr.value]] : [];
      }));
      const defaultSize = sheet.view?.[kind === "Cols" ? "defaultColumnWidth" : "defaultRowHeight"];
      if (typeof defaultSize === "number" && Number.isFinite(defaultSize) && defaultSize >= 0) axisAttrs.DefaultSizePts = gnumericNumber(defaultSize, false, 4);
      content += writer.element(`gnm:${kind}`, axisAttrs, "", entries?.filter(axis => axis.sizePoints !== undefined || axis.hidden || axis.collapsed || axis.outlineLevel).map(axis => {
        const original = object(axis.style?.gnumeric);
        const attrs = Object.fromEntries((Array.isArray(original?.attributes) ? original.attributes : []).flatMap(a => {
          const attr = object(a); return attr && typeof attr.name === "string" && typeof attr.value === "string" && attr.name === "HardSize" ? [[attr.name, attr.value]] : [];
        }));
        return writer.element(`gnm:${info}`, { ...attrs, No: axis.index, Unit: axis.sizePoints ?? axisAttrs.DefaultSizePts ?? (kind === "Cols" ? 48 : 12.75),
        ...(axis.hidden ? { Hidden: 1 } : {}), ...(axis.collapsed ? { Collapsed: 1 } : {}), ...(axis.outlineLevel ? { OutlineLevel: axis.outlineLevel } : {}) }, "", "", 4);
      }).join("") ?? "", 3);
    }
    for (const kind of ["Selections", "Objects"]) content += emitRetained(sheet.unsupportedRecords, kind, 3, writer);
    const selection = typeof sheet.view?.selection === "string" ? parseA1(sheet.view.selection) : undefined;
    if (selection) content += writer.element("gnm:Selections", { CursorCol: selection.column, CursorRow: selection.row }, "",
      writer.element("gnm:Selection", { startCol: selection.column, startRow: selection.row, endCol: selection.column, endRow: selection.row }, "", "", 4), 3);
    const comments = sheet.unsupportedRecords?.filter(r => r.disposition === "retained" && r.kind === "CellComment").flatMap(r => {
      const data = object(r.data);
      return typeof data?.ObjectBound === "string" && typeof data.Text === "string" ? [writer.element("gnm:CellComment",
        { ObjectBound: data.ObjectBound, ObjectOffset: "1 0 1 0", Direction: 17, Print: 1, Text: data.Text }, "", "", 4)] : [];
    }).join("");
    if (comments) content += writer.element("gnm:Objects", {}, "", comments, 3);
    if (typeof sheet.view?.initialTopLeft === "string") content += writer.element("gnm:SheetLayout", { TopLeft: sheet.view.initialTopLeft }, "", "", 3);
    let cellXml = "";
    for (const cell of [...sheet.cells].sort((a, b) => a.row - b.row || a.column - b.column)) {
      context.signal.throwIfAborted();
      if (!cell.formula && cell.value.kind === "blank") continue;
      const group = sheet.formulaGroups?.find(g => g.kind === "array" && cell.row >= g.range.startRow && cell.row <= g.range.endRow && cell.column >= g.range.startColumn && cell.column <= g.range.endColumn);
      if (group && (cell.row !== group.range.startRow || cell.column !== group.range.startColumn)) continue;
      const cellAttrs: Record<string, string | number> = { Row: cell.row, Col: cell.column };
      if (group) { cellAttrs.Rows = group.range.endRow - group.range.startRow + 1; cellAttrs.Cols = group.range.endColumn - group.range.startColumn + 1; }
      // Released normal writer deliberately omits formula caches.
      if (!cell.formula) { cellAttrs.ValueType = types[cell.value.kind];
        const format = cell.richText ? richFormat(cell.richText) : typeof cell.style?.gnumericValueFormat === "string" ? cell.style.gnumericValueFormat : undefined;
        if (format) cellAttrs.ValueFormat = format;
      }
      cellXml += writer.element("gnm:Cell", cellAttrs, cell.formula ?? valueText(cell.value, context), "", 4);
    }
    content += writer.element("gnm:Cells", {}, "", cellXml, 3);
    if (sheet.merges?.length) content += writer.element("gnm:MergedRegions", {}, "", sheet.merges.map(r => writer.element("gnm:Merge", {},
      `${formatA1(r.startRow, r.startColumn)}:${formatA1(r.endRow, r.endColumn)}`, "", 4)).join(""), 3);
    for (const kind of ["SheetLayout", "Filters", "Solver", "Scenarios"]) content += emitRetained(sheet.unsupportedRecords, kind, 3, writer);
    sheetXml += writer.element("gnm:Sheet", attrs, "", content, 2);
  }
  body += writer.element("gnm:Sheets", {}, "", sheetXml, 1) + writer.element("gnm:UIData", { SelectedTab: Math.max(0, book.sheets.findIndex(s => s.id === book.activeSheet)) }, "", "", 1) + emitRetained(book.unsupportedRecords, "GODoc", 1, writer);
  output += writer.element("gnm:Workbook", { "xmlns:gnm": namespace, "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance", "xsi:schemaLocation": "http://www.gnumeric.org/v9.xsd" }, "", body);
  if (utf8Length(output) > maximum) limit("output bytes");
  const bytes = new TextEncoder().encode(output);
  return bytes;
}

export async function writeCompressedGnumeric(book: Workbook, options: readonly string[], context: CapabilityContext): Promise<Uint8Array> {
  const maximum = (context.limits.workbookTextBytes ?? context.limits.inputBytes) * 8 + (context.limits.workbookNodes ?? 100000) * 256;
  if (!Number.isSafeInteger(maximum)) limit("XML serialization bytes");
  const bytes = await writeGnumeric(book, options, { ...context, limits: { ...context.limits, outputBytes: maximum } });
  const compressed = await transform(bytes, true, context.limits.outputBytes, context);
  // libgsf gzip_output_header emits UNIX regardless of the JavaScript host.
  compressed[9] = 3;
  return compressed;
}
