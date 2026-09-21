import { metadataNode, type MetadataNode } from "./xlsx-write-support.js";
import { renderCellText } from "../formatting.js";
import { parseFormatSections, selectFormatSection } from "../formatting/sections.js";
import { formattingLocale } from "../formatting/locale.js";
import type { FormatHost } from "../formatting/number-format.js";
import { Tokenizer } from "htmlparser2";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { DEFAULT_SHEET_SIZE, formatA1, parseA1, type Cell, type ImportedValue, type Range, type Workbook } from "../workbook.js";
import { inferText } from "../workbook/updates/inference.js";
import { parseExpression } from "../formulas/parser.js";
import { htmlAutoClose, htmlElements, htmlEntities } from "./html-schema.js";

interface Node { name: string; text: string; attributes: Record<string, string>; children: Node[]; offset?: number }
const voidTags = new Set(["area", "base", "basefont", "br", "col", "frame", "hr", "img", "input", "isindex", "link", "meta", "param"]);
const priorities: Readonly<Record<string, number>> = { div: 150, td: 160, th: 160, tr: 170, thead: 180, tbody: 180, tfoot: 180, table: 190, head: 200, body: 200, html: 220 };
const tableStarts = new Set(["caption", "col", "colgroup", "tbody", "tfoot", "thead", "tr"]);
const rowStarts = new Set(["td", "th"]);
function limit(name: string): never { throw new SsconvertError("resource-limit", `ssconvert HTML ${name} limit exceeded`); }
function space(c: string): boolean { return "\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000".includes(c); }
function entities(text: string, warning?: (position: number, message: string) => void): string {
  let result = "";
  for (let at = 0; at < text.length;) {
    if (text[at] !== "&") { result += text[at++]!; continue; }
    if (text[at + 1] === "#") {
      const hex = text[at + 2] === "x" || text[at + 2] === "X";
      const start = at + (hex ? 3 : 2);
      let end = start;
      while (text[end] && (hex ? "0123456789abcdefABCDEF" : "0123456789").includes(text[end]!)) end++;
      if (end > start || text[end] === ";") {
        const code = end === start ? 0 : parseInt(text.slice(start, end), hex ? 16 : 10);
        if (text[end] !== ";") warning?.(end, "htmlParseCharRef: missing semicolon");
        // libxml consumes invalid numeric references, rather than substituting U+FFFD.
        if (code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff) result += String.fromCodePoint(code);
        else warning?.(end + Number(text[end] === ";"), `htmlParseCharRef: invalid xmlChar value ${code}`);
        at = end + Number(text[end] === ";");
        continue;
      }
    }
    let end = at + 1;
    while (end < text.length && end - at <= 32 && text[end] !== ";" && !"<& \t\r\n".includes(text[end]!)) end++;
    if (text[end] !== ";") { warning?.(end, "htmlParseEntityRef: expecting ';'"); result += text[at++]!; continue; }
    const name = text.slice(at + 1, end);
    const code = htmlEntities[name];
    if (code !== undefined && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) { result += String.fromCodePoint(code); at = end + 1; }
    else result += text[at++]!;
  }
  return result;
}
function dumpText(text: string): string {
  return [...text].map(c => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c).join("");
}
function dump(node: Node): string {
  if (node.name === "#text") return dumpText(node.text);
  if (node.name === "#comment") return `<!--${node.text}-->`;
  if (node.name === "#cdata") return node.text;
  const attrs = Object.entries(node.attributes).map(([k, v]) => ` ${k}="${dumpText(v).split('"').join("&quot;")}"`).join("");
  return `<${node.name}${attrs}>` + (voidTags.has(node.name) ? "" : node.children.map(dump).join("") + `</${node.name}>`);
}

