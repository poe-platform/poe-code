import { decryptOdfEntries } from "./odf-encryption.js";
import { createZipCodec, CodecError, type ZipLimits } from "@poe-code/office-package";
import { parseXmlSteps, XmlLimitError, type XmlElement, type XmlContent } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { MAX_SHEET_SIZE, DEFAULT_SHEET_SIZE, formatA1, type Workbook, type Sheet, type Cell,
  type CellValue, type ImportedValue, type UnsupportedRecord, type AxisMetadata, type Range,
  type NamedExpression, type FormulaGroup } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { gnumericGrammar, odfGrammar, legacyOpenOfficeGrammar } from "../formulas/conventions.js";
import { serializeExpression, quoteNativeSheet } from "../formulas/serialization.js";
import { dateSerial, gregorian } from "../formulas/functions/dates.js";
import { converterLocale } from "../locale/runtime.js";
import { odfReaderStates } from "./odf-schema.js";
import { odfCellStyle, odfSheetMetadata, odfDatabaseRanges } from "./odf-metadata.js";
import { createOdfXml, odfObject, odfAttributes, odfChildren, odfNamespaces, type OdfAttributes } from "./odf-write-support.js";
import { renderCellText } from "../formatting/cell-text.js";
import { createOdfStyles, odfPrintStyles } from "./odf-write-styles.js";
import { odfWriterFunctionNames } from "./odf-function-names.js";
import { writeOdfRegion } from "./odf-write-regions.js";
import type { FormulaNode } from "../formulas/ast.js";
import { serialDate } from "../formulas/functions/dates.js";

const urn = "urn:oasis:names:tc:opendocument:xmlns:";
const namespaces: Readonly<Record<string, readonly string[]>> = {
  OO_NS_OFFICE: [urn + "office:1.0", "http://openoffice.org/2000/office"],
  OO_NS_TABLE: [urn + "table:1.0", "http://openoffice.org/2000/table"],
  OO_NS_TEXT: [urn + "text:1.0", "http://openoffice.org/2000/text"],
  OO_NS_STYLE: [urn + "style:1.0", "http://openoffice.org/2000/style"],
  OO_NS_NUMBER: [urn + "datastyle:1.0", "http://openoffice.org/2000/datastyle"],
  OO_NS_DRAW: [urn + "drawing:1.0", "http://openoffice.org/2000/drawing"],
  OO_NS_CHART: [urn + "chart:1.0", "http://openoffice.org/2000/chart"],
  OO_NS_CHART_OOO: ["http://openoffice.org/2010/chart"],
  OO_NS_DC: ["http://purl.org/dc/elements/1.1/"],
  OO_NS_SVG: [urn + "svg-compatible:1.0", "http://www.w3.org/2000/svg"],
  OO_NS_FORM: [urn + "form:1.0", "http://openoffice.org/2000/form"],
  OO_NS_SCRIPT: [urn + "script:1.0", "http://openoffice.org/2000/script"],
  OO_NS_LOCALC_EXT: ["urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"],
  OO_GNUM_NS_EXT: ["http://www.gnumeric.org/odf-extension/1.0"]
};
const office = namespaces.OO_NS_OFFICE!, table = namespaces.OO_NS_TABLE!, text = namespaces.OO_NS_TEXT!,
  style = namespaces.OO_NS_STYLE!, numberNs = namespaces.OO_NS_NUMBER!;
