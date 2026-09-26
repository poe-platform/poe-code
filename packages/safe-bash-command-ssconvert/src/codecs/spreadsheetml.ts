import { parseXmlSteps, XmlLimitError, type XmlElement } from "@poe-code/safe-fs/xml";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { AxisMetadata, Cell, CellValue, ImportedValue, NamedExpression, Range, Sheet, Workbook } from "../workbook.js";
import { formatA1 } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { excelGrammar, gnumericGrammar } from "../formulas/conventions.js";
import { quoteNativeSheet, serializeExpression } from "../formulas/serialization.js";
import type { FormulaDocument, FormulaNode } from "../formulas/ast.js";
import { encodingName } from "../encoding/names.js";
import { singleByteTables } from "../encoding/tables.js";
import { readSpreadsheetMLMetadata } from "./spreadsheetml-metadata.js";
import { spreadsheetmlSchema } from "./spreadsheetml-schema.js";

const namespaces: Readonly<Record<string, readonly string[]>> = {
  SS: ["urn:schemas-microsoft-com:office:spreadsheet", "http://schemas.microsoft.com/office/excel/2003/xml"],
  O: ["urn:schemas-microsoft-com:office:office"], XL: ["urn:schemas-microsoft-com:office:excel"],
  C: ["urn:schemas-microsoft-com:office:component:spreadsheet"], HTML: ["http://www.w3.org/TR/REC-html40"],
  XSI: ["http://www.w3.org/2001/XMLSchema-instance"]
};
const grammar = { ...excelGrammar, id: "excel-xml", address: "r1c1" as const };
type Style = Record<string, ImportedValue>;
function limit(name: string): never { throw new SsconvertError("resource-limit", `ssconvert SpreadsheetML ${name} limit exceeded`); }
async function document(bytes: Uint8Array, context: CapabilityContext, probe = false): Promise<XmlElement | boolean> {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) limit("input bytes");
  const rootFound = {};
  let matched = false;
  try {
    let encoding: "UTF-8" | "UTF-16LE" | "UTF-16BE" = "UTF-8";
    if (bytes[0] === 255 && bytes[1] === 254 || bytes[0] === 60 && bytes[1] === 0) encoding = "UTF-16LE";
    if (bytes[0] === 254 && bytes[1] === 255 || bytes[0] === 0 && bytes[1] === 60) encoding = "UTF-16BE";
    function malformed(message: string): never { throw new Error(message); }
    let text: string;
    const header = new TextDecoder("ascii").decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
    const encodingAt = header.startsWith("<?xml") && " \t\r\n".includes(header[5] ?? "\0") ? header.indexOf("encoding") : -1;
    let declared: string | undefined;
    if (encodingAt >= 0) {
      let at = encodingAt + 8; while (" \t\r\n".includes(header[at] ?? "\0")) at++;
      if (header[at++] !== "=") malformed("malformed encoding declaration");
      while (" \t\r\n".includes(header[at] ?? "\0")) at++;
      const quote = header[at++]; if (quote !== "'" && quote !== '"') malformed("malformed encoding declaration");
      const end = header.indexOf(quote, at); if (end < 0) malformed("malformed encoding declaration"); declared = header.slice(at, end);
    }
    if (encoding === "UTF-8" && declared && !["utf-8", "utf8"].includes(declared.toLowerCase())) {
      const table = singleByteTables[encodingName(declared)];
      if (!table) throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: XML encoding ${declared}`);
      const characters: string[] = [];
      for (const byte of bytes) { const character = table[byte]!; if (character === "\uffff") malformed("invalid encoded XML byte"); characters.push(character); }
      text = characters.join("");
      // The declaration is validated by the XML parser after decoding its bytes.
      const at = text.indexOf(declared, encodingAt + 8); text = text.slice(0, at) + "UTF-8" + text.slice(at + declared.length);
    } else text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    const parser = parseXmlSteps(text, { expectedEncoding: encoding, maxDepth: context.limits.xmlDepth ?? Infinity,
      maxNodes: context.limits.workbookNodes ?? Infinity, maxAttributes: context.limits.workbookNodes ?? Infinity,
      maxTextLength: context.limits.workbookTextBytes ?? context.limits.inputBytes,
      ...(probe ? { onElement(node) { matched = node.localName === "Workbook" && node.namespace.includes("schemas-microsoft-com:office:spreadsheet"); throw rootFound; } } : {}) });
    let step = parser.next(), work = 0;
    while (!step.done) {
      context.signal.throwIfAborted();
      if ((work += step.value) >= 16384) { work = 0; await new Promise<void>(resolve => setTimeout(resolve, 0)); }
      step = parser.next();
    }
    return probe ? false : step.value;
  } catch (error) {
    context.signal.throwIfAborted();
    if (error === rootFound) return matched;
    if (error instanceof SyntaxError && error.message === "Invalid XML: DTD and entity declarations are forbidden")
      throw new SsconvertError("capability-denied", "ssconvert host denies XML DTD and entity declarations");
    if (error instanceof XmlLimitError) limit("XML nodes/text");
    if (error instanceof SsconvertError) throw error;
    if (probe) return false;
    await context.diagnostic?.({ code: "spreadsheetml-content", severity: "warning", message: "Document likely damaged.\n" });
    context.signal.throwIfAborted();
    throw new SsconvertError("io", "E XML document not well formed!");
  }
}
export async function probeSpreadsheetML(bytes: Uint8Array, context: CapabilityContext): Promise<boolean> {
  return await document(bytes, context, true) === true;
}

/** libgsf binds the first known prefix per namespace at the scanning states. */
async function recognize(root: XmlElement, context: CapabilityContext,
  positions: WeakMap<XmlElement, { start: number; end: number }>, warnings: { position: number; message: string }[]): Promise<XmlElement | undefined> {
  const prefixes = new Map<string, string>(), primary = new Map<string, string>(), unknown = new Set<string>();
  let position = 0;
  async function visit(node: XmlElement, parent: string, ancestors: readonly string[], inherited: string): Promise<XmlElement | undefined> {
    context.signal.throwIfAborted();
    const start = position++;
    let namespace = inherited;
    const defaultNamespace = node.attributes.find(a => a.name === "xmlns");
    if (defaultNamespace) namespace = Object.keys(namespaces).find(key => namespaces[key]!.includes(defaultNamespace.value)) ?? "";
    if (parent === "START" || parent === "WORKBOOK") for (const a of node.attributes) {
      if (a.namespace !== "http://www.w3.org/2000/xmlns/") continue;
      const key = Object.keys(namespaces).find(key => namespaces[key]!.includes(a.value));
      if (a.name === "xmlns") { if (key) namespace = key; }
      else if (key) { if (!prefixes.has(a.localName)) { prefixes.set(a.localName, key); if (!primary.has(key)) primary.set(key, a.localName); } }
      else unknown.add(a.localName);
    }
    const colon = node.name.indexOf(":"), prefix = colon < 0 ? undefined : node.name.slice(0, colon);
    const match = spreadsheetmlSchema.find(n => n[0] === parent && n[3] === node.localName &&
      (prefix === undefined ? n[2] === namespace : primary.get(n[2]) === prefix));
    if (!match) {
      if (prefix === undefined || !unknown.has(prefix)) {
        const message = `Unexpected element '${node.name}' in state : \n\t${ancestors.join(" -> ")}\n`;
        warnings.push({ position: start, message });
      }
      return undefined;
    }
    const accepted: XmlElement[] = [];
    for (const child of node.children) { const value = await visit(child, match[1], [...ancestors, node.localName], namespace); if (value) accepted.push(value); }
    const result = { ...node, namespace: namespaces[match[2]]![0]!, children: accepted,
      attributes: node.attributes.map(a => {
        const colon = a.name.indexOf(":"), key = colon < 0 ? undefined : prefixes.get(a.name.slice(0, colon));
        return key ? { ...a, namespace: namespaces[key]![0]! } : a;
      }) };
    positions.set(result, { start, end: position++ });
    return result;
  }
  return visit(root, "START", [], "");
}
function children(node: XmlElement | undefined, name: string, namespace = "SS"): XmlElement[] {
  return node?.children.filter(n => n.localName === name && n.namespace === namespaces[namespace]![0]) ?? [];
}
function attr(node: XmlElement | undefined, name: string): string | undefined {
  return node?.attributes.find(a => a.localName === name && a.namespace === namespaces.SS![0])?.value;
}
function bool(value: string | undefined): boolean { return value !== undefined && value !== "0" && value.toLowerCase() !== "false"; }
function content(node: XmlElement): string {
  return node.content.map(c => c.kind === "element" ? content(c) : c.kind === "text" || c.kind === "cdata" ? c.text : "").join("");
}
function styleMetadata(style: Style): ImportedValue {
  const attributes: ImportedValue[] = [], nested: ImportedValue[] = [];
  const color = (value: string) => value.startsWith("#") && value.length === 7
    ? [value.slice(1, 3), value.slice(3, 5), value.slice(5, 7)].map(c => (parseInt(c, 16) * 257).toString(16).toUpperCase()).join(":") : value;
  const node = (name: string, values: Style, children: ImportedValue[] = [], text = ""): ImportedValue => ({ name, namespace: "http://www.gnumeric.org/v10.dtd", text, children,
    attributes: Object.entries(values).map(([name, value]) => ({ name, namespace: "", value: String(name === "Color" ? color(String(value)) : value) })) });
  const fullStyle: Style = { HAlign: 1, VAlign: 2, WrapText: 0, ShrinkToFit: 0, Rotation: 0, Shade: 0, Indent: 0,
    Locked: 1, Hidden: 0, Fore: "#000000", Back: "#FFFFFF", PatternColor: "#000000", Format: "General", ...style,
    Font: { Unit: 10, Bold: 0, Italic: 0, Underline: 0, StrikeThrough: 0, Script: 0, ...(style.Font as Style ?? {}) } };
  for (const [name, value] of Object.entries(fullStyle)) {
    if (name === "gnumeric") continue;
    if (name === "Font") { nested.push(node("Font", value as Style, [], "Sans")); continue; }
    if (name === "StyleBorder") { nested.push(node(name, {}, Object.entries(value as Style).map(([side, edge]) => node(side, edge as Style)))); continue; }
    let source = String(value);
    if (["Fore", "Back", "PatternColor"].includes(name)) source = color(source);
    if (name === "HAlign") source = ({ 1: "GNM_HALIGN_GENERAL", 2: "GNM_HALIGN_LEFT", 4: "GNM_HALIGN_RIGHT", 8: "GNM_HALIGN_CENTER", 16: "GNM_HALIGN_FILL", 32: "GNM_HALIGN_JUSTIFY", 64: "GNM_HALIGN_CENTER_ACROSS_SELECTION", 128: "GNM_HALIGN_DISTRIBUTED" } as Record<string, string>)[source] ?? source;
    if (name === "VAlign") source = ({ 1: "GNM_VALIGN_TOP", 2: "GNM_VALIGN_BOTTOM", 4: "GNM_VALIGN_CENTER", 8: "GNM_VALIGN_JUSTIFY", 16: "GNM_VALIGN_DISTRIBUTED" } as Record<string, string>)[source] ?? source;
    attributes.push({ name, namespace: "", value: source });
  }
  return { name: "Style", namespace: "http://www.gnumeric.org/v10.dtd", attributes, children: nested, text: "" };
}
function styleRegion(range: Range, style: Style): ImportedValue {
  return { name: "StyleRegion", namespace: "http://www.gnumeric.org/v10.dtd", text: "",
    attributes: Object.entries({ startCol: range.startColumn, startRow: range.startRow, endCol: range.endColumn, endRow: range.endRow })
      .map(([name, value]) => ({ name, namespace: "", value: String(value) })), children: [style.gnumeric!] };
}
function spreadsheetNumber(source: string): { value: number; complete: boolean } {
  let i = 0;
  while (source[i] !== undefined && " \t\n\r\v\f".includes(source[i]!)) i++;
  const start = i;
  if (source[i] === "+" || source[i] === "-") i++;
  const lower = source.slice(i).toLowerCase();
  for (const special of ["infinity", "inf", "nan"]) if (lower.startsWith(special)) {
    const value = special === "nan" ? NaN : source[start] === "-" ? -Infinity : Infinity;
    return { value, complete: i + special.length === source.length };
  }
  const digit = () => source[i] !== undefined && source[i]! >= "0" && source[i]! <= "9";
  let digits = 0;
  while (digit()) { digits++; i++; }
  if (source[i] === ".") { i++; while (digit()) { digits++; i++; } }
  if (digits === 0) return { value: 0, complete: source.length === 0 };
  if (source[i] === "e" || source[i] === "E") {
    const exponent = i++;
    if (source[i] === "+" || source[i] === "-") i++;
    const exponentStart = i;
    while (digit()) i++;
    if (i === exponentStart) i = exponent;
  }
  return { value: Number(source.slice(start, i)), complete: i === source.length };
}
const nativeGrammar = { ...gnumericGrammar, quoteSheetName: quoteNativeSheet };
const formats: Readonly<Record<string, string>> = {
  "General Number": "General", Currency: "$#,##0.00_);[Red](#,##0.00)", "Euro Currency": "[$EUR-2]#,##0.00_);[Red](#,##0.00)",
  Fixed: "0.00", Standard: "#,##0.00", Percent: "0.00%", Scientific: "0.00E+00",
  "Yes/No": '"Yes";"Yes";"No"', "True/False": '"True";"True";"False"', "On/Off": '"On";"On";"Off"',
  "General Date": "[$-f8fa]m/d/yy h:mm", "Long Date": "[$-f800]dddd, mmmm dd, yyyy", "Medium Date": "[$-f8f1]d-mmm-yy", "Short Date": "[$-f8f2]m/d/yy",
  "Long Time": "[$-f400]h:mm:ss AM/PM", "Medium Time": "[$-f4f1]h:mm AM/PM", "Short Time": "[$-f4f2]hh:mm"
};

export async function readSpreadsheetML(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  const parsed = await document(bytes, context);
  const positions = new WeakMap<XmlElement, { start: number; end: number }>();
  const elementWarnings: { position: number; message: string }[] = [];
  const root = await recognize(parsed as XmlElement, context, positions, elementWarnings);
  let emitted = 0;
  async function advance(node?: XmlElement, end = false) {
    const position = node ? positions.get(node)?.[end ? "end" : "start"] ?? -1 : Infinity;
    while (elementWarnings[emitted] && elementWarnings[emitted]!.position <= position) {
      context.signal.throwIfAborted();
      const message = elementWarnings[emitted++]!.message;
      await context.diagnostic?.({ code: "spreadsheetml-unknown-element", severity: "warning", message });
      context.signal.throwIfAborted();
    }
  }
  const styles = new Map<string, Style>(); let defaultStyle: Style = {};
  const sheets: Sheet[] = [], names: NamedExpression[] = [], properties: Style = {};
  let totalCells = 0, work = 0;
  function charge() { context.signal.throwIfAborted(); if (++work > (context.limits.workbookWork ?? Infinity)) limit("work"); }
  async function warning(message: string, sheet?: string, row = -1, column = -1) {
    if (sheet !== undefined) message = `${sheet}${row >= 0 && column >= 0 ? "!" + formatA1(row, column) : ""} : ${message}`;
    await context.diagnostic?.({ code: "spreadsheetml-content", severity: "warning", message: message + "\n" });
  }
  async function numeric(node: XmlElement, name: string, fallback: number, integer = false, sheet?: string, row = -1, column = -1): Promise<number> {
    await advance(node);
    const source = attr(node, name); if (source === undefined) return fallback;
    const parsedNumber = integer ? undefined : spreadsheetNumber(source);
    const value = parsedNumber?.value ?? Number(source);
    let validInteger = true;
    if (integer && source !== "") {
      let at = 0;
      while (" \t\r\n\v\f".includes(source[at] ?? "\0")) at++;
      if (source[at] === "+" || source[at] === "-") at++;
      const firstDigit = at;
      while (source[at] !== undefined && source[at]! >= "0" && source[at]! <= "9") at++;
      validInteger = at > firstDigit && at === source.length;
    }
    if (source.trimEnd() !== source || parsedNumber?.complete === false || integer && (!validInteger || !Number.isSafeInteger(value))) {
      await warning(`Invalid attribute '${name}', expected ${integer ? "integer" : "number"}, received '${source}'`, sheet, row, column); return fallback;
    }
    return Number.isFinite(value) ? value : fallback;
  }
  async function formula(source: string, sheet: string, row: number, column: number, warningColumn = column): Promise<FormulaDocument | undefined> {
    if (!source.startsWith("=")) { await warning(`Invalid formula '${source}' does not begin with '='`, sheet || undefined, row, warningColumn); return undefined; }
    const parsed = parseExpression("=" + source.slice(1).trimStart(), { grammar, position: { sheet, row, column }, signal: context.signal,
      maximumLength: context.limits.workbookTextBytes ?? context.limits.inputBytes, maximumNodes: context.limits.workbookNodes ?? Infinity });
    if (!parsed.ok) { await warning(`'${source.slice(1)}' ${parsed.diagnostic.message}`, sheet || undefined, row, warningColumn); return undefined; }
    if (sheet && !await knownReferences(parsed.document.root, source, { sheet, row, column: warningColumn })) return undefined;
    return parsed.document;
  }
  async function knownReferences(node: FormulaNode, source: string, position?: { sheet: string; row: number; column: number }): Promise<boolean> {
    if (node.kind === "reference" || node.kind === "name") {
      const refs = node.kind === "reference" ? [node.first, node.last] : [node];
      for (const ref of refs) if (ref?.sheet && ref.sheet.toLowerCase() !== position?.sheet.toLowerCase() && !ref.workbook && !sheets.some(sheet => sheet.name.toLowerCase() === ref.sheet!.toLowerCase())) {
        await warning(`'${source.slice(1)}' Unknown sheet '${ref.sheet}'`, position?.sheet, position?.row, position?.column); return false;
      }
    }
    const nested = node.kind === "binary" ? [node.left, node.right] : node.kind === "unary" || node.kind === "parentheses" ? [node.child] : node.kind === "call" ? node.args : node.kind === "array" ? node.rows.flat() : [];
    for (const child of nested) if (!await knownReferences(child, source, position)) return false;
    return true;
  }
  async function color(node: XmlElement, name: string): Promise<string | undefined> {
    const source = attr(node, name); if (source === undefined) return undefined;
    let at = 1;
    const channels: string[] = [];
    if (source[0] === "#") for (let channel = 0; channel < 3; channel++) {
      while (" \t\r\n\v\f".includes(source[at] ?? "\0")) at++;
      let value = 0, digits = 0;
      while (digits < 2 && source[at] !== undefined) {
        const digit = "0123456789abcdef".indexOf(source[at]!.toLowerCase()); if (digit < 0) break;
        value = value * 16 + digit; digits++; at++;
      }
      if (digits === 0) break;
      channels.push(value.toString(16).toUpperCase().padStart(2, "0"));
    }
    if (channels.length === 3) return "#" + channels.join("");
    await warning(`Invalid attribute '${name}', expected color, received '${source}'`);
    return undefined;
  }
  async function enumeration(node: XmlElement, name: string, values: Readonly<Record<string, number>>): Promise<number | undefined> {
    const source = attr(node, name);
    if (source === undefined) return undefined;
    if (values[source] !== undefined) return values[source];
    await warning(`Invalid attribute '${name}', unknown enum value '${source}'`);
    return undefined;
  }
  async function readStyles(styleNodes: XmlElement) {
  for (const node of children(styleNodes, "Style")) {
    await advance(node);
    charge(); const id = attr(node, "ID"); if (id === undefined) continue;
    const style: Style = { ...defaultStyle };
    for (const part of node.children) {
      await advance(part);
      if (part.localName === "NumberFormat") { const source = attr(part, "Format"); if (source !== undefined) style.Format = formats[source] ?? source; }
      if (part.localName === "Font") {
        const font: Style = { ...(style.Font as Style ?? {}) };
        for (const [source, target] of [["Bold", "Bold"], ["Italic", "Italic"], ["StrikeThrough", "StrikeThrough"]]) if (attr(part, source!) !== undefined) font[target!] = bool(attr(part, source!)) ? 1 : 0;
        if (attr(part, "Size") !== undefined) font.Unit = await numeric(part, "Size", 10);
        const fore = await color(part, "Color"); if (fore !== undefined) style.Fore = fore;
        const underline = await enumeration(part, "Underline", { None: 0, Single: 1, Double: 2, SingleAccounting: 3, DoubleAccounting: 4 }); if (underline !== undefined) font.Underline = underline;
        const script = await enumeration(part, "VerticalAlign", { Superscript: 1, Subscript: -1, None: 0 }); if (script !== undefined) font.Script = script;
        style.Font = font;
      }
      if (part.localName === "Alignment") {
        for (const [source, target] of [["Rotate", "Rotation"], ["Indent", "Indent"]]) if (attr(part, source!) !== undefined) style[target!] = await numeric(part, source!, 0, true);
        if (attr(part, "WrapText") !== undefined) style.WrapText = bool(attr(part, "WrapText")) ? 1 : 0;
        const horizontal = await enumeration(part, "Horizontal", { Left: 2, Right: 4, Center: 8, Fill: 16, Justify: 32, CenterAcrossSelection: 64, Distributed: 128 });
        const vertical = await enumeration(part, "Vertical", { Top: 1, Bottom: 2, Center: 4, Justify: 8, Distributed: 16 });
        if (horizontal !== undefined) style.HAlign = horizontal;
        if (vertical !== undefined) style.VAlign = vertical;
      }
      if (part.localName === "Interior") {
        const back = await color(part, "Color"); if (back !== undefined) style.Back = back;
        const patternColor = await color(part, "PatternColor"); if (patternColor !== undefined) style.PatternColor = patternColor;
        const pattern = await enumeration(part, "Pattern", Object.fromEntries(["Solid", "Gray75", "Gray50", "Gray25", "Gray125", "Gray0625", "HorzStripe", "VertStripe", "ReverseDiagStripe", "DiagStripe", "DiagCross", "ThickDiagCross", "ThinHorzStripe", "ThinVertStripe", "ThinReverseDiagStripe", "ThinDiagStripe", "ThinHorzCross", "ThinDiagCross"].map((name, index) => [name, index + 1]))); if (pattern !== undefined) style.Shade = pattern;
      }
      if (part.localName === "Borders") {
        const borders: Style = { ...(style.StyleBorder as Style ?? {}) };
        for (const border of children(part, "Border")) {
          await advance(border);
          const position = attr(border, "Position"), borderColor = await color(border, "Color"), line = attr(border, "LineStyle"), weight = await numeric(border, "Weight", 1, true);
          if (!position || !borderColor || !line) continue;
          const types: Record<string, number> = { Continuous: weight >= 3 ? 5 : weight === 2 ? 1 : 7, Dash: weight >= 2 ? 8 : 3, DashDot: weight >= 2 ? 10 : 9, DashDotDot: weight >= 2 ? 12 : 11, Dot: 4, Double: 6, SlantDashDot: 13 };
          const side = position === "DiagonalLeft" ? "Rev-Diagonal" : position === "DiagonalRight" ? "Diagonal" : position;
          if (types[line] !== undefined) borders[side] = { Style: types[line]!, Color: borderColor };
        }
        style.StyleBorder = borders;
      }
    }
    style.gnumeric = styleMetadata(style);
    styles.set(id, style); if (id === "Default") defaultStyle = style;
  }
  }
  async function readNames(nameNodes: XmlElement) {
  for (const node of children(nameNodes, "NamedRange")) {
    await advance(node);
    const name = attr(node, "Name"), source = attr(node, "RefersTo");
    if (name !== undefined && source !== undefined) {
      const expression = await formula(source, "", 0, 0);
      const accepted = expression !== undefined && await knownReferences(expression.root, source);
      await warning(`${name} = ${source}`);
      if (accepted && expression !== undefined) names.push({ name, expression: serializeExpression(expression, nativeGrammar, false, true) });
    }
  }
  }
  const propertyKeys: Record<string, string> = { Author: "meta:initial-creator", Category: "gsf:category", Company: "dc:publisher", Description: "dc:description", HyperlinkBase: "xlsx:HyperlinkBase", LastAuthor: "dc:creator", Manager: "gsf:manager", Subject: "dc:subject", Title: "dc:title", Created: "meta:creation-date", LastSaved: "dc:date", LastPrinted: "meta:print-date" };
  for (const node of children(root, "DocumentProperties", "O")[0]?.children ?? []) {
    if (propertyKeys[node.localName] && (!["Created", "LastSaved", "LastPrinted"].includes(node.localName) || Number.isFinite(Date.parse(content(node))))) properties[propertyKeys[node.localName]!] = content(node);
    if (node.localName === "Keywords") { const words = content(node).split(" "); const empty = words.indexOf(""); const selected = empty < 0 ? words : words.slice(0, empty); if (selected.length) properties["dc:keywords"] = selected; }
  }
  // The native importer carries an expression until a Data end event consumes it,
  // including across empty cells and worksheet boundaries.
  let pending: FormulaDocument | undefined;
  for (const worksheet of root?.children ?? []) {
    await advance(worksheet);
    if (worksheet.namespace !== namespaces.SS![0]) continue;
    if (worksheet.localName === "Styles") { await readStyles(worksheet); continue; }
    if (worksheet.localName === "Names") { await readNames(worksheet); continue; }
    if (worksheet.localName !== "Worksheet") continue;
    charge(); const name = attr(worksheet, "Name"); if (name === undefined) continue;
    const existing = sheets.find(s => s.name === name), cells = new Map<string, Cell>(existing?.cells.map(c => [`${c.row}:${c.column}`, c]));
    const savedStyles = existing?.unsupportedRecords?.find(record => record.source === "Gnumeric_XmlIO:sax" && record.kind === "Styles")?.data;
    const savedStyleData = savedStyles && typeof savedStyles === "object" && !Array.isArray(savedStyles) ? savedStyles as Readonly<Record<string, ImportedValue>> : undefined;
    const styleRegions: ImportedValue[] = Array.isArray(savedStyleData?.children) ? [...savedStyleData.children] : [];
    const rows = new Map<number, AxisMetadata>(existing?.rows?.map(axis => [axis.index, axis])), columns = new Map<number, AxisMetadata>(existing?.columns?.map(axis => [axis.index, axis])), merges: Range[] = [...existing?.merges ?? []];
    if (!existing && sheets.length >= context.limits.sheets) limit("sheets");
    let rowIndex = 0;
    for (const table of children(worksheet, "Table")) {
      let colIndex = 0;
      for (const axis of table.children) {
        await advance(axis);
        if (axis.localName === "Column") {
        const col = axis;
        const index = await numeric(col, "Index", colIndex + 1, true, name); if (index > 0) colIndex = index - 1;
        const span = Math.max(1, await numeric(col, "Span", 0, true, name) + 1), width = await numeric(col, "Width", -1, false, name), style = styles.get(attr(col, "StyleID") ?? "");
        if (span > (context.limits.workbookNodes ?? Infinity) - columns.size) limit("axis nodes");
        for (let i = 0; i < span; i++) { charge(); if (colIndex + i >= 16384) limit("column coordinates"); columns.set(colIndex + i, { ...columns.get(colIndex + i), index: colIndex + i, ...(width > 0 ? { sizePoints: width } : {}), ...(bool(attr(col, "Hidden")) ? { hidden: true } : {}), ...(style ? { style } : {}) }); }
        if (style) styleRegions.push(styleRegion({ startRow: 0, startColumn: colIndex, endRow: 1048575, endColumn: colIndex + span - 1 }, style));
        colIndex += span;
        continue;
        }
        if (axis.localName !== "Row") continue;
        const row = axis;
        charge(); colIndex = 0; const index = await numeric(row, "Index", rowIndex + 1, true, name); if (index > 0) rowIndex = index - 1;
        const span = Math.max(1, await numeric(row, "Span", 1, true, name)), height = await numeric(row, "Height", -1, false, name), declaredRowStyle = styles.get(attr(row, "StyleID") ?? "");
        const rowStyle = declaredRowStyle ?? rows.get(rowIndex)?.style as Style | undefined;
        if (rowIndex + span > 1048576) limit("row coordinates");
        if (span > (context.limits.workbookNodes ?? Infinity) - rows.size) limit("axis nodes");
        if (height >= 0 || bool(attr(row, "Hidden")) || declaredRowStyle) for (let i = 0; i < span; i++) { charge(); rows.set(rowIndex + i, { ...rows.get(rowIndex + i), index: rowIndex + i, ...(height >= 0 ? { sizePoints: height } : {}), ...(bool(attr(row, "Hidden")) ? { hidden: true } : {}), ...(declaredRowStyle ? { style: declaredRowStyle } : {}) }); }
        if (declaredRowStyle) styleRegions.push(styleRegion({ startRow: rowIndex, startColumn: 0, endRow: rowIndex + span - 1, endColumn: 16383 }, declaredRowStyle));
        for (const node of children(row, "Cell")) {
          await advance(node);
          charge(); const origin = colIndex;
          let across = 0, down = 0, explicit: Style | undefined;
          for (const attribute of node.attributes) {
            if (attribute.namespace !== namespaces.SS![0]) continue;
            if (attribute.localName === "Index") {
              const index = await numeric(node, "Index", colIndex + 1, true, name, rowIndex, colIndex); if (index > 0) colIndex = index - 1;
            } else if (attribute.localName === "Formula") {
              const result = await formula(attribute.value, name, rowIndex, origin, colIndex); if (result !== undefined) pending = result;
            } else if (attribute.localName === "MergeAcross") across = await numeric(node, "MergeAcross", 0, true, name, rowIndex, colIndex);
            else if (attribute.localName === "MergeDown") down = await numeric(node, "MergeDown", 0, true, name, rowIndex, colIndex);
            else if (attribute.localName === "StyleID") explicit = styles.get(attribute.value);
          }
          if (rowIndex >= 1048576 || colIndex >= 16384) limit("cell coordinates");
          const columnStyle = columns.get(colIndex)?.style;
          // Row styles overwrite column styles; a cell style replaces the region.
          const style: Style | undefined = explicit ?? rowStyle ?? columnStyle as Style | undefined;
          if (colIndex + across >= 16384 || rowIndex + down >= 1048576) limit("merge coordinates");
          if (explicit && (across > 0 || down > 0)) {
            const merge = { startRow: rowIndex, startColumn: colIndex, endRow: rowIndex + down, endColumn: colIndex + across };
            for (const existingMerge of merges) {
              charge();
              if (merge.startRow <= existingMerge.endRow && merge.endRow >= existingMerge.startRow && merge.startColumn <= existingMerge.endColumn && merge.endColumn >= existingMerge.startColumn) {
                throw new SsconvertError("io", `E There is already a merged region that intersects\n${name}!${formatA1(merge.startRow, merge.startColumn)}:${formatA1(merge.endRow, merge.endColumn)}`);
              }
            }
            merges.push(merge);
          }
          if (explicit) styleRegions.push(styleRegion({ startRow: rowIndex, startColumn: colIndex, endRow: rowIndex + Math.max(0, down), endColumn: colIndex + Math.max(0, across) }, explicit));
          const dataNodes = children(node, "Data");
          let dataType = "String";
          for (const data of dataNodes) {
            charge();
            await advance(data);
            const text = content(data), declaredType = attr(data, "Type");
            if (declaredType !== undefined) {
              if (["String", "Number", "Boolean", "Error", "DateTime"].includes(declaredType)) dataType = declaredType;
              else await warning(`Invalid attribute 'Type', unknown enum value '${declaredType}'`, name, rowIndex, colIndex);
            }
            const type = dataType; let value: CellValue = { kind: "string", value: text };
            await advance(data, true);
            if (type === "Number") {
              const parsed = spreadsheetNumber(text);
              value = Number.isFinite(parsed.value) ? { kind: "number", value: parsed.value } : { kind: "error", value: "#NUM!" };
              if (!parsed.complete) await warning(`Invalid content of ss:data element, expected number, received '${text}'`, name, rowIndex, colIndex);
            } else if (type === "Boolean") {
              if (["TRUE", "FALSE"].includes(text.toUpperCase())) value = { kind: "boolean", value: text.toUpperCase() === "TRUE" };
              else {
                if (text === "") value = { kind: "blank" };
                else if (Number.isFinite(Number(text))) value = { kind: "number", value: Number(text) };
                await warning(`Invalid content of ss:data element, received '${text}'`, name, rowIndex, colIndex);
              }
            }
            else if (type === "Error") value = { kind: "error", value: text };
            else if (type === "DateTime") {
              const t = text.indexOf("T"), date = text.slice(0, t).split("-").map(Number), time = text.slice(t + 1).split(":").map(parseFloat);
              const stamp = new Date(0); stamp.setUTCFullYear(date[0]!, date[1]! - 1, date[2]!); stamp.setUTCHours(0, 0, 0, 0);
              if (t > 0 && date.length === 3 && time.length === 3 && date.every(Number.isFinite) && time.every(Number.isFinite) && stamp.getUTCMonth() === date[1]! - 1 && stamp.getUTCDate() === date[2]) {
                let serial = (stamp.getTime() - Date.UTC(1899, 11, 31)) / 86400000; if (serial >= 60) serial++;
                value = { kind: "number", value: serial + time[0]! / 24 + time[1]! / 1440 + time[2]! / 86400 };
              }
            }
            const key = `${rowIndex}:${colIndex}`; if (!cells.has(key) && ++totalCells > context.limits.cells) limit("cells");
            cells.set(key, { row: rowIndex, column: colIndex, value, ...(pending === undefined ? {} : { formula: serializeExpression({ ...pending, position: { sheet: name, row: rowIndex, column: colIndex } }, nativeGrammar, false, true), cachedResult: value, formulaDirty: true }),
              ...(style ? { style, ...(typeof style.Format === "string" ? { format: style.Format } : {}) } : {}) });
            pending = undefined;
          }
          if (dataNodes.length === 0 && explicit) {
            const key = `${rowIndex}:${colIndex}`;
            if (!cells.has(key) && ++totalCells > context.limits.cells) limit("cells");
            const prior = cells.get(key);
            cells.set(key, { ...(prior ?? { row: rowIndex, column: colIndex, value: { kind: "blank" as const } }), style: explicit,
              ...(typeof explicit.Format === "string" ? { format: explicit.Format } : {}) });
          }
          colIndex += 1 + across;
        }
        rowIndex++;
      }
    }
    const unsupportedRecords = [...existing?.unsupportedRecords?.filter(record => !(record.source === "Gnumeric_XmlIO:sax" && record.kind === "Styles")) ?? [], ...readSpreadsheetMLMetadata(worksheet, name, context, charge)];
    if (styleRegions.length) unsupportedRecords.push({ source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained", data: {
      name: "Styles", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [], children: styleRegions } });
    const sheet: Sheet = { id: existing?.id ?? name, name, size: { rows: 1048576, columns: 16384 }, cells: [...cells.values()].sort((a, b) => a.row - b.row || a.column - b.column),
      ...(unsupportedRecords.length ? { unsupportedRecords } : {}), ...(rows.size ? { rows: [...rows.values()].sort((a, b) => a.index - b.index) } : {}), ...(columns.size ? { columns: [...columns.values()].sort((a, b) => a.index - b.index) } : {}), ...(merges.length ? { merges } : {}) };
    if (existing) sheets[sheets.indexOf(existing)] = sheet; else sheets.push(sheet);
  }
  await advance();
  context.signal.throwIfAborted();
  return { sheets, dateSystem: "1900", ...(names.length ? { names } : {}), ...(Object.keys(properties).length ? { properties } : {}) };
}
