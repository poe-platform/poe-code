import { parseXmlStream, type XmlElement } from "@poe-code/safe-fs/xml";
import { parseA1 } from "@poe-code/spreadsheet-ast";
import type { ZipArchive, ZipLimits, createZipCodec } from "@poe-code/office-package";

export interface CachedXlsxCell {
  readonly row: number;
  readonly column: number;
  readonly type: string;
  readonly value?: string | number | boolean;
  readonly format?: string | number;
}
export interface CachedXlsxSheet {
  readonly name: string;
  readonly dimension?: string;
  readonly cells: readonly CachedXlsxCell[];
}
export interface CachedXlsxWorkbook {
  readonly sheets: readonly CachedXlsxSheet[];
  readonly date1904: boolean;
  readonly activeTab: number;
}
export interface CachedXlsxOptions {
  readonly archive: ZipArchive;
  readonly codec: ReturnType<typeof createZipCodec>;
  readonly limits: ZipLimits;
  readonly signal: AbortSignal;
  readonly maxXmlNodes: number;
  /** Admit work/storage against the caller's aggregate invocation counters. */
  readonly work: () => void;
  readonly retain: (bytes: number) => void;
  readonly namesOnly?: boolean;
}
export class CachedXlsxError extends Error {
  constructor(readonly code: "missing-content-types" | "missing-workbook" | "invalid", message: string) { super(message); }
}
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const contentNs = "http://schemas.openxmlformats.org/package/2006/content-types";
function attr(node: XmlElement, name: string, namespace = ""): string | undefined {
  return node.attributes.find(item => item.localName === name && item.namespace === namespace)?.value;
}
function children(node: XmlElement | undefined, name: string): readonly XmlElement[] {
  return node?.children.filter(item => item.namespace === ns && item.localName === name) ?? [];
}
function child(node: XmlElement | undefined, name: string): XmlElement | undefined { return children(node, name)[0]; }
function invalid(message: string): never { throw new CachedXlsxError("invalid", message); }
function integer(value: string, minimum = 0): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) invalid("invalid workbook integer");
  return result;
}
function targetPath(base: string, target: string): string {
  if (target.includes("\\") || target.includes(":")) invalid("invalid package target");
  const parts: string[] = [];
  for (const part of (target.startsWith("/") ? target : base.slice(0, base.lastIndexOf("/") + 1) + target).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) invalid("package target escapes archive"); parts.pop(); }
    else parts.push(part);
  }
  return parts.join("/");
}

/** Read stored cell values without evaluating or translating formula text.
 * ISO dates stay strings and built-in number formats stay IDs for the consumer.
 * Declared dimensions are retained independently of the actual stored cells.
 */