const mimeVersions = new Map([
  ["application/vnd.oasis.opendocument.spreadsheet", false],
  ["application/vnd.oasis.opendocument.spreadsheet-template", false],
  ["application/vnd.sun.xml.calc", true], ["application/vnd.sun.xml.calc.template", true]
]);
const edges = Object.fromEntries(Object.entries(odfReaderStates).map(([name, source]) => {
  const map = new Map<string, string[][]>();
  for (const line of source.split("\n")) {
    const fields = line.split(" "), key = fields[0] + ":" + fields[3], list = map.get(key) ?? [];
    list.push(fields); map.set(key, list);
  }
  return [name, map];
}));
function invalid(message: string): never { throw new SsconvertError("io", `E Invalid OpenDocument: ${message}`); }
function limit(message: string): never { throw new SsconvertError("resource-limit", `ssconvert OpenDocument ${message} limit exceeded`); }
function attr(node: XmlElement | undefined, name: string, ns: readonly string[] = table): string | undefined {
  return node?.attributes.find(a => a.localName === name && ns.includes(a.namespace))?.value;
}
function children(node: XmlElement | undefined, name: string, ns: readonly string[] = table): XmlElement[] {
  return node?.children.filter(c => c.localName === name && ns.includes(c.namespace)) ?? [];
}
function integer(value: string | undefined, fallback = 1): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) invalid("invalid repeat/span count"); return result;
}
function data(node: XmlElement): ImportedValue {
  return { name: node.localName, namespace: node.namespace, attributes: node.attributes.filter(a =>
    a.namespace !== "http://www.w3.org/2000/xmlns/").map(a => ({ name: a.localName, namespace: a.namespace, value: a.value })),
  text: node.text, children: node.children.map(data), ...(node.children.length ? { content: node.content.flatMap<ImportedValue>(c =>
    c.kind === "text" || c.kind === "cdata" ? [{ kind: "text", text: c.text }] : c.kind === "element" ? [{ kind: "element", index: node.children.indexOf(c) }] : []) } : {}) };
}
function record(node: XmlElement, extra: Readonly<Record<string, ImportedValue>> = {}): UnsupportedRecord {
  return { source: "Gnumeric_OpenCalc:openoffice", kind: node.localName, disposition: "retained", data: { xml: data(node), ...extra } };
}
async function warning(message: string, context: CapabilityContext, code = "odf-import-warning") {
  const rendered = converterLocale(context.environment) === "C"
    ? Array.from(message, c => c.codePointAt(0)! < 128 ? c : "?").join("") : message;
  await context.diagnostic?.({ code, severity: "warning", message, bytes: new TextEncoder().encode(rendered) });
}
function bounds(context: CapabilityContext): ZipLimits {
  return { maxArchiveBytes: Math.min(context.limits.inputBytes, context.limits.compressedBytes ?? context.limits.inputBytes), maxEntryBytes: Math.min(context.limits.inputBytes, context.limits.inflatedBytes ?? context.limits.inputBytes),
    maxTotalBytes: Math.min(context.limits.inputBytes, context.limits.inflatedBytes ?? context.limits.inputBytes), maxMembers: context.limits.zipEntries ?? context.limits.workbookNodes ?? 100000,
    maxPathBytes: 4096, maxDepth: context.limits.xmlDepth ?? 128, maxPaxBytes: context.limits.inputBytes,
    maxTextBytes: context.limits.workbookTextBytes ?? context.limits.inputBytes, chunkSize: 16384 };
}
async function openPackage(bytes: Uint8Array, context: CapabilityContext) {
  context.signal.throwIfAborted();
  const zip = createZipCodec(undefined, { rejectDuplicateNames: true, zip64: true }), limits = bounds(context);
  const archive = await zip.readZipArchive(new Uint8Array(bytes), limits, context.signal);
  for (const entry of archive.entries) {
    if (entry.size > (context.limits.zipRatio ?? 1000) * Math.max(1, entry.data.length)) limit("ZIP ratio");
  }
  const entries = new Map(archive.entries.filter(e => !e.directory).map(e => [e.name, e]));
  for (const entry of entries.values()) if (entry.symlink || entry.name.startsWith("/") || entry.name.includes("\\")
    || entry.name.split("/").some(c => !c || c === "." || c === "..")) invalid("noncanonical ZIP member");
  let decoded = 0, nodes = 0, textBytes = 0, work = 0;
  function charge(amount = 1) {
    context.signal.throwIfAborted();
    if (amount > (context.limits.workbookWork ?? 10000000) - work) limit("work"); work += amount;
  }
  const buffers = new Map<string, Uint8Array>();
  async function read(name: string) {
    const cached = buffers.get(name); if (cached) return cached;
    const entry = entries.get(name); if (!entry) invalid(`missing part '${name}'`);
    const chunks: Uint8Array[] = []; let length = 0;
    for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) {
      if (chunk.length > limits.maxTotalBytes - decoded) limit("decoded bytes");
      decoded += chunk.length; length += chunk.length; charge(chunk.length); chunks.push(chunk);
    }
    const result = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    buffers.set(name, result); return result;
  }
  async function document(name: string) {
    const bytes = await read(name);
    let encoding: "UTF-8" | "UTF-16LE" | "UTF-16BE" = "UTF-8";
    if (bytes[0] === 255 && bytes[1] === 254 || bytes[0] === 60 && bytes[1] === 0) encoding = "UTF-16LE";
    if (bytes[0] === 254 && bytes[1] === 255 || bytes[0] === 0 && bytes[1] === 60) encoding = "UTF-16BE";
    if (bytes.length > (context.limits.workbookTextBytes ?? limits.maxTotalBytes) - textBytes) limit("XML text");
    textBytes += bytes.length;
    const parser = parseXmlSteps(new TextDecoder(encoding, { fatal: true }).decode(bytes), { expectedEncoding: encoding,
      retainContent: true, maxDepth: context.limits.xmlDepth ?? 128, maxNodes: (context.limits.workbookNodes ?? 100000) - nodes,
      maxAttributes: context.limits.workbookNodes ?? 100000, maxTextLength: limits.maxTextBytes,
      onElement() { nodes++; charge(); } });
    let step = parser.next(), ticks = 0;
    while (!step.done) {
      charge(step.value);
      if (++ticks % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      step = parser.next();
    }
    return step.value;
  }
  async function version(fallback: boolean | undefined): Promise<boolean | undefined> {
    if (entries.has("mimetype")) {
      const bytes = await read("mimetype");
      return mimeVersions.get(new TextDecoder().decode(bytes.subarray(0, 2048)));
    }
    if (entries.has("content.xml") && new TextDecoder().decode((await read("content.xml")).subarray(0, 512)).includes(office[0]!)) return false;
    return fallback;
  }
  function retainText(amount: number) {
    if (amount > (context.limits.workbookTextBytes ?? limits.maxTotalBytes) - textBytes) limit("retained text");
    textBytes += amount;
  }
  async function decrypt(manifest: XmlElement) {
    const plaintext = await decryptOdfEntries(manifest, entries, read, context, charge, limits.maxTotalBytes - decoded, limits.maxEntryBytes);
    for (const [name, bytes] of plaintext) { decoded += bytes.length; buffers.set(name, bytes); }
  }
  return { entries, read, document, version, charge, retainText, decrypt };
}
function failure(error: unknown, context: CapabilityContext): never {
  context.signal.throwIfAborted();
  if (error instanceof SyntaxError && error.message === "Invalid XML: DTD and entity declarations are forbidden")
    throw new SsconvertError("capability-denied", "ssconvert host denies XML DTD and entity declarations");
  if (error instanceof SsconvertError) throw error;
  if (error instanceof XmlLimitError || error instanceof CodecError && error.code === "resource-limit") limit("package");
  invalid(error instanceof Error ? error.message : "invalid package");
}
export async function probeOdf(bytes: Uint8Array, context: CapabilityContext): Promise<boolean> {
  try {
    const name = context.inputFilename?.toLowerCase(), old = name?.endsWith(".sxc") || name?.endsWith(".stc");
    return await (await openPackage(bytes, context)).version(old ? true : undefined) !== undefined;
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof CodecError && error.code === "invalid-package" || error instanceof SsconvertError && error.code === "io") return false;
    return failure(error, context);
  }
}
async function recognize(root: XmlElement, schema: string, context: CapabilityContext, charge: (n?: number) => void): Promise<XmlElement> {
  const states = edges[schema]!;
  async function visit(node: XmlElement, state: string, ancestors: readonly string[]): Promise<XmlElement | undefined> {
    charge();
    const edge = states.get(state + ":" + node.localName)?.find(e => namespaces[e[2]!]!.includes(node.namespace));
    if (!edge) {
      if (Object.values(namespaces).some(ns => ns.includes(node.namespace)))
        await warning(`Unexpected element '${node.name}' in state : \n\t${ancestors.join(" -> ")}\n`, context, "odf-unknown-element");
      return undefined;
    }
    const accepted: XmlElement[] = [], replacements = new Map<XmlElement, XmlElement>();
    for (const child of node.children) {
      const result = await visit(child, edge[1]!, [...ancestors, node.localName]); if (result) { accepted.push(result); replacements.set(child, result); }
    }
    return { ...node, children: accepted, content: node.content.flatMap<XmlContent>(c => c.kind !== "element" ? [c] : replacements.has(c) ? [replacements.get(c)!] : []) };
  }
  const accepted = await visit(root, "START", []);
  if (!accepted) invalid(`unrecognized ${schema} root`);
  return accepted;
}
function paragraphs(node: XmlElement, charge: (n?: number) => void): string | undefined {
  const p = children(node, "p", text); if (!p.length) return undefined;
  function inline(node: XmlElement): string {
    let result = "";
    for (const c of node.content) {
      charge();
      if (c.kind === "text" || c.kind === "cdata") result += c.text;
      else if (c.kind === "element" && text.includes(c.namespace)) {
        if (c.localName === "s") { const count = integer(attr(c, "c", text)); charge(count); result += " ".repeat(count); }
        else if (c.localName === "tab" || c.localName === "tab-stop") result += "\t";
        else if (c.localName === "line-break") result += "\n";
        else if (["span", "a"].includes(c.localName)) result += inline(c);
      }
    }
    return result;
  }
  return p.map(inline).join("\n");
}
function typedValue(node: XmlElement, legacy: boolean, dateSystem: "1900" | "1904", charge: (n?: number) => void): CellValue | undefined {
  const ns = legacy ? table : office;
  // Attribute order is observable: OpenCalc takes the first successfully parsed value.
  for (const a of node.attributes) {
    if (!ns.includes(a.namespace)) continue;
    if (a.localName === "value") { const n = Number(a.value); if (Number.isFinite(n)) return { kind: "number", value: n }; }
    if (a.localName === "boolean-value") return { kind: "boolean", value: a.value.toLowerCase() !== "false" && a.value !== "0" };
    if (a.localName === "string-value") return { kind: "string", value: a.value };
    if (a.localName === "date-value") {
      const parts = a.value.split("T"), date = parts[0]!.split("-").map(Number);
      if (date.length !== 3 || date.some(n => !Number.isInteger(n))) continue;
      const d = gregorian(date[0]!, date[1]!, date[2]!);
      if (d.getUTCFullYear() !== date[0] || d.getUTCMonth() + 1 !== date[1] || d.getUTCDate() !== date[2]) continue;
      let fraction = 0;
      if (parts[1]) {
        const time = parts[1].split(":"); const seconds = parseFloat(time[2] ?? "");
        const hour = Number(time[0]), minute = Number(time[1]);
        if (time.length >= 3 && Number.isInteger(hour) && Number.isInteger(minute) && Number.isFinite(seconds))
          fraction = (hour + minute / 60 + seconds / 3600) / 24;
      }
      return { kind: "number", value: dateSerial(d, { book: { sheets: [], dateSystem } }) + fraction };
    }
    if (a.localName === "time-value" && a.value.startsWith("PT")) {
      const h = a.value.indexOf("H"), m = a.value.indexOf("M", h + 1), s = a.value.indexOf("S", m + 1);
      if (h < 2 || m < h || s < m) continue;
      const fields = [a.value.slice(2, h), a.value.slice(h + 1, m), a.value.slice(m + 1, s)].map(Number);
      if (fields.every(n => Number.isInteger(n) && n >= 0)) return { kind: "number", value: (fields[0]! * 3600 + fields[1]! * 60 + fields[2]!) / 86400 };
    }
  }
  const p = paragraphs(node, charge);
  return p !== undefined && (legacy || attr(node, "value-type", office) !== undefined) ? { kind: "string", value: p } : undefined;
}
async function formula(source: string, legacy: boolean, position: { sheet: string; row: number; column: number }, context: CapabilityContext): Promise<string | undefined> {
  let grammar = legacy ? legacyOpenOfficeGrammar : odfGrammar;
  if (!legacy && source.startsWith("oooc:")) { grammar = legacyOpenOfficeGrammar; source = source.slice(5); }
  else if (!legacy && source.startsWith("of:")) source = source.slice(3);
  else if (!legacy && source.startsWith("msoxl:")) { grammar = { ...gnumericGrammar, leftAssociativePower: true }; source = source.slice(6); }
  if (source === "=") return undefined;
  const parsed = parseExpression(source, { grammar, position, signal: context.signal,
    maximumLength: context.limits.workbookTextBytes ?? context.limits.inputBytes, maximumNodes: context.limits.workbookNodes ?? 100000 });
  if (!parsed.ok) {
    await warning(`${position.sheet}!${formatA1(position.row, position.column)} : Unable to parse '${source}'\n`, context);
    return undefined;
  }
  return serializeExpression(parsed.document, { ...gnumericGrammar, quoteSheetName: quoteNativeSheet }, false, true);
}