/** HTML tokenization, not XML parsing; tree recovery follows the reference HTML4 rules. */
async function document(bytes: Uint8Array, context: CapabilityContext): Promise<Node> {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) limit("input bytes");
  if (bytes.length < 4) throw new SsconvertError("io", "Unable to parse the html.");
  let encoding = "iso-8859-1";
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = "utf-8";
  else if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[1] === 0 && bytes[3] === 0) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[2] === 0) encoding = "utf-16be";
  // libxml detects a charset declaration while parsing, without consulting host resources.
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4096))).toLowerCase();
  if (encoding === "iso-8859-1") {
    let meta = false, name = "", value = "", declared = false;
    const scan = new Tokenizer({ xmlMode: false, decodeEntities: false }, {
      onopentagname(start, end) { meta = header.slice(start, end) === "meta"; },
      onattribname(start, end) { name = header.slice(start, end); value = ""; },
      onattribdata(start, end) { value += header.slice(start, end); },
      onattribend() {
        if (!meta || declared) return;
        const charset = name === "charset" ? 0 : name === "content" ? value.indexOf("charset=") + 8 : -1;
        if (charset < 0 || name === "content" && charset === 7) return;
        let end = charset; while (value[end] && !" \t\r\n\"'>/;".includes(value[end]!)) end++;
        if (end > charset) { encoding = value.slice(charset, end); declared = true; }
      },
      onopentagend() {}, onselfclosingtag() {}, onclosetag() {}, ontext() {}, ontextentity() {},
      onattribentity() {}, oncomment() {}, oncdata() {}, ondeclaration() {}, onprocessinginstruction() {}, onend() {}
    });
    scan.write(header); scan.end();
  }
  let text: string;
  try { text = encoding === "iso-8859-1" ? Array.from(bytes, b => String.fromCharCode(b)).join("") : new TextDecoder(encoding, { ignoreBOM: encoding.startsWith("utf-16") }).decode(bytes); }
  catch { throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: HTML encoding ${encoding}`); }
  const root: Node = { name: "#document", text: "", attributes: {}, children: [] }, stack = [root];
  const warnings: { position: number; message: string }[] = [];
  let nodes = 0, textSize = 0, work = 0;
  function admit(size = 0) {
    context.signal.throwIfAborted();
    if (++nodes > (context.limits.workbookNodes ?? 100000)) limit("nodes");
    if ((textSize += size) > (context.limits.workbookTextBytes ?? context.limits.inputBytes)) limit("text bytes");
  }
  function open(name: string, attributes: Record<string, string> = {}) {
    while (stack.length > 1 && htmlAutoClose[stack.at(-1)!.name]?.includes(name)) stack.pop();
    admit(Object.values(attributes).reduce((sum, v) => sum + v.length, 0));
    if (stack.length > 256) limit("depth");
    const node: Node = { name, text: "", attributes, children: [] };
    stack.at(-1)!.children.push(node);
    if (!voidTags.has(name)) stack.push(node);
  }
  function addText(value: string, kind = "#text", offset = 0) {
    if (!value) return;
    if (kind === "#text" && value.includes("\u0000")) {
      for (let at = 0; at < value.length; at++) if (value[at] === "\u0000") warnings.push({ position: offset + at, message: "Char 0x0 out of allowed range" });
      value = value.split("\u0000").join(" ");
    }
    // libxml does not retain initial blank characters or blanks in html/head.
    if (["#document", "html", "head"].includes(stack.at(-1)!.name) && [...value].every(c => " \t\n\r".includes(c))) return;
    if (["#document", "html", "head"].includes(stack.at(-1)!.name) && kind === "#text") open("p");
    const parent = stack.at(-1)!;
    if (parent.name === "script" || parent.name === "style") kind = "#cdata";
    admit(value.length);
    const last = parent.children.at(-1);
    if (last?.name === kind) last.text += value;
    else parent.children.push({ name: kind, text: value, attributes: {}, children: [], offset });
  }
  let tag = "", attr = "", attrValue = "", attrOffset = 0, attributes: Record<string, string> = {};
  let rawText: { start: number; end: number } | undefined;
  function flushRawText() {
    if (!rawText) return;
    const { start, end } = rawText; rawText = undefined;
    // HTML4 libxml parses title/textarea child markup; HTML5 tokenizers retain it.
    const fragment = new Tokenizer({ xmlMode: false, decodeEntities: false }, callbacks(start, true));
    fragment.write(text.slice(start, end)); fragment.end();
  }
  function callbacks(base = 0, fragment = false): ConstructorParameters<typeof Tokenizer>[1] { return {
    onopentagname(start, end) { tag = text.slice(base + start, base + end).toLowerCase(); attributes = {}; },
    onattribname(start, end) { attr = text.slice(base + start, base + end).toLowerCase(); attrValue = ""; },
    onattribdata(start, end) { if (!attrValue) attrOffset = base + start; attrValue += text.slice(base + start, base + end); },
    onattribentity(cp) { attrValue += String.fromCodePoint(cp); },
    onattribend() { if (!Object.hasOwn(attributes, attr)) attributes[attr] = entities(attrValue, (position, message) => warnings.push({ position: attrOffset + position, message })); },
    onopentagend(end) { if (!htmlElements.has(tag)) warnings.push({ position: base + end, message: `Tag ${tag} invalid` }); open(tag, attributes); },
    onselfclosingtag(end) { if (!htmlElements.has(tag)) warnings.push({ position: base + end, message: `Tag ${tag} invalid` }); open(tag, attributes); },
    onclosetag(start, end) {
      if (!fragment) flushRawText();
      const name = text.slice(base + start, base + end).toLowerCase(), priority = priorities[name] ?? 100;
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.name === name) { stack.length = i; return; }
        if ((priorities[stack[i]!.name] ?? 100) > priority) return;
      }
    },
    ontext(start, end) {
      if (!fragment && ["title", "textarea"].includes(stack.at(-1)!.name)) {
        rawText = { start: rawText?.start ?? start, end }; return;
      }
      addText(text.slice(base + start, base + end), "#text", base + start);
    },
    ontextentity(cp) { addText(String.fromCodePoint(cp)); },
    oncomment(start, end) { addText(text.slice(base + start, base + end), "#comment"); },
    oncdata(start, end) { addText(text.slice(base + start, base + end), "#cdata"); },
    ondeclaration() {}, onprocessinginstruction() {}, onend() {}
  }; }
  const tokenizer = new Tokenizer({ xmlMode: false, decodeEntities: false }, callbacks());
  for (let at = 0; at < text.length; at += 4096) {
    context.signal.throwIfAborted();
    if ((work += Math.min(4096, text.length - at)) > (context.limits.workbookWork ?? context.limits.inputBytes * 8 + context.limits.cells * 32)) limit("work");
    tokenizer.write(text.slice(at, at + 4096));
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  tokenizer.end();
  flushRawText();
  function decode(node: Node) { if (node.name === "#text") node.text = entities(node.text, (position, message) => warnings.push({ position: (node.offset ?? 0) + position, message })); for (const child of node.children) decode(child); }
  decode(root);
  let cursor = 0, line = 1, start = 0;
  for (const warning of warnings.sort((a, b) => a.position - b.position)) {
    context.signal.throwIfAborted();
    while (cursor < warning.position) { if (text[cursor] === "\n") { line++; start = cursor + 1; } cursor++; }
    const newline = text.indexOf("\n", warning.position);
    const end = newline < 0 ? text.length : newline;
    const excerptStart = Math.max(start, warning.position - 80);
    const excerpt = text.slice(excerptStart, Math.min(end, excerptStart + 80)).split("\u0000")[0]!;
    const caret = " ".repeat(Math.min(79, warning.position - excerptStart));
    const message = `${context.inputFilename ? context.inputFilename + ":" : ""}${line}: HTML parser error : ${warning.message}\n${excerpt}\n${caret}^\n`;
    await context.diagnostic?.({ code: "html-parser", severity: "warning", message, bytes: new TextEncoder().encode(message) });
  }
  if (!root.children.length) throw new SsconvertError("io", "Unable to parse the html.");
  return root;
}

/** Native probe scans only the first 200 bytes (or the complete short input). */
export function probeHtml(bytes: Uint8Array, context: CapabilityContext): boolean {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) limit("input bytes");
  const prefix = bytes.subarray(0, Math.min(bytes.length, 200));
  const encoding = prefix[1] === 0 ? "utf-16le" : prefix[0] === 0 || prefix[0] === 0xfe && prefix[1] === 0xff ? "utf-16be" : "utf-8";
  const text = new TextDecoder(encoding).decode(prefix).toLowerCase();
  return text.includes("<table") || text.includes("<html") || text.includes("<!doctype html");
}
const namespace = "http://www.gnumeric.org/v10.dtd";
function record(name: string, attributes: Record<string, string | number>, children: ImportedValue[] = [], text = ""): ImportedValue {
  return { name, namespace, text, attributes: Object.entries(attributes).map(([name, value]) => ({ name, namespace: "", value: String(value) })), children };
}
function span(source: string | undefined): number {
  if (source === undefined) return 1;
  let at = 0; while (source[at] && " \t\r\n\v\f".includes(source[at]!)) at++;
  const negative = source[at] === "-";
  if (negative || source[at] === "+") at++;
  let value = 0; while (source[at] && "0123456789".includes(source[at]!)) { value = value * 10 + Number(source[at++]); if (value > 0x7fffffff) return 1; }
  return negative ? 1 : Math.max(1, value);
}

export async function readHtml(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  const root = await document(bytes, context);
  type MutableSheet = { id: string; name: string; cells: Cell[]; merges: Range[]; comments: ImportedValue[] };
  const sheets: MutableSheet[] = [];
  const tc: { sheet: MutableSheet | undefined; row: number } = { sheet: undefined, row: -1 };
  let count = 0, work = 0;
  function tick() {
    context.signal.throwIfAborted();
    if (++work > (context.limits.workbookWork ?? context.limits.inputBytes * 8 + context.limits.cells * 32)) limit("work");
  }
  function sheet(name?: string): MutableSheet {
    const normalized = name?.toLowerCase();
    const existing = normalized === undefined ? undefined : sheets.find(s => s.name.toLowerCase() === normalized);
    if (existing) return existing;
    if (sheets.length >= context.limits.sheets) limit("sheets");
    if (name === undefined) { let n = 1; while (sheets.some(s => s.name.toLowerCase() === `sheet${n}`)) n++; name = `Sheet${n}`; }
    const result = { id: `s${sheets.length + 1}`, name, cells: [], merges: [], comments: [] };
    sheets.push(result); return result;
  }
  function setCell(target: MutableSheet, row: number, column: number, text: string, style?: Readonly<Record<string, ImportedValue>>) {
    tick();
    if (row >= DEFAULT_SHEET_SIZE.rows || column >= DEFAULT_SHEET_SIZE.columns) limit("sheet dimensions");
    if (++count > context.limits.cells) limit("cells");
    const inferred = inferText(text, { sheets: [] });
    let cell: Cell = { row, column, ...inferred, ...(style ? { style } : {}) };
    if (text.startsWith("=")) {
      const parsed = parseExpression(text, { position: { sheet: target.name, row, column }, signal: context.signal });
      if (parsed.ok) cell = { ...cell, value: { kind: "blank" }, formula: text, formulaDirty: true };
    }
    if (["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"].includes(text)) cell = { ...cell, value: { kind: "error", value: text } };
    if (cell.format === "0%") cell = { ...cell, format: "0.00%" };
    const previous = target.cells.findIndex(c => c.row === row && c.column === column);
    if (previous < 0) target.cells.push(cell); else target.cells[previous] = cell;
  }
  function readRow(node: Node) {
    let col = -1;
    for (const cell of node.children) {
      tick(); if (!rowStarts.has(cell.name)) continue;
      const target = tc.sheet!, row = tc.row;
      const contains = (r: Range, c: number) => row >= r.startRow && row <= r.endRow && c >= r.startColumn && c <= r.endColumn;
      while (target.merges.some(r => { tick(); return contains(r, col + 1); })) col++;
      const column = col + 1, colspan = span(cell.attributes.colspan), rowspan = span(cell.attributes.rowspan);
      if (rowspan > DEFAULT_SHEET_SIZE.rows - row || colspan > DEFAULT_SHEET_SIZE.columns - column) limit("sheet dimensions");
      let text = "", comment = "", bold = cell.name === "th", italic = false;
      const hrefs: string[] = [];
      function content(node: Node, first: boolean) {
        for (const child of node.children) {
          tick();
          if (child.name === "#text") {
            const chars = [...child.text]; let at = 0;
            while (at < chars.length) {
              let end = at; while (end < chars.length && space(chars[end]!)) end++;
              if (end > at && text && !space([...text].at(-1)!)) text += chars[end - 1]!;
              at = end; while (at < chars.length && !space(chars[at]!)) text += chars[at++]!;
              if (at < chars.length) text += chars[at++]!;
            }
          } else if (!child.name.startsWith("#")) {
            if (first && child.name === "b") bold = true;
            if (first && ["i", "em"].includes(child.name)) italic = true;
            if (child.name === "a" && child.attributes.href !== undefined) hrefs.push(dumpText(child.attributes.href));
            if (child.name === "img" && child.attributes.src !== undefined) comment += dumpText(child.attributes.src) + "\n";
            if (child.name === "table") {
              const previous = { ...tc }; tc.sheet = undefined; tc.row = -1;
              readTable(child);
              const nested = tc.sheet as MutableSheet | undefined;
              if (nested) {
                const name = nested.name, quoted = [...name].every(c => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".includes(c)) ? name : `'${name.split("'").join("''")}'`;
                text += `[see sheet ${quoted}]`; comment += "The original html file is\nusing nested tables.";
              }
              tc.sheet = previous.sheet; tc.row = previous.row;
            } else content(child, first);
          }
          first = false;
        }
      }
      content(cell, true);
      if (text && space([...text].at(-1)!)) text = text.slice(0, -[...text].at(-1)!.length);
      if (hrefs.length > 1 || !text) comment += (text ? hrefs : [...hrefs].reverse()).map(h => h + "\n").join("");
      if (text) {
        const link = hrefs[0];
        const font = record("Font", { Unit: 10, Bold: Number(bold), Italic: Number(italic), Underline: link ? 1 : 0, StrikeThrough: 0, Script: 0 }, [], "Sans");
        const style = record("Style", { Fore: link ? "0:0:FFFF" : "0:0:0", Back: "FFFF:FFFF:FFFF", PatternColor: "0:0:0", Format: "General" }, [font,
          ...(link ? [record("HyperLink", { type: link.startsWith("mailto:") ? "GnmHLinkEMail" : "GnmHLinkURL", target: link })] : [])]);
        setCell(target, row, column, text, { Font: { Bold: Number(bold), Italic: Number(italic), Underline: link ? 1 : 0 }, gnumeric: style });
      }
      if (comment) target.comments.push(record("CellComment", { ObjectBound: formatA1(row, column), ObjectOffset: "1 0 1 0", Direction: 17, Print: 1, Text: comment }));
      if (colspan > 1 || rowspan > 1) {
        const range = { startRow: row, startColumn: column, endRow: row + rowspan - 1, endColumn: column + colspan - 1 };
        const overlaps = target.merges.some(r => { tick(); return r.startRow <= range.endRow && r.endRow >= row && r.startColumn <= range.endColumn && r.endColumn >= column; });
        if (!overlaps) target.merges.push(range);
      }
      col += colspan;
    }
  }
  function readRows(node: Node) {
    for (const child of node.children) { tick(); if (child.name !== "tr") continue; tc.row++; tc.sheet ??= sheet(); readRow(child); }
  }
  function readTable(node: Node) {
    for (const child of node.children) {
      tick();
      if (child.name === "caption") { const name = child.children.map(dump).join(""); if (name) tc.sheet = sheet(name); }
      else if (["thead", "tfoot", "tbody"].includes(child.name)) readRows(child);
      else if (child.name === "tr") { readRows(node); break; }
    }
  }
  function searchChildren(parent: Node) {
    for (let i = 0; i < parent.children.length; i++) {
      tick(); const node = parent.children[i]!;
      if (node.name === "table") readTable(node);
      else if (tableStarts.has(node.name) || rowStarts.has(node.name)) {
        const table: Node = { name: "table", text: "", attributes: {}, children: [] };
        const allowed = (n: Node, starts: Set<string>) => n.name.startsWith("#") || starts.has(n.name) || ["del", "ins"].includes(n.name);
        if (rowStarts.has(node.name)) {
          const row: Node = { name: "tr", text: "", attributes: {}, children: [] };
          while (i < parent.children.length && allowed(parent.children[i]!, rowStarts)) row.children.push(parent.children[i++]!);
          table.children.push(row);
        }
        while (i < parent.children.length && allowed(parent.children[i]!, tableStarts)) table.children.push(parent.children[i++]!);
        i--; readTable(table);
      } else if (node.name === "#text") { tc.row++; tc.sheet ??= sheet(); setCell(tc.sheet, tc.row, 1, node.text); }
      else if (!node.name.startsWith("#")) searchChildren(node);
    }
  }
  searchChildren(root);
  context.signal.throwIfAborted();
  return { sheets: sheets.map(s => ({ id: s.id, name: s.name, cells: s.cells.sort((a, b) => a.row - b.row || a.column - b.column), size: DEFAULT_SHEET_SIZE, merges: s.merges,
    ...(s.comments.length ? { unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained" as const, data: record("Objects", {}, s.comments) }] } : {}) })), dateSystem: "1900", ...(sheets[0] ? { activeSheet: sheets[0].id } : {}) };
}

// Document bytes follow Gnumeric 1.12.61 plugins/html/html.c (GPL-2.0-or-later).
const htmlHeaders: Readonly<Record<string, string>> = {
  "HTML32": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 3.2 Final//EN\">\n<html>\n<head>\n\t<title>Tables</title>\n<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\">\n<meta name=\"generator\" content=\"Gnumeric 1.12.61 via GPFH/0.5\">\n<style><!--\ntt {\n\tfont-family: courier;\n}\ntd {\n\tfont-family: helvetica, sans-serif;\n}\ncaption {\n\tfont-family: helvetica, sans-serif;\n\tfont-size: 14pt;\n\ttext-align: left;\n}\n--></style>\n</head>\n<body>\n",
  "HTML40": "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01//EN\"\n\t\t\"http://www.w3.org/TR/html4/strict.dtd\">\n<html>\n<head>\n\t<title>Tables</title>\n<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\">\n<meta name=\"generator\" content=\"Gnumeric 1.12.61 via GPFH/0.5\">\n<style type=\"text/css\">\ntt {\n\tfont-family: courier;\n}\ntd {\n\tfont-family: helvetica, sans-serif;\n}\ncaption {\n\tfont-family: helvetica, sans-serif;\n\tfont-size: 14pt;\n\ttext-align: left;\n}\n.underline { text-decoration: underline; }\n.lowunderline { text-decoration: underline; text-underline-offset: 0.4em; }\n.doubleunderline { text-decoration: underline double; }\n.lowdoubleunderline { text-decoration: underline double; text-underline-offset: 0.4em; }\n.errorunderline { text-decoration: underline wavy; }\n</style>\n</head>\n<body>\n",
  "XHTML": "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\"\n\t\t\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\">\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"en\" lang=\"en\">\n<head>\n\t<title>Tables</title>\n<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\" />\n<meta name=\"generator\" content=\"Gnumeric 1.12.61 via GPFH/0.5\" />\n<style type=\"text/css\">\ntt {\n\tfont-family: courier;\n}\ntd {\n\tfont-family: helvetica, sans-serif;\n}\ncaption {\n\tfont-family: helvetica, sans-serif;\n\tfont-size: 14pt;\n\ttext-align: left;\n}\n.underline { text-decoration: underline; }\n.lowunderline { text-decoration: underline; text-underline-offset: 0.4em; }\n.doubleunderline { text-decoration: underline double; }\n.lowdoubleunderline { text-decoration: underline double; text-underline-offset: 0.4em; }\n.errorunderline { text-decoration: underline wavy; }\n</style>\n</head>\n<body>\n"
};

export interface HtmlExportProfile {
  readonly header: "HTML32" | "HTML40" | "XHTML" | "fragment";
  readonly legacy?: boolean;
  readonly fontColor?: boolean;
  readonly backgroundAttribute?: boolean;
  readonly rangeScope?: boolean;
}
function exportEncoded(text: string, tick: (amount?: number) => void): string {
  let result = "";
  for (let at = 0; at < text.length;) {
    tick(); const code = text.codePointAt(at)!; const c = String.fromCodePoint(code); at += c.length;
    if (code === 0) break;
    if (c === "\r") { result += "<br>\r"; if (text[at] === "\n") { result += "\n"; at++; } }
    else result += c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : c === "\n" ? "<br>\n" : code >= 32 && code < 128 || c === "\t" ? c : `&#${code};`;
  }
  return result;
}
function htmlRgb(source: string | undefined, fallback = "000000"): string {
  return source ? source.split(":").map(c => (parseInt(c, 16) >>> 8).toString(16).padStart(2, "0")).join("").toUpperCase() : fallback;
}
const htmlBorderStyles = ["", "thin solid", "medium solid", "thin dashed", "thin dotted", "thick solid", "thick double", "0.5pt solid", "medium dashed", "thin dashed", "medium dashed", "thin dotted", "medium dotted", "thin dashed"];
const htmlUnderlineClasses = ["", "underline", "doubleunderline", "lowunderline", "lowdoubleunderline"];

/** Provider profiles select syntax; all five savers share this byte writer. */
export function createHtmlWriter(profile: HtmlExportProfile): NonNullable<import("./types.js").Codec["write"]> {
  return async (book, _options, context, selection) => {
    let work = 0, outputSize = 0, nodes = 0;
    const chunks: string[] = [];
    function tick(amount = 1) {
      context.signal.throwIfAborted();
      if (amount > (context.limits.workbookWork ?? context.limits.inputBytes * 8 + context.limits.cells * 32) - work) limit("export work");
      work += amount;
    }
    function put(text: string) {
      tick(text.length);
      if (text.length > context.limits.outputBytes - outputSize) limit("output bytes");
      outputSize += text.length; chunks.push(text);
    }
    const encoded = (text: string) => exportEncoded(text, tick);
    const selected = selection ? selection.sheets.map(id => book.sheets.find(s => s.id === id || s.name === id)).filter(s => s !== undefined) :
      profile.rangeScope ? [book.sheets.find(s => s.id === book.activeSheet) ?? book.sheets[0]].filter(s => s !== undefined) : book.sheets;
    if (book.sheets.length > context.limits.sheets) limit("sheets");
    if (selected.length > context.limits.operations) limit("sheet selection");
    put(htmlHeaders[profile.header] ?? "");
    for (const sheet of selected) {
      tick();
      const regions = sheet.unsupportedRecords?.filter(r => r.kind === "Styles").flatMap(r => metadataNode(r.data, tick)?.children ?? []) ?? [];
      const objects = sheet.unsupportedRecords?.filter(r => r.kind === "Objects").flatMap(r => metadataNode(r.data, tick)?.children ?? []) ?? [];
      const view = sheet.view?.gnumeric;
      const displayFormulas = Boolean(view && typeof view === "object" && !Array.isArray(view) && Number((view as Readonly<Record<string, ImportedValue>>).DisplayFormulas ?? 0));
      const cells = new Map<string, Cell>();
      let startRow = Infinity, startColumn = Infinity, endRow = 0, endColumn = 0;
      const extend = (range: Range) => {
        startRow = Math.min(startRow, range.startRow); startColumn = Math.min(startColumn, range.startColumn);
        endRow = Math.max(endRow, range.endRow); endColumn = Math.max(endColumn, range.endColumn);
      };
      for (const cell of sheet.cells) {
        tick(); if (cells.size >= context.limits.cells) limit("cells");
        cells.set(`${cell.row}:${cell.column}`, cell);
        const value = cell.cachedResult ?? cell.value;
        if (value.kind !== "blank" && !(value.kind === "string" && value.value === "")) {
          extend({ startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column });
          for (const merge of sheet.merges ?? []) { tick(); if (merge.startRow === cell.row && merge.startColumn === cell.column) extend(merge); }
        }
      }
      for (const object of objects) {
        tick(); const parts = (object.attributes.ObjectBound ?? "").split(":").map(address => parseA1(address));
        if (parts[0] && parts[1]) extend({ startRow: parts[0].row, startColumn: parts[0].column, endRow: parts[1].row, endColumn: parts[1].column });
      }
      if (startRow === Infinity) startRow = 0;
      if (startColumn === Infinity) startColumn = 0;
      function styleAt(row: number, column: number, cell?: Cell): MetadataNode | undefined {
        let style: MetadataNode | undefined;
        for (const region of regions) {
          tick(); const a = region.attributes;
          if (row >= Number(a.startRow) && row <= Number(a.endRow) && column >= Number(a.startCol) && column <= Number(a.endCol)) {
            const next = region.children.find(n => n.name === "Style");
            if (next) style = next;
          }
        }
        return metadataNode(cell?.style?.gnumeric, tick) ?? style;
      }
      put(profile.legacy ? '<p><table border="1">\n' : '<p></p><table cellspacing="0" cellpadding="3">\n');
      if (!profile.rangeScope) put(`<caption>${encoded(sheet.name)}</caption>\n`);
      for (let row = startRow; row <= endRow; row++) {
        put("<tr>\n");
        for (let column = startColumn; column <= endColumn; column++) {
          tick(); if (++nodes > (context.limits.workbookNodes ?? 100000)) limit("export nodes");
          let merge: Range | undefined;
          for (const candidate of sheet.merges ?? []) { tick(); if (row >= candidate.startRow && row <= candidate.endRow && column >= candidate.startColumn && column <= candidate.endColumn) { merge = candidate; break; } }
          if (merge && (row !== merge.startRow || column !== merge.startColumn)) continue;
          const cell = cells.get(`${row}:${column}`), style = styleAt(row, column, cell), a = style?.attributes ?? {};
          const font = style?.children.find(n => n.name === "Font"), f = font?.attributes ?? {};
          let color = htmlRgb(a.Fore);
          const value = cell?.cachedResult ?? cell?.value;
          if (cell?.format && value?.kind === "number") {
            const host: FormatHost = { context, book, locale: formattingLocale(context.environment.locale), tick };
            const section = selectFormatSection(parseFormatSections(cell.format, host), value.value).section;
            const colors: Readonly<Record<string, string>> = { black: "000000", blue: "0000FF", cyan: "00FFFF", green: "00FF00", magenta: "FF00FF", red: "FF0000", white: "FFFFFF", yellow: "FFFF00" };
            color = colors[section.color?.toLowerCase() ?? ""] ?? color;
          }
          const back = Number(a.Shade ?? 0) !== 0 ? htmlRgb(a.Back, "FFFFFF") : undefined;
          put(merge ? `<td colspan="${merge.endColumn - column + 1}" rowspan="${merge.endRow - row + 1}" ` : "<td ");
          if (profile.backgroundAttribute && back) put(` bgcolor="#${back}"`);
          if (cell) {
            const vertical = ({ "1": "top", "2": "bottom", "4": "center", "8": "baseline", "16": "center", GNM_VALIGN_TOP: "top", GNM_VALIGN_BOTTOM: "bottom", GNM_VALIGN_CENTER: "center", GNM_VALIGN_JUSTIFY: "baseline", GNM_VALIGN_DISTRIBUTED: "center" } as Record<string, string>)[a.VAlign ?? "2"];
            const horizontal = ({ "2": "left", "4": "right", "8": "center", "32": "justify", "64": "center", "128": "center", GNM_HALIGN_LEFT: "left", GNM_HALIGN_RIGHT: "right", GNM_HALIGN_CENTER: "center", GNM_HALIGN_JUSTIFY: "justify", GNM_HALIGN_CENTER_ACROSS_SELECTION: "center", GNM_HALIGN_DISTRIBUTED: "center" } as Record<string, string>)[a.HAlign ?? "1"] ??
              (a.HAlign === "16" || a.HAlign === "GNM_HALIGN_FILL" ? undefined : displayFormulas && cell.formula ? "left" : value?.kind === "number" ? "right" : value?.kind === "boolean" || value?.kind === "error" ? "center" : "left");
            if (vertical) put(` valign="${vertical}" `);
            if (horizontal) put(` align="${horizontal}" `);
          }
          if (!profile.legacy) {
            put(' style="');
            if (back) put(`background:#${back};`);
            if (cell) {
              put(` font-size:${Math.floor(Number(f.Unit ?? 10) + .5)}pt;`);
              if (color !== "000000") put(` color:#${color};`);
              if (Number(a.Hidden ?? 0)) put(" visibility:hidden;");
            }
            const endStyle = merge ? styleAt(merge.endRow, merge.endColumn, cells.get(`${merge.endRow}:${merge.endColumn}`)) : style;
            for (const edge of merge ? ["Top", "Left", "Bottom", "Right"] : ["Top", "Bottom", "Left", "Right"]) {
              const border = (merge && (edge === "Bottom" || edge === "Right") ? endStyle : style)?.children.find(n => n.name === "StyleBorder")?.children.find(n => n.name === edge);
              const line = htmlBorderStyles[Number(border?.attributes.Style ?? 0)];
              if (line) put(` border-${edge.toLowerCase()}:${line} #${htmlRgb(border?.attributes.Color)};`);
            }
            put('"');
          }
          put(">");
          if (profile.legacy && Number(a.Hidden ?? 0)) put("<!-- 'HIDDEN DATA' -->");
          else {
            const closings: string[] = [];
            const tag = (open: string, close: string) => { put(open); closings.unshift(close); };
            if (Number(f.Italic ?? 0)) tag("<i>", "</i>");
            if (Number(f.Bold ?? 0)) tag("<b>", "</b>");
            const underline = htmlUnderlineClasses[Number(f.Underline ?? 0)];
            if (underline) tag(profile.legacy ? "<u>" : `<span class="${underline}">`, profile.legacy ? "</u>" : "</span>");
            if (["courier", "fixed"].includes(font?.text.toLowerCase() ?? "")) tag("<tt>", "</tt>");
            const strike = Number(f.StrikeThrough ?? 0) !== 0;
            if (strike) tag(profile.legacy ? "<strike>" : '<span style="text-decoration: line-through;">', profile.legacy ? "</strike>" : "</span>");
            const script = Number(f.Script ?? 0);
            if (script) put(script < 0 ? "<sub>" : "<sup>");
            // Native closes strike before script, even though the opening order is reversed.
            if (script) closings.splice(strike ? 1 : 0, 0, script < 0 ? "</sub>" : "</sup>");
            const link = style?.children.find(n => n.name === "HyperLink");
            if (link && ["GnmHLinkURL", "GnmHLinkExternal"].includes(link.attributes.type ?? "")) {
              const target = htmlUrl(link.attributes.target ?? "", tick);
              tag(`<a href="${link.attributes.type === "GnmHLinkExternal" ? "file://" : ""}${target}">`, "</a>");
            }
            if (cell && profile.fontColor && color !== "000000") tag(`<font color="#${color}">`, "</font>");
            if (displayFormulas && cell?.formula) put(encoded(cell.formula));
            else if (cell?.richText && value?.kind === "string") {
              const bytes = new TextEncoder().encode(value.value), boundaries = new Set([0, bytes.length]);
              for (const run of cell.richText) { tick(); boundaries.add(Math.min(run.start, bytes.length)); boundaries.add(Math.min(run.end, bytes.length)); }
              const positions = [...boundaries].sort((a, b) => a - b);
              for (let index = 0; index + 1 < positions.length; index++) {
                const from = positions[index]!, to = positions[index + 1]!, closures: string[] = [];
                const attributes = new Map<string, ImportedValue>();
                for (const run of cell.richText) {
                  tick(); if (from < run.start || from >= run.end) continue;
                  for (const [key, attribute] of Object.entries(run.attributes)) {
                    tick(); attributes.set(key, attribute);
                  }
                }
                for (const [key, attribute] of attributes) {
                    tick(); let open = "", close = "";
                    if (key === "bold" && Number(attribute)) { open = "<b>"; close = "</b>"; }
                    if (key === "italic" && Number(attribute)) { open = "<i>"; close = "</i>"; }
                    if (key === "strikethrough" && Number(attribute)) { open = profile.legacy ? "<strike>" : '<span style="text-decoration: line-through;">'; close = profile.legacy ? "</strike>" : "</span>"; }
                    if (key === "underline" && attribute !== "none") {
                      const name = ({ single: "underline", low: "lowunderline", double: "doubleunderline", error: "errorunderline", "single-line": "underline", "double-line": "doubleunderline", "error-line": "errorunderline" } as Record<string, string>)[String(attribute)];
                      if (name) { open = profile.legacy ? "<u>" : `<span class="${name}">`; close = profile.legacy ? "</u>" : "</span>"; }
                    }
                    if (key === "rise" && Math.abs(Number(attribute)) > 5 || key === "subscript" && Number(attribute) || key === "superscript" && Number(attribute)) {
                      const sub = key === "subscript" || key === "rise" && Number(attribute) < 0;
                      open = sub ? "<sub>" : "<sup>"; close = sub ? "</sub>" : "</sup>";
                    }
                    if (open) { put(open); closures.unshift(close); }
                }
                put(encoded(new TextDecoder().decode(bytes.subarray(from, to))));
                for (const closure of closures) put(closure);
              }
            } else if (cell) put(encoded(await renderCellText(cell, book, context, "preserve")));
            for (const close of closings) put(close);
          }
          put("</td>\n");
          if (merge) column = merge.endColumn;
        }
        put("</tr>\n");
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      put("</table>\n");
    }
    if (profile.header !== "fragment") put("</body>\n</html>\n");
    context.signal.throwIfAborted();
    return new TextEncoder().encode(chunks.join(""));
  };
}
function htmlUrl(text: string, tick: (amount?: number) => void): string {
  let result = "";
  for (const byte of new TextEncoder().encode(text)) {
    tick(); const c = String.fromCharCode(byte);
    result += byte >= 48 && byte <= 57 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122 || "-._~!$&'()*+,;=:@/".includes(c) ? c : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return result;
}