export async function readCachedXlsx(options: CachedXlsxOptions): Promise<CachedXlsxWorkbook> {
  const { archive, codec, limits, signal } = options;
  const step = () => { signal.throwIfAborted(); options.work(); };
  step();
  options.retain(archive.entries.length * 64);
  const entries = new Map(archive.entries.map(entry => [entry.name, entry]));
  if (!entries.has("[Content_Types].xml")) throw new CachedXlsxError("missing-content-types", "missing [Content_Types].xml");
  let nodes = 0;
  const parse = async (name: string): Promise<XmlElement | undefined> => {
    step();
    const entry = entries.get(name); if (!entry) return undefined;
    async function* text() {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      for await (const bytes of codec.decodeZipEntry(entry!, limits, signal)) {
        step(); options.retain(bytes.byteLength * 32);
        yield decoder.decode(bytes, { stream: true });
      }
      yield decoder.decode();
    }
    let checkpoints = 0;
    return parseXmlStream(text(), { expectedEncoding: "UTF-8", maxDepth: limits.maxDepth,
      maxNodes: options.maxXmlNodes - nodes, maxTextLength: limits.maxTextBytes,
      onElement() { step(); options.retain(256); nodes++; } }, async units => {
      signal.throwIfAborted();
      if (units) {
        step();
        if (++checkpoints % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    });
  };
  const contentTypes = await parse("[Content_Types].xml");
  const workbookTypes = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    "application/vnd.ms-excel.sheet.macroEnabled.main+xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
    "application/vnd.ms-excel.template.macroEnabled.main+xml"];
  let workbookPath: string | undefined;
  for (const node of contentTypes?.children ?? []) {
    step();
    if (node.namespace === contentNs && node.localName === "Override" && workbookTypes.includes(attr(node, "ContentType") ?? "")) {
      const part = attr(node, "PartName"); if (part) workbookPath = targetPath("", part);
    }
  }
  if (!workbookPath) throw new CachedXlsxError("missing-workbook", "File contains no valid workbook part");
  const workbook = await parse(workbookPath);
  if (!workbook) invalid("missing workbook part");
  const properties = child(workbook, "workbookPr"), view = child(child(workbook, "bookViews"), "workbookView");
  const date1904 = properties !== undefined && ["1", "true", "on"].includes(attr(properties, "date1904") ?? "");
  const activeTab = view ? integer(attr(view, "activeTab") ?? "0") : 0;
  const sheetNodes = children(child(workbook, "sheets"), "sheet");
  if (options.namesOnly) return { date1904, activeTab, sheets: sheetNodes.map(node => {
    step(); const name = attr(node, "name") ?? ""; options.retain(64 + name.length * 2); return { name, cells: [] };
  }) };
  const slash = workbookPath.lastIndexOf("/");
  const relations = await parse(workbookPath.slice(0, slash + 1) + "_rels/" + workbookPath.slice(slash + 1) + ".rels");
  const targets = new Map<string, string>(), types = new Map<string, string>();
  for (const node of relations?.children ?? []) {
    step();
    if (node.namespace !== packageNs || node.localName !== "Relationship" || attr(node, "TargetMode") === "External") continue;
    const id = attr(node, "Id"), target = attr(node, "Target");
    if (id === undefined || target === undefined) continue;
    options.retain(128 + (id.length + target.length) * 2);
    const path = targetPath(workbookPath, target); targets.set(id, path);
    types.set(attr(node, "Type") ?? "", path);
  }
  const related = async (type: string) => { const path = types.get(relNs + "/" + type); return path ? parse(path) : undefined; };
  const textValue = (node: XmlElement | undefined): string => {
    let value = "";
    for (const item of node?.children ?? []) {
      step(); if (item.namespace !== ns) continue;
      const part = item.localName === "t" ? item.text : item.localName === "r" ? child(item, "t")?.text ?? "" : "";
      options.retain(part.length * 2); value += part;
    }
    return value;
  };
  const strings = children(await related("sharedStrings"), "si").map(node => textValue(node).replaceAll("x005F_", ""));
  const styles = await related("styles"), formats = new Map<number, string>();
  for (const node of children(child(styles, "numFmts"), "numFmt")) {
    step(); const format = attr(node, "formatCode"); if (format !== undefined) formats.set(integer(attr(node, "numFmtId") ?? "0"), format);
  }
  const cellFormats = children(child(styles, "cellXfs"), "xf").map(node => {
    step(); const id = integer(attr(node, "numFmtId") ?? "0"); return formats.get(id) ?? id;
  });
  const sheets: CachedXlsxSheet[] = [];
  for (const sheetNode of sheetNodes) {
    step(); const name = attr(sheetNode, "name") ?? "", path = targets.get(attr(sheetNode, "id", relNs) ?? "");
    if (!path) invalid("missing worksheet relationship");
    const sheet = await parse(path); if (!sheet) invalid("missing worksheet part");
    const dim = child(sheet, "dimension"), dimension = dim ? attr(dim, "ref") : undefined;
    const cells: CachedXlsxCell[] = [];
    let row = 0;
    for (const rowNode of children(child(sheet, "sheetData"), "row")) {
      step(); row = integer(attr(rowNode, "r") ?? String(row + 1), 1); let column = 0;
      for (const node of children(rowNode, "c")) {
        step(); options.retain(128);
        const address = attr(node, "r"), position = address ? parseA1(address) : { row: row - 1, column };
        column = position.column + 1;
        const type = attr(node, "t") ?? "n", raw = child(node, "v")?.text;
        let value: string | number | boolean | undefined;
        if (type === "inlineStr") { const inline = child(node, "is"); if (inline) value = textValue(inline); }
        else if (raw !== undefined && raw !== "") {
          if (type === "s") { value = strings[integer(raw)]; if (value === undefined) invalid("invalid shared string index"); }
          else if (type === "b") value = integer(raw) !== 0;
          else if (type === "n") { value = Number(raw); if (!Number.isFinite(value)) invalid("invalid numeric cell"); }
          else value = raw;
        }
        const style = integer(attr(node, "s") ?? "0"), format = cellFormats[style] ?? 0;
        cells.push({ ...position, type: type === "inlineStr" || type === "str" ? "s" : type,
          ...(value === undefined ? {} : { value }), format });
      }
    }
    options.retain(128 + name.length * 2);
    sheets.push({ name, ...(dimension === undefined ? {} : { dimension }), cells });
  }
  return { sheets, date1904, activeTab };
}