export async function readOdf(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  try {
    const pkg = await openPackage(bytes, context), version = await pkg.version(true);
    if (version === undefined) invalid("Unknown mimetype for openoffice file.");
    const legacy: boolean = version;
    if (!pkg.entries.has("content.xml")) invalid("No stream named content.xml found.");
    const manifest = pkg.entries.has("META-INF/manifest.xml") ? await pkg.document("META-INF/manifest.xml") : undefined;
    if (manifest) {
      if (manifest.localName !== "manifest" || ![urn + "manifest:1.0", "http://openoffice.org/2001/manifest"].includes(manifest.namespace)) invalid("invalid manifest");
      if (manifest.children.some(entry => entry.children.some(child => child.localName === "encryption-data"))) await pkg.decrypt(manifest);
    }
    const raw = await pkg.document("content.xml");
    const preparseRoot = await recognize(raw, legacy ? "ooo1_content_dtd" : "opendoc_content_dtd", context, pkg.charge);
    const styleRoots = [preparseRoot];
    if (pkg.entries.has("styles.xml")) styleRoots.unshift(await recognize(await pkg.document("styles.xml"), "styles_dtd", context, pkg.charge));
    const root = await recognize(raw, legacy ? "ooo1_content_dtd" : "opendoc_content_dtd", context, pkg.charge);
    const body = children(root, "body", office)[0], spreadsheet = legacy ? body : children(body, "spreadsheet", office)[0];
    if (!spreadsheet) invalid("missing spreadsheet body");
    const calculation = children(spreadsheet, "calculation-settings")[0];
    const dateSystem = attr(children(calculation, "null-date")[0], "date-value")?.startsWith("1904") ? "1904" : "1900";
    const unsupportedRecords: UnsupportedRecord[] = [];
    const styles = readStyles(styleRoots, pkg.charge);
    for (const r of styleRoots) for (const node of r.children) if (["styles", "automatic-styles", "master-styles", "font-face-decls", "font-decls"].includes(node.localName)) unsupportedRecords.push(record(node));
    if (manifest) unsupportedRecords.push(record(manifest));
    for (const name of ["meta.xml", "settings.xml"]) if (pkg.entries.has(name)) unsupportedRecords.push(record(await pkg.document(name)));
    const resources = new Set<string>();
    async function embedded(parent: XmlElement, base = "") {
      for (const node of parent.children) {
        pkg.charge();
        if (namespaces.OO_NS_DRAW!.includes(node.namespace) && ["image", "object", "object-ole"].includes(node.localName)) {
          const href = attr(node, "href", ["http://www.w3.org/1999/xlink"]);
          // Only ZIP-relative relationships are read. URI links remain passive data.
          if (href && !href.includes(":") && !href.startsWith("/") && !href.startsWith("#")) {
            let decoded: string;
            try { decoded = decodeURIComponent(href); } catch { invalid("invalid embedded resource URI"); }
            if (decoded.includes("\\") || decoded.includes(":")) invalid("invalid embedded resource path");
            const components = base.split("/").filter(Boolean);
            for (const part of decoded.split("/")) {
              if (part === "..") { if (!components.length) invalid("embedded resource escapes package"); components.pop(); }
              else if (part && part !== ".") components.push(part);
            }
            const target = components.join("/");
            const parts = node.localName === "object" ? [target + "/content.xml", target + "/styles.xml"] : [target];
            for (const path of parts) if (!resources.has(path) && pkg.entries.has(path)) {
              resources.add(path);
              if (path.endsWith(".xml") && node.localName === "object") {
                const document = await pkg.document(path);
                unsupportedRecords.push({ source: "Gnumeric_OpenCalc:openoffice", kind: "embedded-document", disposition: "retained", data: { path, xml: data(document) } });
                await embedded(document, path.slice(0, path.lastIndexOf("/")));
              } else {
                const bytes = await pkg.read(path); pkg.retainText(bytes.length * 2); pkg.charge(bytes.length);
                let hex = "";
                for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
                unsupportedRecords.push({ source: "Gnumeric_OpenCalc:openoffice", kind: "embedded-resource", disposition: "retained", data: { path, encoding: "hex", bytes: hex } });
              }
            }
          }
        }
        await embedded(node, base);
      }
    }
    await embedded(root);
    const sheets: Sheet[] = [], names: NamedExpression[] = []; let materialized = 0, metadata = 0;
    // OpenCalc's curr_cell survives boundaries; empty-formula error paragraphs
    // write through that pointer (oo_cell_content_end in the released reader).
    let textTarget: { cells: Cell[]; row: number; column: number } | undefined;
    const tables = children(spreadsheet, "table");
    if (tables.length > context.limits.sheets) limit("sheets");
    const sheetNames = new Set<string>();
    for (const [index, node] of tables.entries()) {
      pkg.charge();
      const name = attr(node, "name") ?? `Sheet${index + 1}`;
      if (sheetNames.has(name)) invalid("duplicate sheet name"); sheetNames.add(name);
      const id = name, cells: Cell[] = [], rows: AxisMetadata[] = [], columns: AxisMetadata[] = [], merges: Range[] = [], groups: FormulaGroup[] = [], records: UnsupportedRecord[] = [];
      let row = 0, column = 0, maxRow = 0, maxColumn = 0;
      const columnDefaults: { start: number; end: number; name: string }[] = [];
      const sheetStyle = styles.resolve(attr(node, "style-name"), "table");
      function retain(n: XmlElement, extra: Readonly<Record<string, ImportedValue>> = {}) {
        if (++metadata > (context.limits.workbookNodes ?? 100000)) limit("metadata"); records.push(record(n, extra));
      }
      async function axes(parent: XmlElement, axis: "row" | "column", level = 0): Promise<void> {
        for (const n of parent.children) {
          pkg.charge(); if (!table.includes(n.namespace)) continue;
          if (n.localName === `table-${axis}-group` || n.localName === `table-header-${axis}s` || n.localName === `table-${axis}s`) {
            await axes(n, axis, level + (n.localName.endsWith("-group") ? 1 : 0)); continue;
          }
          if (n.localName !== `table-${axis}`) continue;
          const count = integer(attr(n, `number-${axis}s-repeated`));
          const start = axis === "row" ? row : column, maximum = axis === "row" ? MAX_SHEET_SIZE.rows : MAX_SHEET_SIZE.columns;
          if (count > maximum - start) limit(`${axis} extent`);
          const axisStyle = styles.resolve(attr(n, "style-name"), `table-${axis}`);
          const defaultStyle = attr(n, "default-cell-style-name");
          const size = styles.axisSize(attr(n, "style-name"), axis);
          const hidden = attr(n, "visibility") !== undefined && attr(n, "visibility") !== "visible";
          if (size !== undefined || hidden || level || axisStyle) {
            if (count > (context.limits.workbookNodes ?? 100000) - metadata) limit("axis metadata");
            for (let i = 0; i < count; i++) {
              pkg.charge(); metadata++;
              if (i > 0 && i % 1024 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); pkg.charge(); }
              (axis === "row" ? rows : columns).push({ index: start + i, ...(size === undefined ? {} : { sizePoints: size }),
                ...(hidden ? { hidden } : {}), ...(level ? { outlineLevel: level } : {}), ...(axisStyle ? { style: axisStyle.style } : {}) });
            }
          }
          if (axis === "column") {
            if (defaultStyle) columnDefaults.push({ start, end: start + count, name: defaultStyle }); column += count; continue;
          }
          let cellColumn = 0;
          for (const c of n.children) {
            pkg.charge(); if (!table.includes(c.namespace) || !["table-cell", "covered-table-cell"].includes(c.localName)) continue;
            const repeat = integer(attr(c, "number-columns-repeated"));
            if (repeat > MAX_SHEET_SIZE.columns - cellColumn) limit("column extent");
            if (c.localName === "covered-table-cell") { cellColumn += repeat; continue; }
            const source = attr(c, "formula");
            let value = typedValue(c, legacy, dateSystem, pkg.charge);
            let expression = source ? await formula(source, legacy, { sheet: id, row, column: cellColumn }, context) : undefined;
            let restoredError = false;
            const errorFlag = c.attributes.findIndex(a => a.localName === "error-value" && namespaces.OO_GNUM_NS_EXT!.includes(a.namespace));
            const formulaAttribute = c.attributes.findIndex(a => a.localName === "formula" && table.includes(a.namespace));
            if (expression && errorFlag >= 0 && errorFlag < formulaAttribute) {
              const parsed = parseExpression(expression, { position: { sheet: id, row, column: cellColumn }, signal: context.signal,
                maximumLength: context.limits.workbookTextBytes ?? context.limits.inputBytes, maximumNodes: context.limits.workbookNodes ?? 100000 });
              if (parsed.ok && parsed.document.root.kind === "literal" && parsed.document.root.value.kind === "error") {
                value = parsed.document.root.value; expression = undefined; restoredError = true;
              }
            }
            const errorFormula = source === "=" || source === "of:=" || source === "oooc:=";
            if (source && !expression && !errorFormula && !restoredError) {
              if (++metadata > (context.limits.workbookNodes ?? 100000)) limit("metadata");
              records.push({ source: "Gnumeric_OpenCalc:openoffice", kind: "unparsed-formula", disposition: "retained",
                data: { row, column: cellColumn, formula: source, rows: count, columns: repeat } });
            }
            const hasScalar = c.attributes.some(a => (legacy ? table : office).includes(a.namespace) &&
              ["value", "boolean-value", "string-value", "date-value", "time-value"].includes(a.localName));
            if (errorFormula) {
              const error: CellValue = { kind: "error", value: paragraphs(c, pkg.charge) ?? "#VALUE!" };
              if (textTarget) {
                const at = textTarget.cells.findIndex(cell => cell.row === textTarget!.row && cell.column === textTarget!.column);
                if (at >= 0) textTarget.cells[at] = { ...textTarget.cells[at]!, value: error };
                if (!hasScalar) value = undefined;
              } else { value = error; textTarget = { cells, row, column: cellColumn }; }
            } else if (!expression && !hasScalar && value?.kind === "string") textTarget = { cells, row, column: cellColumn };
            const styleName = attr(c, "style-name") ?? defaultStyle ?? columnDefaults.find(d => cellColumn >= d.start && cellColumn < d.end)?.name;
            const cellStyle = styles.resolve(styleName) ?? styles.defaultCell;
            const width = attr(c, "columns-spanned-fake", namespaces.OO_GNUM_NS_EXT) === "true" ? 1 : integer(attr(c, "number-columns-spanned")), height = integer(attr(c, "number-rows-spanned"));
            if (width > MAX_SHEET_SIZE.columns - cellColumn || height > MAX_SHEET_SIZE.rows - row) limit("merge extent");
            if (width > 1 || height > 1) { merges.push({ startRow: row, startColumn: cellColumn, endRow: row + height - 1, endColumn: cellColumn + width - 1 }); maxRow = Math.max(maxRow, row + height); maxColumn = Math.max(maxColumn, cellColumn + width); }
            const arrayWidth = integer(attr(c, "number-matrix-columns-spanned"), 0), arrayHeight = integer(attr(c, "number-matrix-rows-spanned"), 0);
            let group: string | undefined;
            if (expression && (arrayWidth || arrayHeight)) {
              const w = arrayWidth || 1, h = arrayHeight || 1;
              if (!arrayWidth || !arrayHeight) await warning(`${id}!${formatA1(row, cellColumn)} : Invalid array expression does not specify number of ${!arrayWidth ? "columns" : "rows"}.\n`, context);
              if (w > MAX_SHEET_SIZE.columns - cellColumn || h > MAX_SHEET_SIZE.rows - row) limit("array extent");
              group = `array-${row}-${cellColumn}`; groups.push({ id: group, kind: "array", expression,
                range: { startRow: row, startColumn: cellColumn, endRow: row + h - 1, endColumn: cellColumn + w - 1 } });
              maxRow = Math.max(maxRow, row + h); maxColumn = Math.max(maxColumn, cellColumn + w);
            }
            const validation = attr(c, "content-validation-name");
            for (const child of c.children) if (child.namespace !== text[0] && child.namespace !== text[1] || child.localName !== "p") retain(child, { row, column: cellColumn });
            for (const paragraph of children(c, "p", text)) if (children(paragraph, "a", text).length || children(paragraph, "span", text).length)
              retain(paragraph, { row, column: cellColumn, rows: count, columns: repeat, sourceText: paragraphs(c, pkg.charge) ?? "" });
            if (validation) retain(c, { row, column: cellColumn, rows: count, columns: repeat, validation });
            if (value || expression) {
              const total = count * repeat;
              if (!Number.isSafeInteger(total) || total > context.limits.cells - materialized) limit("cells");
              materialized += total;
              for (let r = 0; r < count; r++) for (let col = 0; col < repeat; col++) {
                pkg.charge(); const first = r === 0 && col === 0;
                if ((r * repeat + col) > 0 && (r * repeat + col) % 1024 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); pkg.charge(); }
                const repeatedStyleName = attr(c, "style-name") ?? defaultStyle ?? columnDefaults.find(d => cellColumn + col >= d.start && cellColumn + col < d.end)?.name;
                const repeatedStyle = col === 0 ? cellStyle : styles.resolve(repeatedStyleName) ?? styles.defaultCell;
                cells.push({ row: row + r, column: cellColumn + col, value: value ?? { kind: "blank" },
                  ...(first && expression ? { formula: expression, formulaDirty: true,
                    ...(value === undefined ? {} : { cachedResult: value }), ...(group ? { formulaGroup: group } : {}) } : {}),
                  ...(repeatedStyle?.format ? { format: repeatedStyle.format } : {}), ...(repeatedStyle ? { style: repeatedStyle.style } : {}) });
              }
              maxRow = Math.max(maxRow, row + count); maxColumn = Math.max(maxColumn, cellColumn + repeat);
            } else if (cellStyle) retain(c, { row, column: cellColumn, rows: count, columns: repeat, styleName: styleName ?? "" });
            cellColumn += repeat;
          }
          row += count;
        }
      }
      await axes(node, "column"); await axes(node, "row");
      const translatedMetadata = [...odfSheetMetadata(node, pkg.charge, styleRoots), ...odfDatabaseRanges(spreadsheet, name, pkg.charge)];
      if (translatedMetadata.length > (context.limits.workbookNodes ?? 100000) - metadata) limit("metadata");
      metadata += translatedMetadata.length; records.push(...translatedMetadata);
      if (groups.length) {
        const positions = new Map(cells.map((c, i) => [`${c.row}:${c.column}`, i]));
        for (const g of groups) {
          const area = (g.range.endRow - g.range.startRow + 1) * (g.range.endColumn - g.range.startColumn + 1);
          pkg.charge(area);
          let tick = 0;
          for (let r = g.range.startRow; r <= g.range.endRow; r++) for (let col = g.range.startColumn; col <= g.range.endColumn; col++) {
            if (++tick % 1024 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); pkg.charge(); }
            const key = `${r}:${col}`, index = positions.get(key);
            if (index === undefined) {
              if (materialized >= context.limits.cells) limit("cells"); materialized++;
              positions.set(key, cells.length); cells.push({ row: r, column: col, value: { kind: "blank" }, formulaGroup: g.id });
            } else {
              const cell = cells[index]!;
              cells[index] = { ...cell, formulaGroup: g.id,
                ...(cell.value.kind === "blank" ? {} : { cachedResult: cell.value }) };
            }
          }
        }
      }
      for (const n of node.children) if (!["table-column", "table-row", "table-column-group", "table-row-group", "table-header-rows", "table-header-columns", "table-columns", "table-rows", "named-expressions"].includes(n.localName)) retain(n);
      if (attr(node, "print-ranges")) retain(node, { printRanges: attr(node, "print-ranges")! });
      await readNames(node, id);
      const sheetProperties = odfChildren(sheetStyle?.style.odf).find(n => odfObject(n)?.name === "table-properties" && odfObject(n)?.namespace === odfNamespaces.style), sheetAttributes = odfAttributes(sheetProperties, odfNamespaces.gnm);
      const viewAttributes: Record<string,string> = { RTL_Layout: odfAttributes(sheetProperties, odfNamespaces.style)["writing-mode"] === "rl-tb" ? "1" : "0" };
      for (const [source,target,invert] of [["display-formulas", "DisplayFormulas",false], ["display-col-header","HideColHeader",true], ["display-row-header","HideRowHeader",true]] as const) {
        if (sheetAttributes[source] !== undefined) viewAttributes[target] = (sheetAttributes[source] === "true") !== invert ? "1" : "0";
      }
      function extent(value: number, minimum: number, maximum: number) { let size = minimum; while (size < value && size < maximum) size *= 2; return Math.min(size, maximum); }
      sheets.push({ id, name, cells: cells.sort((a, b) => a.row - b.row || a.column - b.column),
        size: { rows: extent(Math.max(maxRow, (rows.at(-1)?.index ?? -1) + 1), DEFAULT_SHEET_SIZE.rows, MAX_SHEET_SIZE.rows),
          columns: extent(Math.max(maxColumn, (columns.at(-1)?.index ?? -1) + 1), DEFAULT_SHEET_SIZE.columns, MAX_SHEET_SIZE.columns) },
        ...(sheetStyle?.display === "false" ? { visibility: "hidden" } : {}), rows, columns, merges, formulaGroups: groups, unsupportedRecords: records });
      if (sheetStyle) sheets[sheets.length - 1] = { ...sheets[sheets.length - 1]!, view: { odf: sheetStyle.style.odf ?? null, gnumeric: viewAttributes } };
    }
    async function readNames(parent: XmlElement, sheet?: string) {
      for (const container of children(parent, "named-expressions")) for (const n of container.children) {
        pkg.charge(); const name = attr(n, "name"); if (!name) continue;
        const source = attr(n, "expression") ?? (attr(n, "cell-range-address") ? "=[" + attr(n, "cell-range-address") + "]" : undefined);
        if (!source) continue;
        const initialSheet = sheet ?? sheets[0]?.id ?? (tables[0] ? attr(tables[0], "name") : undefined) ?? "Sheet1";
        const base = attr(n, "base-cell-address");
        const parsedBase = base ? parseExpression("=[" + base + "]", { grammar: odfGrammar,
          position: { sheet: initialSheet, row: 0, column: 0 }, signal: context.signal,
          maximumLength: context.limits.workbookTextBytes ?? context.limits.inputBytes,
          maximumNodes: context.limits.workbookNodes ?? 100000 }) : undefined;
        const endpoint = parsedBase?.ok && parsedBase.document.root.kind === "reference" && !parsedBase.document.root.last
          ? parsedBase.document.root.first : undefined;
        const position = { sheet: endpoint?.sheet ?? initialSheet, row: endpoint?.row?.value ?? 0, column: endpoint?.column?.value ?? 0 };
        const expression = await formula(source, legacy, position, context);
        if (expression) names.push({ name, expression, ...(sheet ? { sheet } : {}), position });
      }
    }
    await readNames(spreadsheet);
    for (const n of spreadsheet.children) if (!["table", "named-expressions", "calculation-settings"].includes(n.localName)) unsupportedRecords.push(record(n));
    if (calculation) unsupportedRecords.push(record(calculation));
    if (!sheets.length) invalid("no sheets");
    const iteration = children(calculation, "iteration")[0];
    return { sheets, names, dateSystem, calculationMode: "automatic", unsupportedRecords,
      ...(iteration ? { iteration: { enabled: attr(iteration, "status") === "enable", maximum: 100,
        tolerance: Number(attr(iteration, "maximum-difference") ?? "0.001") } } : {}) };
  } catch (error) { return failure(error, context); }
}

