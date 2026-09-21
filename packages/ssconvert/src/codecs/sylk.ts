// Released Gnumeric 1.12.61 plugins/sylk (GPL-2.0-or-later).
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { AxisMetadata, Cell, CellValue, FormulaGroup, ImportedValue, NamedExpression, Workbook } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { gnumericGrammar, sylkGrammar, sylkWriterGrammar } from "../formulas/conventions.js";
import { quoteNativeSheet, serializeExpression } from "../formulas/serialization.js";
import { inferText } from "../workbook/updates/inference.js";
import { recordInput, recordSheet } from "./record-text.js";
import { documentOutput, documentSheet } from "./document-export.js";
import { gnumericNumber } from "./gnumeric-number.js";
import { sylkMergeStyle, sylkOutputStyle, sylkStyleNode, type SylkStyle } from "./sylk-styles.js";
import type { FormulaNode } from "../formulas/ast.js";
import { functionDescriptors } from "../formulas/function-descriptors.js";

const writerGrammar = { ...sylkWriterGrammar, quoteSheetName: quoteNativeSheet,
  functionExportAliases: Object.fromEntries([...Object.keys(functionDescriptors), "IF", "SUM", "PRODUCT", "RAND", "TABLE", "GNUMERIC_VERSION"].map(name => [name, name.toLowerCase()])) };

/** Semicolons double even inside unquoted fields; quotation does not tokenize. */
function tokens(text: string): string[] {
  const result: string[] = []; let field = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ";") {
      if (text[i + 1] === ";") { field += ";"; i++; }
      else { result.push(field); field = ""; }
    } else if (text[i] === "\x1b") {
      if (text[i + 1] !== "N" || i + 2 >= text.length) continue;
      const code = text.charCodeAt(i + 2);
      if (code <= 32 || code >= 127) { i++; continue; }
      const low = '¡¢£$¥#§¤\'"«, -./°±²³4µ¶·8\'"»¼½¾¿'.split(" ").join("");
      const high = '¯¬®©TUVWXYZ[\\]^_`ÆÐªdefghØŒ°ÞmnopærðtuvwxøœßÞ}~';
      if (code < 64) { field += low[code - 33]; i += 2; }
      else if (code >= 80) { field += high[code - 80]; i += 2; }
      else {
        const accent = [-1, 0, 1, 2, 3, -1, -1, -1, 8, -1, 10, 39, -1, -1, -1, -1][code - 64]!;
        field += ((text[i + 3] ?? "") + (accent >= 0 && text[i + 3] ? String.fromCharCode(768 + accent) : "")).normalize("NFC"); i += 3;
      }
    } else field += text[i];
  }
  if (field) result.push(field);
  return result;
}
function integer(text: string): number | undefined {
  let at = 0; while (text[at] && " \t\r\n\v\f".includes(text[at]!)) at++;
  const negative = text[at] === "-"; if (negative || text[at] === "+") at++;
  const start = at; let magnitude = 0n;
  while (text[at]! >= "0" && text[at]! <= "9") {
    magnitude = magnitude * 10n + BigInt(text.charCodeAt(at++) - 48);
    if (magnitude > (negative ? 9223372036854775808n : 9223372036854775807n)) return undefined;
  }
  return at > start ? Number(BigInt.asIntN(32, negative ? -magnitude : magnitude)) : undefined;
}
function coord(text: string, previous: number, maximum: number): number { const n = integer(text); return n !== undefined && n >= 1 && n <= maximum ? n - 1 : previous; }
function value(text: string, book: Workbook): CellValue {
  if (text.startsWith('"')) return { kind: "string", value: text.slice(1, text.endsWith('"') && text.length > 1 ? -1 : undefined) };
  if (["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"].includes(text)) return { kind: "error", value: text };
  // format_match_simple does not use text-entry apostrophe or formula handling.
  if (text.startsWith("'") || text.startsWith("=" ) || !text) return { kind: "string", value: text };
  let end = text.length; while (end > 0 && " \t\r\n\v\f".includes(text[end - 1]!)) end--;
  if (text.slice(0, end).trimEnd().length !== end) return { kind: "string", value: text };
  const inferred = inferText(text, book);
  if (inferred.format || text.includes(",")) return { kind: "string", value: text };
  if (inferred.value.kind === "number" && inferred.value.value === 0) {
    const mantissa = text.toLowerCase().split("e")[0]!;
    if ([...mantissa].some(c => c >= "1" && c <= "9")) return { kind: "string", value: text };
    return { kind: "number", value: 0 };
  }
  return inferred.value;
}