interface OdfStyle { readonly format?: string; readonly style: Readonly<Record<string, ImportedValue>>; readonly display?: string; }
function readStyles(roots: readonly XmlElement[], charge: (n?: number) => void) {
  const nodes = new Map<string, XmlElement>(), formats = new Map<string, string>(); let defaultNode: XmlElement | undefined;
  for (const root of roots) for (const container of root.children) if (["styles", "automatic-styles"].includes(container.localName)) for (const n of container.children) {
    charge();
    const name = attr(n, "name", style);
    const family = attr(n, "family", style);
    if (style.includes(n.namespace) && n.localName === "style" && name && family) nodes.set(family + ":" + name, n);
    if (style.includes(n.namespace) && n.localName === "default-style" && attr(n, "family", style) === "table-cell") defaultNode = n;
    if (numberNs.includes(n.namespace) && name) formats.set(name, numberFormat(n, charge));
  }
  const cache = new Map<string, OdfStyle>();
  function resolve(name: string | undefined, family = "table-cell", ancestors = new Set<string>()): OdfStyle | undefined {
    if (!name) return undefined;
    const key = family + ":" + name, cached = cache.get(key); if (cached) return cached;
    const node = nodes.get(key); if (!node) return undefined; charge();
    if (ancestors.has(key)) invalid("cyclic style inheritance");
    const next = new Set(ancestors); next.add(key);
    const parent = resolve(attr(node, "parent-style-name", style), family, next), format = formats.get(attr(node, "data-style-name", style) ?? "") ?? parent?.format;
    const display = node.children.map(n => attr(n, "display", table)).find(v => v !== undefined) ?? parent?.display;
    const result = { ...(format ? { format } : {}), style: { ...parent?.style, odf: data(node), gnumeric: odfCellStyle(node, parent?.style.gnumeric, charge) }, ...(display ? { display } : {}) };
    cache.set(key, result); return result;
  }
  function axisSize(name: string | undefined, axis: "row" | "column"): number | undefined {
    const family = `table-${axis}`;
    let node = name ? nodes.get(family + ":" + name) : undefined; const seen = new Set<XmlElement>();
    while (node) {
      charge(); if (seen.has(node)) invalid("cyclic axis style inheritance"); seen.add(node);
      const property = node.children.find(n => style.includes(n.namespace) && ["properties", `table-${axis}-properties`].includes(n.localName));
      const source = attr(property, axis === "row" ? "row-height" : "column-width", style);
      if (source) {
        const units: Readonly<Record<string, number>> = { cm: 72 / 2.54, mm: 72 / 25.4, in: 72, pt: 1, pc: 12 };
        const unit = source.slice(-2), value = Number(source.slice(0, -2)), factor = units[unit];
        if (factor && Number.isFinite(value) && value >= 0) return value * factor;
      }
      const parent = attr(node, "parent-style-name", style); node = parent ? nodes.get(family + ":" + parent) : undefined;
    }
    return undefined;
  }
  return { resolve, axisSize, defaultCell: defaultNode ? { style: { odf: data(defaultNode), gnumeric: odfCellStyle(defaultNode, undefined, charge) }, format: formats.get(attr(defaultNode, "data-style-name", style) ?? "") } : undefined };
}
function numberFormat(node: XmlElement, charge: (n?: number) => void): string {
  let result = "";
  for (const n of node.children) {
    charge(); if (!numberNs.includes(n.namespace)) continue;
    const long = attr(n, "style", numberNs) === "long";
    if (n.localName === "text" || n.localName === "currency-symbol") result += '"' + n.text.split('"').join('""') + '"';
    else if (n.localName === "number" || n.localName === "scientific-number") {
      const digits = integer(attr(n, "decimal-places", numberNs), 0), minimum = integer(attr(n, "min-integer-digits", numberNs), 1);
      charge(digits + minimum);
      result += (attr(n, "grouping", numberNs) === "true" ? "#,##" : "") + "0".repeat(minimum) + (digits ? "." + "0".repeat(digits) : "");
      if (n.localName === "scientific-number") {
        const exponentDigits = integer(attr(n, "min-exponent-digits", numberNs), 2);
        charge(exponentDigits); result += "E+" + "0".repeat(exponentDigits);
      }
    } else if (n.localName === "day") result += long ? "dd" : "d";
    else if (n.localName === "month") result += attr(n, "textual", numberNs) === "true" ? long ? "mmmm" : "mmm" : long ? "mm" : "m";
    else if (n.localName === "year") result += long ? "yyyy" : "yy";
    else if (n.localName === "day-of-week") result += long ? "dddd" : "ddd";
    else if (n.localName === "hours") result += attr(node, "truncate-on-overflow", numberNs) === "false" ? "[h]" : long ? "hh" : "h";
    else if (n.localName === "minutes") result += long ? "mm" : "m";
    else if (n.localName === "seconds") result += long ? "ss" : "s";
    else if (n.localName === "am-pm") result += "AM/PM";
    else if (n.localName === "text-content") result += "@";
  }
  return result || "General";
}

/** Released savers share OpenFormula conventions, but only odf emits extensions. */
export function createOdfWriter(profile: "strict" | "extended") {
  return async (book: Workbook, _options: readonly string[], context: CapabilityContext): Promise<Uint8Array> => {
    context.signal.throwIfAborted();
    const extended = profile === "extended", xml = createOdfXml(context, extended), e = xml.element;
    const cellStyles = createOdfStyles(xml, extended, book, context);
    const zip = createZipCodec(), zipLimits = { ...bounds(context), maxArchiveBytes: context.limits.outputBytes,
      maxEntryBytes: context.limits.outputBytes, maxTotalBytes: context.limits.outputBytes };
    let count = 0;
    if (!book.sheets.length || book.sheets.length > context.limits.sheets) limit("sheets");
    function coordinate(value: number, maximum: number) {
      xml.charge(); if (!Number.isSafeInteger(value) || value < 0 || value >= maximum)
        throw new SsconvertError("invalid-request", "Invalid OpenDocument cell coordinate");
    }
    function range(r: Range) {
      coordinate(r.startRow, MAX_SHEET_SIZE.rows); coordinate(r.endRow, MAX_SHEET_SIZE.rows);
      coordinate(r.startColumn, MAX_SHEET_SIZE.columns); coordinate(r.endColumn, MAX_SHEET_SIZE.columns);
      if (r.startRow > r.endRow || r.startColumn > r.endColumn) throw new SsconvertError("invalid-request", "Invalid OpenDocument range");
    }
    function expression(source: string, sheet: Sheet, row: number, column: number) {
      xml.charge(source.length);
      const parsed = parseExpression(source, { grammar: gnumericGrammar, position: { sheet: sheet.id, row, column }, workbook: book,
        signal: context.signal, maximumLength: context.limits.workbookTextBytes ?? context.limits.outputBytes,
        maximumNodes: context.limits.workbookNodes ?? 100000 });
      if (!parsed.ok) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: invalid OpenDocument formula");
      const aliases: Record<string,string> = { ...odfGrammar.functionExportAliases, ...odfWriterFunctionNames };
      function visit(node: FormulaNode) {
        xml.charge();
        if (node.kind === "call") {
          if (!Object.hasOwn(aliases, node.name)) aliases[node.name] = node.name.startsWith("ODF.") ? node.name.slice(4) : "ORG.GNUMERIC." + node.name;
          node.args.forEach(visit);
        } else if (node.kind === "array") node.rows.forEach(row => row.forEach(visit));
        else if (node.kind === "binary") { visit(node.left); visit(node.right); }
        else if (node.kind === "unary" || node.kind === "parentheses") visit(node.child);
      }
      visit(parsed.document.root);
      return serializeExpression(parsed.document, { ...odfGrammar, functionExportAliases: aliases }, false, true);
    }
    function names(scope?: string) {
      let body = "";
      for (const n of book.names ?? []) {
        xml.charge(); if (n.sheet !== scope) continue;
        const sheet = book.sheets.find(s => s.id === (n.position?.sheet ?? scope) || s.name === (n.position?.sheet ?? scope)) ?? book.sheets[0]!;
        const row = n.position?.row ?? 0, column = n.position?.column ?? 0;
        coordinate(row, MAX_SHEET_SIZE.rows); coordinate(column, MAX_SHEET_SIZE.columns);
        const formula = expression(n.expression, sheet, row, column);
        const address = formatA1(row, column), base = quoteNativeSheet(sheet.name) + ".$" + address.slice(0, address.length - String(row + 1).length) + "$" + (row + 1);
        const parsed = parseExpression(n.expression, { position: { sheet: sheet.id, row, column }, workbook: book, signal: context.signal });
        body += parsed.ok && parsed.document.root.kind === "reference" ? e("table:named-range", {
          "table:name": n.name, "table:cell-range-address": formula.slice(5, -1), "table:base-cell-address": base
        }) : e("table:named-expression", { "table:name": n.name, "table:expression": formula, "table:base-cell-address": base });
      }
      return e("table:named-expressions", {}, body);
    }
    const iteration = book.iteration;
    const prelude = e("table:calculation-settings", { "table:null-year": 1930, "table:automatic-find-labels": "false",
      "table:case-sensitive": "false", "table:precision-as-shown": "false", "table:search-criteria-must-apply-to-whole-cell": "true",
      "table:use-regular-expressions": "false", "table:use-wildcards": "false" },
    e("table:null-date", { "table:date-value": book.dateSystem === "1904" ? "1904-1-1" : "1899-12-30", "table:value-type": "date" }) +
      e("table:iteration", { "table:status": iteration?.enabled ? "enable" : "disable", "table:steps": iteration?.maximum ?? 100,
        "table:maximum-difference": iteration?.tolerance ?? 0.001 }));
    let automatic = "", masters = "", styleBody = "", fontFaces = "", pageLayouts = "", spreadsheet = "", validations = "", databaseRanges = "";
    for (const record of book.unsupportedRecords ?? []) {
      xml.charge(); const v = odfObject(record.data), node = odfObject(v?.xml);
      if (record.source === "Gnumeric_OpenCalc:openoffice" && node) {
        if (["automatic-styles", "font-face-decls", "styles", "master-styles"].includes(record.kind)) {
          const content = odfChildren(node).map(n => xml.retained(n)).join("");
          if (record.kind === "automatic-styles") automatic += content;
          else if (record.kind === "master-styles") masters += content;
          else if (record.kind === "font-face-decls") fontFaces += content;
          else styleBody += content;
        } else if (record.kind === "content-validations") validations += odfChildren(node).map(n => xml.retained(n)).join("");
        else if (record.kind === "database-ranges") databaseRanges += xml.retained(node);
      }
    }
    for (const [index, sheet] of book.sheets.entries()) {
      xml.charge(); const sheetStyle = "ta" + index;
      const view = odfObject(sheet.view?.gnumeric) ?? {}, properties = odfChildren(sheet.view?.odf).find(n => odfObject(n)?.name === "table-properties");
      const originalProperties = odfAttributes(properties, odfNamespaces.gnm);
      const print = odfPrintStyles((sheet.unsupportedRecords ?? []).filter(r => r.kind === "PrintInformation").flatMap(r => r.data ? [r.data] : []), index, xml, extended);
      pageLayouts += print.layout; masters += print.master;
      automatic += e("style:style", { "style:name": sheetStyle, "style:family": "table", "style:master-page-name": "mp" + index }, e("style:table-properties", {
        "table:display": sheet.visibility && sheet.visibility !== "visible" ? "false" : "true", "style:writing-mode": Number(view.RTL_Layout ?? 0) ? "rl-tb" : "lr-tb",
        ...(extended ? { "gnm:display-formulas": String(Boolean(Number(view.DisplayFormulas ?? 0))), "gnm:display-col-header": String(!Number(view.HideColHeader ?? 0)),
          "gnm:display-row-header": String(!Number(view.HideRowHeader ?? 0)), "gnm:tab-color": originalProperties["tab-color"], "gnm:tab-text-color": originalProperties["tab-text-color"] } : {}) }));
      const addresses = new Map<string, Cell>(), rowCells = new Map<number, Map<number, Cell>>();
      for (const cell of sheet.cells) {
        coordinate(cell.row, MAX_SHEET_SIZE.rows); coordinate(cell.column, MAX_SHEET_SIZE.columns);
        if (++count > context.limits.cells) limit("cells");
        addresses.set(`${cell.row}:${cell.column}`, cell);
      }
      const annotations = new Map<string,string>(), passive = new Map<string,string>(), originalParagraphs = new Map<string,{ text: string; xml: string; range: Range }>();
      const cellMetadata: { range: Range; style?: string | undefined; validation?: string | undefined; link?: OdfAttributes | undefined }[] = [];
      const links = new Map<string,OdfAttributes>();
      for (const record of sheet.unsupportedRecords ?? []) {
        xml.charge(); const v = odfObject(record.data), node = odfObject(v?.xml);
        if (record.source === "Gnumeric_OpenCalc:openoffice" && node && typeof v?.row === "number" && typeof v.column === "number") {
          coordinate(v.row, MAX_SHEET_SIZE.rows); coordinate(v.column, MAX_SHEET_SIZE.columns);
          const key = `${v.row}:${v.column}`;
          if (record.kind === "table-cell") {
            const rows = typeof v.rows === "number" ? v.rows : 1, columns = typeof v.columns === "number" ? v.columns : 1;
            if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows < 1 || columns < 1)
              throw new SsconvertError("invalid-request", "Invalid OpenDocument metadata repeat");
            const r = { startRow: v.row, startColumn: v.column, endRow: v.row + rows - 1, endColumn: v.column + columns - 1 }; range(r);
            cellMetadata.push({ range: r, style: odfAttributes(node, odfNamespaces.table)["style-name"] ?? (typeof v.styleName === "string" ? v.styleName : undefined),
              validation: typeof v.validation === "string" ? v.validation : undefined });
          } else if (record.kind === "p" && typeof v.sourceText === "string") {
            const rows = typeof v.rows === "number" ? v.rows : 1, columns = typeof v.columns === "number" ? v.columns : 1;
            const r = { startRow: v.row, startColumn: v.column, endRow: v.row + rows - 1, endColumn: v.column + columns - 1 }; range(r);
            const previous = originalParagraphs.get(key); originalParagraphs.set(key,{ text: v.sourceText, xml: (previous?.xml ?? "") + xml.retained(node), range: r });
          } else {
            passive.set(key,(passive.get(key) ?? "") + xml.retained(node));
            if (!addresses.has(key)) {
              if (++count > context.limits.cells) limit("cells");
              addresses.set(key,{ row: v.row, column: v.column, value: { kind: "blank" } });
            }
          }
        } else if (record.kind === "Styles") for (const region of odfChildren(record.data)) {
          xml.charge(); const a = odfAttributes(region), style = odfChildren(region).find(n => odfObject(n)?.name === "Style");
          if (!style) continue;
          const r = { startRow: Number(a.startRow), endRow: Number(a.endRow), startColumn: Number(a.startCol), endColumn: Number(a.endCol) }; range(r);
          const metadata = await writeOdfRegion(style,r,`rg${index}_${cellMetadata.length}`,sheet,xml,cellStyles,context,expression);
          automatic += metadata.styleXml;
          validations += metadata.validationXml;
          cellMetadata.push({ range: r, style: metadata.styleName, validation: metadata.validationName, link: metadata.link });
        } else if (record.kind === "Objects") for (const object of odfChildren(record.data)) {
          xml.charge(); const n = odfObject(object), a = odfAttributes(object);
          if ((n?.name === "CellComment" || n?.name === "GnmCellComment") && a.ObjectBound) {
            const address = parseExpression("=" + a.ObjectBound.split(":")[0], { position: { sheet: sheet.id, row: 0, column: 0 }, signal: context.signal });
            if (address.ok && address.document.root.kind === "reference") {
              const ref = address.document.root.first, row = ref.row?.value ?? 0, column = ref.column?.value ?? 0, key = `${row}:${column}`;
              coordinate(row, MAX_SHEET_SIZE.rows); coordinate(column, MAX_SHEET_SIZE.columns);
              annotations.set(key,e("office:annotation", {}, (a.Author === undefined ? "" : e("dc:creator", {}, xml.escape(a.Author))) + e("text:p", {}, xml.text(a.Text ?? ""))));
              if (!addresses.has(key)) {
                if (++count > context.limits.cells) limit("cells");
                addresses.set(key,{ row, column, value: { kind: "blank" } });
              }
            }
          } else await warning(`ODF ${profile} writer does not export sheet '${sheet.name}' object '${String(n?.name ?? "unknown")}'\n`,context,"odf-write-loss");
        }
      }
      for (const cell of addresses.values()) {
        const node = cell.style?.gnumeric;
        const link = odfChildren(node).find(n => odfObject(n)?.name === "HyperLink"), a = odfAttributes(link);
        if (a.target) links.set(`${cell.row}:${cell.column}`, { "xlink:href": a.type === "GnmHLinkCurWB" ? "#" + a.target.split("!").join(".") : a.target,
          "xlink:type": "simple", "office:title": a.tip });
      }
      const events = new Set<number>([0]);
      for (const cell of addresses.values()) {
        const group = rowCells.get(cell.row) ?? new Map<number, Cell>(); group.set(cell.column, cell); rowCells.set(cell.row, group);
        events.add(cell.row); events.add(cell.row + 1);
      }
      const admittedMerges: Range[] = [];
      for (const r of sheet.merges ?? []) {
        range(r);
        for (const previous of admittedMerges) {
          xml.charge();
          if (r.startRow <= previous.endRow && r.endRow >= previous.startRow &&
            r.startColumn <= previous.endColumn && r.endColumn >= previous.startColumn)
            throw new SsconvertError("invalid-request", "Invalid overlapping OpenDocument merges");
        }
        admittedMerges.push(r);
        events.add(r.startRow); events.add(r.startRow + 1); events.add(r.endRow); events.add(r.endRow + 1);
      }
      for (const { range: r } of cellMetadata) { events.add(r.startRow); events.add(r.endRow + 1); }
      for (const axis of sheet.rows ?? []) { coordinate(axis.index, MAX_SHEET_SIZE.rows); events.add(axis.index); events.add(axis.index + 1); }
      let rowCount = sheet.size?.rows ?? DEFAULT_SHEET_SIZE.rows;
      coordinate(rowCount - 1, MAX_SHEET_SIZE.rows);
      for (const event of events) rowCount = Math.max(rowCount,event);
      events.add(rowCount);
      let tableBody = "", position = 0;
      for (const [i, axis] of [...(sheet.columns ?? [])].sort((a,b) => a.index - b.index).entries()) {
        coordinate(axis.index, MAX_SHEET_SIZE.columns);
        if (axis.index < position) throw new SsconvertError("invalid-request", "Duplicate OpenDocument column metadata");
        if (axis.index > position) tableBody += e("table:table-column", { "table:number-columns-repeated": axis.index - position });
        const name = `co${index}_${i}`;
        automatic += e("style:style", { "style:name": name, "style:family": "table-column" }, e("style:table-column-properties", {
          "style:column-width": axis.sizePoints === undefined ? undefined : axis.sizePoints + "pt" }));
        tableBody += e("table:table-column", { "table:style-name": name, "table:visibility": axis.hidden ? "collapse" : "visible" }); position = axis.index + 1;
      }
      let columnCount = Math.max(sheet.size?.columns ?? DEFAULT_SHEET_SIZE.columns, position);
      coordinate(columnCount - 1, MAX_SHEET_SIZE.columns);
      for (const cell of addresses.values()) columnCount = Math.max(columnCount,cell.column + 1);
      for (const { range: r } of cellMetadata) columnCount = Math.max(columnCount,r.endColumn + 1);
      for (const r of sheet.merges ?? []) columnCount = Math.max(columnCount,r.endColumn + 1);
      if (columnCount > position) tableBody += e("table:table-column", { "table:number-columns-repeated": columnCount - position > 1 ? columnCount - position : undefined });
      const sorted = [...events].sort((a,b) => a-b);
      for (let event = 0; event < sorted.length - 1 || event === 0; event++) {
        const row = sorted[event]!, repeat = (sorted[event + 1] ?? row + 1) - row;
        if (row >= MAX_SHEET_SIZE.rows) break;
        xml.charge(); if (event % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); context.signal.throwIfAborted(); }
        const cells = rowCells.get(row) ?? new Map<number, Cell>(), merges = (sheet.merges ?? []).filter(r => row >= r.startRow && row <= r.endRow);
        xml.charge(sheet.merges?.length ?? 0);
        xml.charge(cellMetadata.length);
        const metadata = cellMetadata.filter(m => row >= m.range.startRow && row <= m.range.endRow).reverse();
        const columns = new Set<number>();
        for (const c of cells.keys()) { columns.add(c); columns.add(c + 1); }
        for (const m of merges) { columns.add(m.startColumn); columns.add(m.startColumn + 1); columns.add(m.endColumn + 1); }
        for (const m of metadata) { columns.add(m.range.startColumn); columns.add(m.range.endColumn + 1); }
        const stops = [...columns].sort((a,b) => a-b); let body = "", col = 0;
        for (const start of stops) {
          xml.charge(); if (start < col || start >= MAX_SHEET_SIZE.columns) continue;
          if (start > col) body += e("table:table-cell", start - col > 1 ? { "table:number-columns-repeated": start - col } : {});
          const cell = cells.get(start), merge = merges.find(r => start >= r.startColumn && start <= r.endColumn);
          const meta = metadata.find(m => start >= m.range.startColumn && start <= m.range.endColumn);
          if (merge && (row !== merge.startRow || start !== merge.startColumn)) {
            const next = Math.min(merge.endColumn + 1, stops.find(s => s > start) ?? merge.endColumn + 1);
            body += e("table:covered-table-cell", next - start > 1 ? { "table:number-columns-repeated": next - start } : {}); col = next; continue;
          }
          if (!cell && !merge && !meta) { col = start; continue; }
          const a: Record<string, string | number | undefined> = {};
          if (cell && !cell.formula && cell.value.kind === "error") {
            if (extended) a["gnm:error-value"] = cell.value.value;
            a["table:formula"] = "of:=" + cell.value.value;
          }
          if (merge) { a["table:number-columns-spanned"] = merge.endColumn - merge.startColumn + 1; a["table:number-rows-spanned"] = merge.endRow - merge.startRow + 1; }
          const key = `${row}:${start}`;
          const group = sheet.formulaGroups?.find(g => g.kind === "array" && row >= g.range.startRow && row <= g.range.endRow && start >= g.range.startColumn && start <= g.range.endColumn);
          xml.charge(sheet.formulaGroups?.length ?? 0);
          if (cell?.formula && (!group || row === group.range.startRow && start === group.range.startColumn)) {
            a["table:formula"] = expression(cell.formula, sheet, row, start);
            if (group) { range(group.range); a["table:number-matrix-columns-spanned"] = group.range.endColumn - start + 1; a["table:number-matrix-rows-spanned"] = group.range.endRow - row + 1; }
          }
          a["table:content-validation-name"] = meta?.validation;
          if (meta?.style) a["table:style-name"] = meta.style;
          let content = (passive.get(key) ?? "") + (annotations.get(key) && !passive.get(key)?.includes("office:annotation") ? annotations.get(key) : "");
          if (cell) {
            const style = cellStyles.register(cell); if (style.name && !meta?.style) a["table:style-name"] = style.name;
            const value = cell.formula ? cell.cachedResult ?? cell.value : cell.value;
            if (value.kind === "number") {
              if (!Number.isFinite(value.value)) throw new SsconvertError("invalid-request", "Invalid OpenDocument numeric value");
              if (style.kind === "date") {
                const date = serialDate(value.value, { book });
                if (!date) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: OpenDocument date outside supported calendar");
                a["office:value-type"] = "date";
                const seconds = Math.round((value.value - Math.floor(value.value)) * 86400) % 86400;
                a["office:date-value"] = date.toISOString().slice(0,10) + (value.value !== Math.floor(value.value) ? "T" + [Math.floor(seconds/3600), Math.floor(seconds/60)%60, seconds%60].map(n => String(n).padStart(2,"0")).join(":") : "");
              } else if (style.kind === "time" && value.value >= 0) {
                a["office:value-type"] = "time"; const seconds = Math.round(value.value * 86400);
                a["office:time-value"] = `PT0${Math.floor(seconds/3600)}H${String(Math.floor(seconds/60)%60).padStart(2,"0")}M${String(seconds%60).padStart(2,"0")}S`;
              } else { a["office:value-type"] = "float"; a["office:value"] = value.value; }
            }
            else if (value.kind === "boolean") { a["office:value-type"] = "boolean"; a["office:boolean-value"] = String(value.value); }
            else if (value.kind === "string" || value.kind === "error") {
              a["office:value-type"] = "string";
              if (cell.formula || value.kind === "error") a["office:string-value"] = value.value;
              if (value.kind === "error" && !cell.formula) { a["table:formula"] = "of:=" + value.value; if (extended) a["gnm:error-value"] = value.value; }
            }
            xml.charge(originalParagraphs.size);
            const renderedText = cell.displayedText ?? await renderCellText(cell, book, context), rendered = xml.text(renderedText), paragraph = originalParagraphs.get(key) ??
              [...originalParagraphs.values()].find(p => row >= p.range.startRow && row <= p.range.endRow && start >= p.range.startColumn && start <= p.range.endColumn);
            const link = meta?.link ?? links.get(key);
            content += paragraph?.text === renderedText ? paragraph.xml : e("text:p", {}, link ? e("text:a", link, rendered) : rendered);
          }
          const next = !cell && !merge && meta ? Math.min(meta.range.endColumn + 1, stops.find(s => s > start) ?? meta.range.endColumn + 1) : start + 1;
          if (next - start > 1) a["table:number-columns-repeated"] = next - start;
          body += e("table:table-cell", a, content); col = next;
        }
        if (col < columnCount) body += e("table:table-cell", { "table:number-columns-repeated": columnCount - col > 1 ? columnCount - col : undefined });
        const axis = sheet.rows?.find(a => a.index === row); const rowAttributes: Record<string, string | number | undefined> = {
          "table:number-rows-repeated": repeat > 1 ? repeat : undefined, "table:visibility": axis?.hidden ? "collapse" : undefined };
        if (axis?.sizePoints !== undefined) {
          const name = `ro${index}_${row}`; automatic += e("style:style", { "style:name": name, "style:family": "table-row" },
            e("style:table-row-properties", { "style:row-height": axis.sizePoints + "pt" })); rowAttributes["table:style-name"] = name;
        }
        tableBody += e("table:table-row", rowAttributes, body);
      }
      spreadsheet += e("table:table", { "table:name": sheet.name, "table:style-name": sheetStyle }, tableBody + names(sheet.id));
    }
    spreadsheet = prelude + (validations ? e("table:content-validations", {}, validations) : "") + spreadsheet + names() + databaseRanges;
    const parts = new Map<string, Uint8Array>(), encoder = new TextEncoder();
    function part(name: string, value: string) { parts.set(name, encoder.encode(value)); }
    part("mimetype", "application/vnd.oasis.opendocument.spreadsheet");
    part("content.xml", xml.document("office:document-content", e("office:scripts") + e("office:font-face-decls") + e("office:automatic-styles", {}, automatic + cellStyles.styles.join("")) + e("office:body", {}, e("office:spreadsheet", {}, spreadsheet))));
    part("styles.xml", xml.document("office:document-styles", e("office:font-face-decls", {}, fontFaces) + e("office:styles", {}, styleBody) + e("office:automatic-styles", {}, pageLayouts) + e("office:master-styles", {}, masters)));
    part("meta.xml", xml.document("office:document-meta", e("office:meta", {}, e("meta:generator", {}, "Gnumeric/1.12.61"))));
    part("settings.xml", xml.document("office:document-settings", e("office:settings", {}, e("config:config-item-set", { "config:name": "gnm:settings" },
      e("config:config-item", { "config:name": "gnm:has_foreign", "config:type": "boolean" }, String(extended)) +
      e("config:config-item", { "config:name": "gnm:active-sheet", "config:type": "string" }, xml.escape(book.sheets.find(s => s.id === book.activeSheet)?.name ?? book.sheets[0]!.name))))));
    for (const record of book.unsupportedRecords ?? []) {
      xml.charge(); const v = odfObject(record.data);
      if (record.source !== "Gnumeric_OpenCalc:openoffice" || !v) continue;
      if ((record.kind === "embedded-resource" || record.kind === "embedded-document") && typeof v.path === "string") {
        const path = v.path;
        if (parts.has(path) || path.startsWith("/") || path.includes("\\") || path.split("/").some(p => !p || p === "." || p === ".."))
          throw new SsconvertError("invalid-request", "Invalid OpenDocument embedded path");
        if (record.kind === "embedded-document") {
          const root = odfObject(v.xml);
          if (root?.name !== "document-content" && root?.name !== "document-styles")
            throw new SsconvertError("invalid-request", "Invalid OpenDocument embedded document root");
          part(path, xml.document("office:" + root.name, odfChildren(v.xml).map(n => xml.retained(n)).join("")));
        }
        else if (v.encoding === "hex" && typeof v.bytes === "string") {
          xml.charge(v.bytes.length);
          if (v.bytes.length % 2 || [...v.bytes].some(c => !"0123456789abcdefABCDEF".includes(c))) throw new SsconvertError("invalid-request", "Invalid OpenDocument embedded bytes");
          if (v.bytes.length / 2 > context.limits.outputBytes) limit("embedded bytes");
          const bytes = new Uint8Array(v.bytes.length/2);
          for (let i=0;i<bytes.length;i++) bytes[i] = parseInt(v.bytes.slice(i*2,i*2+2),16);
          parts.set(path,bytes);
        }
      } else if (["document-meta", "document-settings"].includes(record.kind) && v.xml) {
        part(record.kind === "document-meta" ? "meta.xml" : "settings.xml", xml.document("office:" + record.kind, odfChildren(v.xml).map(n => xml.retained(n)).join("")));
      }
    }
    part("META-INF/manifest.xml", '<?xml version="1.0" encoding="UTF-8"?>' + e("manifest:manifest", {
      "xmlns:manifest": "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0", "manifest:version": "1.2" },
    e("manifest:file-entry", { "manifest:full-path": "/", "manifest:media-type": "application/vnd.oasis.opendocument.spreadsheet", "manifest:version": "1.2" }) +
      (book.unsupportedRecords ?? []).filter(r => r.kind === "embedded-document").flatMap(r => {
        const v = odfObject(r.data); return typeof v?.path === "string" && v.path.endsWith("/content.xml") ? [e("manifest:file-entry", {
          "manifest:full-path": v.path.slice(0,-"content.xml".length), "manifest:media-type": "application/vnd.oasis.opendocument.chart" })] : [];
      }).join("") +
      [...parts.keys()].filter(n => n !== "mimetype").map(n => e("manifest:file-entry", { "manifest:full-path": n, "manifest:media-type": n.endsWith(".xml") ? "text/xml" : n.endsWith(".png") ? "image/png" : n.endsWith(".jpg") || n.endsWith(".jpeg") ? "image/jpeg" : "" })).join("")));
    const entries = []; let bytes = 0;
    try {
      for (const [name, value] of parts) {
        xml.charge(value.length); bytes += value.length; if (bytes > context.limits.outputBytes) limit("output bytes");
        entries.push(await zip.makeZipEntry(name, value, { modified: new Date("2000-01-01Z"), mode: 0o644,
          directory: false, symlink: false, compression: name === "mimetype" ? "store" : "deflate" }, zipLimits, context.signal));
      }
      return await zip.writeZipArchive({ entries, comment: new Uint8Array() }, zipLimits, context.signal);
    } catch (error) { context.signal.throwIfAborted(); if (error instanceof CodecError && error.code === "resource-limit") limit("output package"); throw error; }
  };
}