export async function probeSylk(bytes: Uint8Array, context: CapabilityContext): Promise<boolean> {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert SYLK input bytes limit exceeded");
  return bytes.length >= 3 && bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 59;
}
export async function readSylk(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  const input = recordInput(bytes, context, "SYLK"), cells = new Map<string, Cell>();
  const formats: string[] = [], fonts: SylkStyle[] = [], names = new Map<string, NamedExpression>();
  const styles: { row: number; column: number; endRow: number; endColumn: number; style: SylkStyle }[] = [];
  const rows = new Map<number, AxisMetadata>(), columns = new Map<number, AxisMetadata>(), groups: FormulaGroup[] = [];
  let row = 1, column = 1, finished = false, referenceMode = "A1", calculationMode: "manual" | "automatic" = "automatic", dateSystem: "1900" | "1904" = "1900";
  let iteration: Workbook["iteration"];
  const view: Record<string, ImportedValue> = {};
  function charge(count: number) { context.signal.throwIfAborted(); if (count > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert SYLK records limit exceeded"); }
  async function warn(message: string) { await context.diagnostic?.({ code: "sylk-record", severity: "warning", message: `${input.line}:${message}` }); context.signal.throwIfAborted(); }
  function expression(text: string): string | undefined {
    const discovered: NamedExpression[] = [];
    const parsed = parseExpression(text.startsWith("=") ? text : "=" + text, { grammar: sylkGrammar, position: { sheet: "Sheet1", row, column },
      signal: context.signal, maximumNodes: context.limits.workbookNodes ?? context.limits.operations, maximumLength: context.limits.inputBytes,
      onName(name, sheet) { discovered.push({ name, expression: "=#NAME?", position: { sheet: "Sheet1", row, column }, ...(sheet ? { sheet } : {}) }); } });
    for (const name of discovered) {
      if (name.sheet !== undefined && name.sheet.toLowerCase() !== "sheet1") continue;
      const key = `${name.sheet?.toLowerCase() ?? ""}:${name.name.toLowerCase()}`;
      if (!names.has(key)) { charge(names.size + 1); names.set(key, { ...name, ...(name.sheet === undefined ? {} : { sheet: "Sheet1" }) }); }
    }
    if (!parsed.ok) return undefined;
    function known(node: FormulaNode): boolean {
      if (node.kind === "reference") return [node.first, node.last].every(ref => !ref || ref.workbook === undefined && (ref.sheet === undefined || ref.sheet.toLowerCase() === "sheet1"));
      if (node.kind === "name") return node.workbook === undefined && (node.sheet === undefined || node.sheet.toLowerCase() === "sheet1");
      if (node.kind === "binary") return known(node.left) && known(node.right);
      if (node.kind === "unary" || node.kind === "parentheses") return known(node.child);
      if (node.kind === "call") return node.args.every(known);
      if (node.kind === "array") return node.rows.every(row => row.every(known));
      return true;
    }
    if (!known(parsed.document.root)) return undefined;
    return serializeExpression(parsed.document, { ...gnumericGrammar, quoteSheetName: quoteNativeSheet }, false, true);
  }
  while (!finished) {
    const raw = await input.next(); if (raw === undefined) break;
    let end = raw.length; while (end > 0 && " \t\r\n\v\f".includes(raw[end - 1]!)) end--;
    const line = raw.slice(0, end);
    const directive = line.length >= 2 && line[1] === ";" ? line[0] : line.startsWith("E") ? "E" : undefined;
    const fields = tokens(line.slice(2));
    if (directive === "E") { finished = true; continue; }
    if (directive === "B" || "ID".startsWith(line) || "NN;".startsWith(line)) continue;
    if (directive === "C") {
      let v: CellValue | undefined, formula: string | undefined, array = false, endRow = -1, endColumn = -1;
      for (const f of fields) {
        const key = f[0], s = f.slice(1);
        if (key === "X") column = coord(s, column, 256);
        else if (key === "Y") row = coord(s, row, 65536);
        else if (key === "K") { if (v) await warn("Multiple values in the same cell"); v = value(s, { sheets: [], dateSystem }); }
        else if (key === "E" || key === "M") { if (formula) await warn("Multiple expressions in the same cell"); formula = expression(s); if (key === "M") array = true; }
        else if (key === "I") array = true;
        else if (key === "R") endRow = coord(s, -1, 65536);
        else if (key === "C") endColumn = coord(s, -1, 256);
      }
      if (v || formula) {
        const key = `${row}:${column}`; if (!cells.has(key)) charge(cells.size + 1);
        const prior = array && !formula ? cells.get(key) : undefined;
        const cell: Cell = { ...prior, row, column, value: v ?? prior?.value ?? { kind: "blank" },
          ...(formula ? { formula, cachedResult: v ?? { kind: "blank" }, formulaDirty: false } : prior?.formula && v ? { cachedResult: v } : {}) };
        cells.set(key, cell);
        if (array && formula) {
          const range = { startRow: row, startColumn: column, endRow: endRow < 0 ? row : endRow, endColumn: endColumn < 0 ? column : endColumn };
          if (range.endRow >= row && range.endColumn >= column) {
            charge((range.endRow - row + 1) * (range.endColumn - column + 1));
            let additions = 0;
            for (let r = row; r <= range.endRow; r++) for (let c = column; c <= range.endColumn; c++) {
              context.signal.throwIfAborted(); if (!cells.has(`${r}:${c}`)) additions++;
            }
            charge(cells.size + additions);
            const id = `array-${input.line}`; groups.push({ id, kind: "array", range, expression: formula });
            for (let r = row; r <= range.endRow; r++) for (let c = column; c <= range.endColumn; c++) {
              context.signal.throwIfAborted(); const key = `${r}:${c}`, previous = cells.get(key);
              cells.set(key, { ...previous, row: r, column: c, value: previous?.value ?? { kind: "blank" },
                formula, formulaGroup: id, cachedResult: previous?.cachedResult ?? previous?.value ?? { kind: "blank" }, formulaDirty: false });
            }
          }
        }
      }
    } else if (directive === "P") {
      const font: SylkStyle = {};
      for (const f of fields) {
        const key = f[0], s = f.slice(1);
        if (key === "P") { charge(formats.length + 1); formats.push(s); }
        else if (key === "E" && s) font.Name = s;
        else if (key === "M" && (integer(s) ?? 0) > 0) font.Unit = integer(s)! / 20;
        else if (key === "S") { if (s.includes("I")) font.Italic = 1; if (s.includes("B")) font.Bold = 1; }
        else if (!["F", "L", "E", "M"].includes(key!)) await warn(`unknown P option '${key}'`);
      }
      if (Object.keys(font).length) { charge(fonts.length + 1); fonts.push(font); }
    } else if (directive === "O") {
      referenceMode = "R1C1";
      for (const f of fields) {
        const key = f[0], s = f.slice(1);
        if (key === "L") referenceMode = "A1";
        else if (key === "M") calculationMode = "manual";
        else if (key === "V" && s.startsWith("4")) dateSystem = "1904";
        else if (key === "P") view.isProtected = true;
        else if (key === "Z") view.hideZero = true;
        else if (key === "A" || key === "G") { const parts = s.trim().split(" ").filter(Boolean); if (parts.length >= 2 && integer(parts[0]!) !== undefined && Number.isFinite(Number(parts[1]))) iteration = { enabled: key === "A", maximum: integer(parts[0]!)!, tolerance: Number(parts[1]) }; }
        else if (!["C", "D", "E", "K", "R", "V"].includes(key!)) await warn(`unknown option '${key}'`);
      }
    } else if (directive === "F") {
      let style: SylkStyle = {}, fullColumn = -1, fullRow = -1, size = -1, defaults = false;
      for (const f of fields) {
        const key = f[0], s = f.slice(1);
        if (key === "X") column = coord(s, column, 256);
        else if (key === "Y") row = coord(s, row, 65536);
        else if (key === "C") fullColumn = coord(s, -1, 256);
        else if (key === "R") fullRow = coord(s, -1, 65536);
        else if (key === "M") size = integer(s) ?? size;
        else if (key === "P") { const index = integer(s); if (index !== undefined && formats[index] !== undefined) style.Format = formats[index]!; }
        else if (key === "D" || key === "F") {
          if (key === "D") defaults = true;
          // sscanf("%c%d%c") skips whitespace for %d, but not for %c.
          let at = 1; while (s[at] && " \t\r\n\v\f".includes(s[at]!)) at++;
          if (s[at] === "+" || s[at] === "-") at++;
          const start = at; while (s[at]! >= "0" && s[at]! <= "9") at++;
          const align: Record<string, number> = { S: 1, D: 1, L: 2, R: 4, C: 8, X: 16 };
          if (at > start && align[s[at]!] !== undefined) style.HAlign = align[s[at]!]!;
        } else if (key === "S") {
          for (let at = 0; at < s.length; at++) {
            const ch = s[at]!;
            if (ch === "I" || ch === "D") style = sylkMergeStyle(style, { Font: { [ch === "I" ? "Italic" : "Bold"]: 1 } });
            else if (ch === "M") { const index = integer(s.slice(at + 1)); if (index !== undefined && fonts[index - 1]) { const font = fonts[index - 1]!; style = sylkMergeStyle(style, { Font: Object.fromEntries(Object.entries(font).filter(([key]) => key === "Name" || key === "Unit")) }); } break; }
            else if (ch === "S") style.Shade = 5;
            else if ("TBLR".includes(ch)) style = sylkMergeStyle(style, { StyleBorder: { [{ T: "Top", B: "Bottom", L: "Left", R: "Right" }[ch]!]: true } });
            else await warn(`unhandled style S${ch}.`);
          }
        } else if (key === "N") { const parts = s.trim().split(" ").filter(Boolean), index = integer(parts[0] ?? "");
          if (index !== undefined && fonts[index - 1] && integer(parts[1] ?? "") !== undefined) { defaults = true;
            style = sylkMergeStyle(style, { Font: Object.fromEntries(Object.entries(fonts[index - 1]!).filter(([key]) => key === "Name" || key === "Unit")) }); } }
        else if (key === "W") {
          const parts = s.trim().split(" ").filter(Boolean).map(integer), [first, last, width] = parts;
          if (first !== undefined && last !== undefined && width !== undefined && first >= 1 && last >= first && last <= 256) for (let col = first - 1; col < last; col++) { charge(columns.size + 1); columns.set(col, { index: col, sizePoints: width * 7.45 }); }
        } else if (["E", "G", "H", "Z"].includes(key!)) { const props: Record<string, string> = { E: "displayFormulas", G: "hideGrid", H: "hideColHeader", Z: "hideZero" }; view[props[key!]!] = true; if (key === "H") view.hideRowHeader = true; }
        else if (key !== "K") await warn(`unhandled F option ${key}.`);
      }
      if (fullColumn >= 0 && size > 0) columns.set(fullColumn, { ...columns.get(fullColumn), index: fullColumn, sizePoints: size / 20 });
      else if (fullRow >= 0 && size > 0) rows.set(fullRow, { ...rows.get(fullRow), index: fullRow, sizePoints: size / 20 });
      if (Object.keys(style).length) { charge(styles.length + 1); styles.push({ row: fullColumn >= 0 || defaults ? 0 : fullRow >= 0 ? fullRow : row,
        column: fullColumn >= 0 ? fullColumn : fullRow >= 0 || defaults ? 0 : column,
        endRow: fullColumn >= 0 || defaults ? 65535 : fullRow >= 0 ? fullRow : row,
        endColumn: fullColumn >= 0 ? fullColumn : fullRow >= 0 || defaults ? 255 : column, style }); }
    } else if (directive === "W") { for (const f of fields) if (!"RABNSC".includes(f[0] ?? "\0")) await warn(`unhandled W option ${f[0]}.`); }
    else await warn(`Unknown directive '${line}'`);
  }
  if (!finished) await warn("Missing closing 'E'");
  let work = 0;
  const maximumWork = context.limits.workbookWork ?? context.limits.inputBytes * 8 + context.limits.cells * 32;
  const result = [...cells.values()].sort((a, b) => a.row - b.row || a.column - b.column).map(cell => {
    let style: SylkStyle = {};
    for (const region of styles) { context.signal.throwIfAborted(); if (++work > maximumWork) throw new SsconvertError("resource-limit", "ssconvert SYLK style work limit exceeded");
      if (cell.row >= region.row && cell.row <= region.endRow && cell.column >= region.column && cell.column <= region.endColumn) style = sylkMergeStyle(style, region.style); }
    return Object.keys(style).length ? { ...cell, ...(typeof style.Format === "string" ? { format: style.Format } : {}), style: { ...style, gnumeric: sylkStyleNode(style) } } : cell;
  });
  const styleRegions: ImportedValue[] = styles.map(r => ({ name: "StyleRegion", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: Object.entries({ startRow: r.row, startCol: r.column, endRow: r.endRow, endCol: r.endColumn }).map(([name, value]) => ({ name, namespace: "", value: String(value) })), children: [sylkStyleNode(r.style)] }));
  return { sheets: [{ id: "Sheet1", name: "Sheet1", size: { columns: 256, rows: 65536 }, cells: result,
    view: { ...view, referenceMode }, ...(rows.size ? { rows: [...rows.values()] } : {}), ...(columns.size ? { columns: [...columns.values()] } : {}),
    ...(groups.length ? { formulaGroups: groups } : {}), ...(styleRegions.length ? { unsupportedRecords: [{ source: "sylk", kind: "Styles", disposition: "retained", data: { name: "Styles", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [], children: styleRegions } }] } : {}) }],
    activeSheet: "Sheet1", dateSystem, calculationMode, ...(iteration ? { iteration } : {}), ...(names.size ? { names: [...names.values()] } : {}) };
}

function escaped(text: string): string { let result = ""; for (const c of text.split("\0")[0]!) result += c === ";" ? ";;" : c.codePointAt(0)! > 127 ? "?" : c; return result; }
export async function writeSylk(book: Workbook, _options: readonly string[], context: CapabilityContext): Promise<Uint8Array> {
  const out = documentOutput(context, "SYLK"), sheet = recordSheet(book);
  const doc = documentSheet(sheet, context, out.tick, false), r = { ...doc.extent };
  type Style = ReturnType<typeof sylkOutputStyle>;
  const formats: string[] = [], fonts: { name: string; size: number }[] = [];
  const outputStyles = new Map<string, Style>();
  function collect(style: Style) { out.tick(); outputStyles.set(JSON.stringify(style), style); }
  const cells = [...doc.cells.values()].sort((a, b) => a.row - b.row || a.column - b.column);
  let hasContent = cells.some(cell => { out.tick(); const v = cell.cachedResult ?? cell.value; return v.kind !== "blank" && !(v.kind === "string" && !v.value); });
  for (const cell of cells) { out.tick(); const v = cell.cachedResult ?? cell.value;
    if (v.kind === "string" && !v.value) { if (!hasContent) { r.startRow = r.endRow = cell.row; r.startColumn = r.endColumn = cell.column; hasContent = true; }
      r.startRow = Math.min(r.startRow, cell.row); r.endRow = Math.max(r.endRow, cell.row);
      r.startColumn = Math.min(r.startColumn, cell.column); r.endColumn = Math.max(r.endColumn, cell.column); } }
  for (const cell of cells) { out.tick(); collect(sylkOutputStyle(doc.styleAt(cell.row, cell.column, cell), cell.format)); }
  const columnStyles = new Map<number, Style>(), regions = doc.records.get("Styles") ?? [];
  const maximumRows = sheet.size?.rows ?? 65536, maximumColumns = sheet.size?.columns ?? 256;
  const cellsByColumn = new Map<number, Cell[]>();
  for (const cell of cells) { out.tick(); const values = cellsByColumn.get(cell.column) ?? []; values.push(cell); cellsByColumn.set(cell.column, values); }
  let lastColumn = r.endColumn;
  for (const region of regions) { out.tick(); lastColumn = Math.max(lastColumn, Math.min(maximumColumns - 1, Number(region.attributes.endCol))); }
  // Count effective styles by row bands, rather than expanding whole axes.
  // A full-column style becomes its default; isolated differences extend bounds.
  for (let column = 0; column <= lastColumn; column++) {
    out.tick(); const boundaries = new Set([0, maximumRows]);
    for (const region of regions) {
      out.tick(); const a = region.attributes;
      if (column >= Number(a.startCol) && column <= Number(a.endCol)) {
        boundaries.add(Math.max(0, Math.min(maximumRows, Number(a.startRow))));
        boundaries.add(Math.max(0, Math.min(maximumRows, Number(a.endRow) + 1)));
      }
    }
    for (const cell of cellsByColumn.get(column) ?? []) { out.tick(); boundaries.add(cell.row); boundaries.add(cell.row + 1); }
    const breaks = [...boundaries].sort((a, b) => a - b), counts = new Map<string, { count: number; style: Style }>();
    const bands: { row: number; endRow: number; key: string }[] = [];
    let most: { count: number; style: Style } | undefined;
    for (let i = 0; i + 1 < breaks.length; i++) {
      out.tick(); const row = breaks[i]!, endRow = breaks[i + 1]! - 1, cell = doc.cells.get(`${row}:${column}`);
      const style = sylkOutputStyle(doc.styleAt(row, column, cell), cell?.format), key = JSON.stringify(style);
      collect(style); const count = counts.get(key) ?? { count: 0, style }; count.count += endRow - row + 1; counts.set(key, count);
      bands.push({ row, endRow, key });
    }
    for (const count of counts.values()) { out.tick(); if (!most || count.count > most.count) most = count; }
    if (!most) continue;
    columnStyles.set(column, most.style); const common = JSON.stringify(most.style);
    for (const band of bands) { out.tick(); if (band.key === common) continue;
      r.startRow = Math.min(r.startRow, band.row); r.endRow = Math.max(r.endRow, band.endRow);
      r.startColumn = Math.min(r.startColumn, column); r.endColumn = Math.max(r.endColumn, column);
    }
  }
  // Empty positions can have styles absent from the cell table. Admit every
  // effective style before emitting the format/font tables that reference it.
  for (let row = r.startRow; row <= r.endRow; row++) for (let column = r.startColumn; column <= r.endColumn; column++) {
    out.tick(); const cell = doc.cells.get(`${row}:${column}`);
    collect(sylkOutputStyle(doc.styleAt(row, column, cell), cell?.format));
  }
  // Order represented style properties before format/font table enumeration.
  const sortedStyles = [...outputStyles.values()].sort((a, b) => {
    out.tick();
    const firstA = [...a.borders.map(Number), Number(a.stipple)], firstB = [...b.borders.map(Number), Number(b.stipple)];
    for (let i = 0; i < firstA.length; i++) if (firstA[i] !== firstB[i]) return firstA[i]! - firstB[i]!;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    for (const key of ["bold", "italic", "size"] as const) if (a[key] !== b[key]) return Number(a[key]) - Number(b[key]);
    if (a.format !== b.format) return a.format < b.format ? -1 : 1;
    return a.align - b.align;
  });
  for (const style of sortedStyles) { out.tick(formats.length + fonts.length + 1); if (!formats.includes(style.format)) formats.push(style.format);
    if (!fonts.some(f => f.name === style.name && f.size === style.size)) fonts.push({ name: style.name, size: style.size }); }
  function styleLine(style: Style): string {
    out.tick(formats.length + fonts.length + 1);
    const align: Record<number, string> = { 2: "L", 4: "R", 8: "C", 16: "X" };
    return "F" + (align[style.align] ? `;FD0${align[style.align]}` : "") + `;P${formats.indexOf(style.format)};SM${fonts.findIndex(f => f.name === style.name && f.size === style.size) + 1}` +
      (style.bold ? ";SD" : "") + (style.italic ? ";SI" : "") + (style.stipple ? ";SS" : "") + style.borders.map((b, i) => b ? `;S${"TBLR"[i]}` : "").join("");
  }
  out.put("ID;PGnumeric;N;E\r\n");
  for (const format of formats) out.put(`P;P${format}\r\n`);
  for (const font of fonts) out.put(`P;E${font.name};M${Math.floor(font.size * 20 + 0.5)}\r\n`);
  for (let column = r.startColumn; column <= r.endColumn; column++) out.put(`${styleLine(columnStyles.get(column)!)};C${column + 1}\r\n`);
  let currentRow = -1;
  // Native emits a style for every position in the content rectangle.
  for (let row = r.startRow; row <= r.endRow; row++) for (let column = r.startColumn; column <= r.endColumn; column++) {
    out.tick(); const cell = doc.cells.get(`${row}:${column}`), style = sylkOutputStyle(doc.styleAt(row, column, cell), cell?.format);
    out.put(styleLine(style) + (row !== currentRow ? `;Y${row + 1}` : "") + `;X${column + 1}\r\n`); currentRow = row;
  }
  for (const axis of sheet.columns ?? []) if (axis.index >= r.startColumn && axis.index <= r.endColumn && axis.sizePoints !== undefined && axis.sizePoints !== 48) out.put(`F;W${axis.index + 1} ${axis.index + 1} ${Math.floor(axis.sizePoints / 7.45 + 0.5)}\r\n`);
  for (const axis of sheet.rows ?? []) if (axis.index >= r.startRow && axis.index <= r.endRow && axis.sizePoints !== undefined && axis.sizePoints !== 12.75) out.put(`F;M${Math.floor(axis.sizePoints * 20 + 0.5)};R${axis.index + 1}\r\n`);
  out.put(`B;Y${r.endRow + 1};X${r.endColumn + 1};D0 0 ${r.endRow} ${r.endColumn}\r\n`);
  const iteration = book.iteration ?? { enabled: true, maximum: 100, tolerance: 0.001 };
  out.put(`O;${iteration.enabled ? "A" : "G"}${iteration.maximum} ${iteration.tolerance.toFixed(6)}${sheet.view?.referenceMode === "R1C1" ? "" : ";L"}${book.calculationMode === "manual" ? ";M" : ""};V${book.dateSystem === "1904" ? 4 : 0}${sheet.view?.hideZero ? ";Z" : ""}\r\n`);
  currentRow = -1;
  for (const cell of cells) {
    out.tick(); const v = cell.cachedResult ?? cell.value;
    if (v.kind === "blank") continue;
    let line = "C" + (cell.row !== currentRow ? `;Y${cell.row + 1}` : "") + `;X${cell.column + 1}`; currentRow = cell.row;
    if (v.kind === "string") line += `;K"${escaped(v.value)}"`;
    else line += ";K" + (v.kind === "number" ? gnumericNumber(v.value) : v.kind === "boolean" ? v.value ? "TRUE" : "FALSE" : v.value);
    const group = sheet.formulaGroups?.find(g => { out.tick(); return g.kind === "array" && cell.row >= g.range.startRow && cell.row <= g.range.endRow && cell.column >= g.range.startColumn && cell.column <= g.range.endColumn; });
    const follower = group && (cell.row !== group.range.startRow || cell.column !== group.range.startColumn);
    const formula = cell.formula ?? (group && !follower ? group.expression : undefined);
    if (follower) line += ";I";
    else if (formula) {
      const parsed = parseExpression(formula, { position: { sheet: sheet.name, row: cell.row, column: cell.column }, signal: context.signal,
        maximumNodes: context.limits.workbookNodes ?? context.limits.operations, maximumLength: context.limits.workbookTextBytes ?? context.limits.inputBytes });
      if (!parsed.ok) throw new SsconvertError("invalid-request", `Invalid SYLK formula: ${formula}`);
      line += (group ? `;R${group.range.endRow + 1};C${group.range.endColumn + 1};M` : ";E") + escaped(serializeExpression(parsed.document, writerGrammar, false, true).slice(1));
    }
    out.put(line + "\r\n");
  }
  out.put("E\r\n"); return out.finish();
}
