// Released Gnumeric 1.12.61 plugins/applix/applix-read.c (GPL-2.0-or-later).
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { AxisMetadata, Cell, FormulaGroup, ImportedValue, NamedExpression, Range, Workbook } from "../workbook.js";
import { formatA1 } from "../workbook.js";
import { legacyApplixGrammar, gnumericGrammar } from "../formulas/conventions.js";
import type { FormulaDocument } from "../formulas/ast.js";
import { quoteNativeSheet, serializeExpression } from "../formulas/serialization.js";
import { rewriteReferences } from "../formulas/rewriting.js";
import { recordInput, enteredRecord } from "./record-text.js";
import { asciiDigit, legacyCells, legacyCoordinate, legacyExpression, probeSignature } from "./legacy-records.js";

export function probeApplix(bytes: Uint8Array, context: CapabilityContext): boolean {
  return probeSignature(bytes, "*BEGIN SPREADSHEETS VERSION", context);
}

// Frozen reference Sans 10 metrics: 18 pixels / 12.75 points (sheet.c).
function pixelsToPoints(pixels: number, zoom: number): number {
  return Math.ceil(2 * pixels * 17 / 24 / zoom) / 2;
}

export async function readApplix(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  const input = recordInput(bytes, context, "Applix");
  let lineLength = 80, zoom = 100, readingCells = false;
  const errors: string[] = [], fonts: string[] = [], colors: string[] = [], renames = new Map<string, string>(), order: string[] = [];
  const names: NamedExpression[] = [];
  const expressions = new Map<string, FormulaDocument>();
  const attrs: { style: Record<string, ImportedValue>; format?: string }[] = [];
  const styleCache = new Map<string, { style: Record<string, ImportedValue>; format?: string }>();
  const sheets = new Map<string, { out: ReturnType<typeof legacyCells>; rows: AxisMetadata[]; columns: AxisMetadata[]; view: Record<string, ImportedValue>; groups: FormulaGroup[]; regions: { range: Range; style: Record<string, ImportedValue> }[] }>();
  let totalCells = 0, activeSheet: string | undefined, openCell = "";
  function sheet(name: string) {
    let s = sheets.get(name);
    if (!s) {
      if (sheets.size >= context.limits.sheets) throw new SsconvertError("resource-limit", "ssconvert Applix sheets limit exceeded");
      s = { out: legacyCells(context, "Applix"), rows: [], columns: [], view: { zoom: zoom / 100 }, groups: [], regions: [] }; sheets.set(name, s);
    }
    return s;
  }
  function put(name: string, cell: Cell) {
    const s = sheet(name);
    if (!s.out.cells.has(`${cell.row}:${cell.column}`) && ++totalCells > context.limits.cells)
      throw new SsconvertError("resource-limit", "ssconvert Applix cells limit exceeded");
    s.out.put(cell);
  }
  async function next(): Promise<string | undefined> {
    let line = await input.next();
    if (line === undefined) return undefined;
    let source = line.slice(0, lineLength);
    while (line.length >= lineLength) {
      line = await input.next(); if (line === undefined) break;
      source += line.slice(1, lineLength);
    }
    if (!source) return undefined;
    let result = "";
    for (let at = 0; at < source.length; at++) {
      if (source[at] !== "^") result += source[at];
      else if (source[at + 1] === "^") { result += "^"; at++; }
      else if (!source[at + 1] || !source[at + 2]) { errors.push("Missing characters for character encoding"); result += "^"; }
      else {
        const hi = source.charCodeAt(at + 1) - 97, lo = source.charCodeAt(at + 2) - 97;
        if (hi < 0 || hi > 15 || lo < 0 || lo > 15) { errors.push(`Invalid characters for encoding '${source.slice(at + 1, at + 3)}'`); result += "^"; }
        else { result += String.fromCharCode(hi * 16 + lo); at += 2; }
      }
    }
    const nul = result.indexOf("\0"); return nul < 0 ? result : result.slice(0, nul);
  }
  function style(source: string) {
    let at = 0;
    const locked = source[at] === "P"; if (locked) at++;
    const hidden = source[at] === "I"; if (hidden) at++;
    if (locked || hidden) {
      if (source[at++] !== " ") { errors.push("Invalid format, protection problem"); return undefined; }
    }
    if (source[at] !== "(") { errors.push("Invalid format, missing '('"); return undefined; }
    const close = source.indexOf(")", at);
    if (close < 0 || source[close + 1] !== " ") { errors.push("Invalid format, missing ')'"); return undefined; }
    const string = source[1] === "'";
    const key = source.slice(at, close + 1), cached = styleCache.get(key);
    if (cached) return { string, style: cached.style, format: cached.format, end: close + 2 };
    const sections = source.slice(at + 1, close).split("|");
    if (sections.length < 2) { errors.push("Invalid font specification"); return undefined; }
    let spec = sections[0]!; if (spec.startsWith("'")) spec = spec.slice(1);
    const result: Record<string, ImportedValue> = { Locked: locked, Hidden: hidden };
    let format: string | undefined;
    const dates = ["mmmm d, yyyy", "mmm d, yyyy", "d mmm yy", "mm/dd/yy", "dd.mm.yy", "yyyy-mm-dd", "yy-mm-dd", "yyyy mm dd", "yy mm dd", "yyyymmdd", "yymmdd", "dd/mm/yy", "dd.mm.yyyy", "mmm dd, yyyy", "mmmm yyyy", "mmm.yyyy"];
    for (let i = 0; i < spec.length;) {
      const c = spec[i++]!;
      if (c === ",") continue;
      if ("1234".includes(c)) result.HAlign = [2, 4, 8, 16][Number(c) - 1]!;
      else if (c === "V") { result.VAlign = ({ T: 1, C: 2, B: 4 } as Record<string, number>)[spec[i++]!] ?? 4; break; }
      else if (c === "D") {
        if (spec[i] === "N") { i++; continue; }
        const start = i; while (asciiDigit(spec[i])) i++;
        format = dates[Number(spec.slice(start, i)) - 1];
        if (!format) { errors.push(`Unknown format ${Number(spec.slice(start, i))}`); return undefined; }
      } else if (c === "T") {
        format = ["hh:mm:ss AM/PM", "hh:mm AM/PM", "hh:mm:ss", "hh:mm"][Number(spec[i++])];
        if (!format) { errors.push(`Unknown time format '${spec[i - 1]}'`); return undefined; }
      } else if (c === "G") { format = "General"; if (spec[i] === "f") i++; else while (asciiDigit(spec[i])) i++; }
      else if (c === "B" && spec[i] === "0") i++;
      else if ("CSPF".includes(c)) {
        const comma = c === "C" && spec[i] === "O"; if (comma) i++;
        const marker = spec[i++], p = asciiDigit(marker) ? Number(marker) : 2;
        format = (c === "C" ? comma ? "#,##0" : "$ #,##0" : "0") + (p ? "." + "0".repeat(p) : "") + (c === "S" ? "E+00" : c === "P" ? "%" : "");
      } else { errors.push(`Unknown format '${c}'`); return undefined; }
    }
    const font: Record<string, ImportedValue> = {};
    for (const token of (sections[1] ?? "").split(",")) {
      let i = 0;
      while (i < token.length) {
        const c = token[i++]!;
        if (c === "B") font.Bold = 1;
        else if (c === "I") font.Italic = 1;
        else if (c === "U" || c === "D") font.Underline = c === "U" ? 1 : 2;
        else if (c === "P") { const n = parseFloat(token.slice(i)); if (!(n > 0)) { errors.push(`Invalid font size '${token.slice(i)}'`); return undefined; } font.Unit = n * 0.75; while (asciiDigit(token[i]) || token[i] === ".") i++; }
        else if (c === "F" && token[i] === "G") { i++; const start = i; while (asciiDigit(token[i])) i++; result.Fore = colors[Number(token.slice(start, i))] ?? "FF000000"; }
        else if (c === "T" && token[i] === "F") { i++; const start = i; while (asciiDigit(token[i])) i++; const id = Number(token.slice(start, i)); if (fonts[id]) font.Name = fonts[id]!; else errors.push(`Unknown font index ${token.slice(start)}`); }
        else if (c === "W" && token[i] === "T") { i++; if (token[i] === "O") i++; else result.WrapText = true; }
        else if (c === "f" && token[i] === "g") i++;
        else { errors.push(`Unknown font modifier ${c}`); return undefined; }
      }
    }
    if (!font.Name && fonts[0]) font.Name = fonts[0]!;
    if (Object.keys(font).length) result.Font = font;
    const borders: Record<string, ImportedValue> = {};
    for (const token of (sections[2] ?? "").split(",").filter(Boolean)) {
      let i = 0;
      function number() { const start = i; while (asciiDigit(token[i])) i++; return start === i ? undefined : Number(token.slice(start, i)); }
      function color() { i += 2; return colors[number() ?? -1] ?? "FF000000"; }
      if (token.startsWith("SH")) {
        i = 2; const n = number(), patterns = [0, 1, 6, 5, 4, 3, 2, 24, 24, 14, 13, 17, 16, 15, 11, 19, 20, 21, 22, 23];
        if (!n || !patterns[n]) { errors.push(`Unknown pattern ${token.slice(2)}`); return undefined; }
        result.Shade = patterns[n]!;
        if (token.slice(i, i + 2) === "FG") result.PatternColor = color();
        if (token.slice(i, i + 2) === "BG") result.Back = color();
      } else {
        const side = ({ T: "Top", B: "Bottom", L: "Left", R: "Right" } as Record<string, string>)[token[i++]!];
        const n = number();
        if (!side || !n || n > 5) { errors.push(`Unknown border style ${token.slice(1)}`); return undefined; }
        borders[side] = { Style: [0, 1, 2, 5, 3, 6][n]!, Color: token.slice(i, i + 2) === "FG" ? color() : "FF000000" };
      }
      if (i !== token.length) { errors.push("Invalid pattern, background, or border"); return undefined; }
    }
    if (Object.keys(borders).length) result.StyleBorder = borders;
    styleCache.set(key, { style: result, ...(format ? { format } : {}) });
    return { string, style: result, format, end: close + 2 };
  }
  function ref(source: string, separator: string) {
    const sep = source.indexOf(separator); if (sep < 0) return undefined;
    const name = source.slice(0, sep), pos = legacyCoordinate(source.slice(sep + 1), 1);
    if (!pos || pos.column >= 702 || pos.row >= 65536) return undefined;
    sheet(name); return { name, row: pos.row, column: pos.column, end: sep + 1 + pos.end };
  }
  function valueCell(text: string, string: boolean, row: number, column: number): Cell {
    if (string || !text || text.startsWith("'") || text.startsWith("=")) return { row, column, value: { kind: "string", value: text } };
    return enteredRecord(text, row, column, context);
  }
  for (let line; (line = await next()) !== undefined;) {
    if (line.startsWith("*END SPREADSHEETS")) break;
    if (!readingCells) {
      if (line.startsWith("*BEGIN SPREADSHEETS VERSION=")) {
        const parts = line.slice(28).split(" ENCODING="), version = parts[0]?.split("/");
        if (!version || version.length !== 2 || !Number.isFinite(Number(version[0])) || !Number.isFinite(Number(version[1])) || parts.length !== 2) { errors.push("Invalid header "); break; }
        if (Number(version[0]) < 400) { errors.push("Versions < 4.0 are not supported"); break; }
        if (parts[1] !== "7BIT") { errors.push("We only have samples of '7BIT' encoding, please send us this sample."); break; }
      } else if (line.startsWith("Spreadsheet Dump Rev")) {
        const len = parseInt(line.slice(line.indexOf("Line Length ") + 12), 10);
        if (!(len >= 0 && len <= 65535)) { errors.push("Invalid line length"); break; } lineLength = len;
      } else if (line.startsWith("Percent Zoom Factor:")) {
        zoom = parseInt(line.slice(20), 10); if (!(zoom > 10 && zoom < 500)) { errors.push("invalid zoom"); break; }
      } else if (line === "COLORMAP") {
        for (let entry; (entry = await next()) !== undefined && !entry.startsWith("END COLORMAP");) {
          const fields: number[] = [];
          let pos = entry.length - 1;
          if (entry[pos] === " ") for (let count = 0; count < 6; count++) {
            let iter = pos;
            while (--iter > 0 && asciiDigit(entry[iter])) { /* Native scans backward from the terminal space. */ }
            if (iter <= 0 || entry[iter] !== " " || iter + 1 === pos) break;
            fields.unshift(Number(entry.slice(iter + 1, pos))); pos = iter;
          }
          if (fields.length !== 6 || fields.some(n => !Number.isInteger(n) || n < 0 || n > 255) || fields[0] !== 0 || fields[5] !== 0) { errors.push("invalid colormap"); break; }
          colors.push("FF" + fields.slice(1, 4).map(n => (255 - Math.min(255, n + fields[4]!)).toString(16).padStart(2, "0").toUpperCase()).join(""));
        }
      } else if (line.startsWith("Relative Named Range, Name:")) {
        const first = line.indexOf("."), last = line.indexOf(".", first + 1);
        const fields = Object.fromEntries(line.slice(last + 1).trim().split(" ").filter(Boolean).join(" ").split(" ").filter(s => s.includes(":")).map(s => s.split(":")));
        // bSheet has a space after ':' in native syntax; sheet indices are ignored.
        const values = ["tCol", "tRow", "bCol", "bRow", "tColAbs", "tRowAbs", "bColAbs", "bRowAbs"].map(k => Number(fields[k]));
        if (first < 0 || last < 0 || values.some(n => !Number.isInteger(n))) { errors.push("Relative named range"); break; }
        const [tc, tr, bc, br, tca, tra, bca, bra] = values as [number, number, number, number, number, number, number, number];
        const position = { sheet: "", row: Math.max(-tr, 0), column: Math.max(-tc, 0) };
        const endpoint = (col: number, row: number, ca: number, ra: number) => ({ column: { value: col, relative: ca === 0 }, row: { value: row, relative: ra === 0 } });
        const a = endpoint(tc, tr, tca, tra), b = endpoint(bc, br, bca, bra);
        names.push({ name: line.slice(first + 1, last), expression: serializeExpression({ source: "", grammar: gnumericGrammar, position,
          root: { kind: "reference", start: 0, end: 0, first: a, ...(tc !== bc || tr !== br || tca !== bca || tra !== bra ? { last: b } : {}) } }, gnumericGrammar, false, true),
          position: { ...position, sheet: activeSheet ?? [...sheets.keys()][0] ?? "A" } });
      } else if (line.startsWith("Named Range, Name:")) {
        const first = line.indexOf("."), last = line.indexOf(".", first + 1), sep = line.indexOf(":", last);
        const parsed = sep < 0 ? undefined : legacyExpression(line.slice(sep + 2), legacyApplixGrammar, { sheet: "", row: 0, column: 0 }, context);
        if (!parsed?.ok || parsed.document.root.kind !== "reference") { errors.push("Absolute named range"); break; }
        const root = parsed.document.root;
        const absolute = (endpoint: typeof root.first) => ({ ...endpoint, ...(endpoint.row ? { row: { ...endpoint.row, relative: false } } : {}), ...(endpoint.column ? { column: { ...endpoint.column, relative: false } } : {}) });
        names.push({ name: line.slice(first + 1, last), expression: serializeExpression({ ...parsed.document, root: { ...root, first: absolute(root.first), ...(root.last ? { last: absolute(root.last) } : {}) } }, { ...gnumericGrammar, quoteSheetName: quoteNativeSheet }, false, true) });
      } else if (line === "TYPEFACE TABLE") {
        for (let entry; (entry = await next()) !== undefined && !entry.startsWith("END TYPEFACE TABLE");) fonts.push(entry);
      } else if (line === "Attr Table Start") {
        let count = 0;
        for (let entry; (entry = await next()) !== undefined && !entry.startsWith("Attr Table End");) {
          if (!entry.startsWith("<")) { errors.push("Invalid attribute"); break; }
          if (count++) {
            const fmt = style(entry.slice(1).split(">")[0]! + " ");
            if (!fmt) break;
            attrs.push({ style: fmt.style, ...(fmt.format ? { format: fmt.format } : {}) });
          }
        }
      } else if (line.startsWith("Row List")) {
        const source = line.slice(9), sep = source.indexOf(" "), bang = source.indexOf("!", sep), colon = source.indexOf(":", bang);
        const row = Number(source.slice(bang + 1, colon)) - 1;
        if (sep < 0 || bang !== sep + 1 || row < 0 || !Number.isInteger(row)) { errors.push("Invalid row format"); break; }
        const s = sheet(source.slice(0, sep));
        for (const token of source.slice(colon + 1).trim().split(" ").filter(Boolean)) {
          const dash = token.indexOf("-"), c = token.indexOf(":"), from = Number(token.slice(0, dash)), to = Number(token.slice(dash + 1, c)), id = Number(token.slice(c + 1));
          if (id === 1) continue;
          const attr = attrs[id - 2];
          if (!attr || from < 0 || to < 0 || from > to || to >= 1024 || row >= 65536) { errors.push("Invalid row format attr index"); break; }
          s.regions.push({ range: { startRow: row, endRow: row, startColumn: from, endColumn: to }, style: { ...attr.style, ...(attr.format ? { Format: attr.format } : {}) } });
        }
      } else if (line.startsWith("Headers And Footers") || line.startsWith("View, Name: ~Current~")) {
        const end = line.startsWith("Headers") ? "Headers And Footers End" : "End View, Name: ~Current~";
        for (let entry; (entry = await next()) !== undefined && !entry.startsWith(end);) { /* Native ignores header/footer and current view bodies. */ }
        if (line.startsWith("Headers")) readingCells = true;
      } else if (line.startsWith("SHEETS TABLE")) {
        for (let entry; (entry = await next()) !== undefined && !entry.startsWith("END SHEETS TABLE");) {
          const sep = entry.indexOf(": ~"), close = entry.indexOf("~", sep + 3);
          if (sep >= 6 && close >= 0) renames.set(entry.slice(6, sep), entry.slice(sep + 3, close));
        }
      } else if (line.startsWith("View Start, Name: ~")) {
        const sep = line.indexOf(":", 19), name = line.slice(19, sep), visible = sep >= 0 && line[sep + 1] === "~";
        const s = visible ? sheet(name) : undefined; if (s) order.push(name);
        for (let entry; (entry = await next()) !== undefined && !entry.startsWith("View End, Name: ~");) {
          if (!s) continue;
          if (entry.startsWith("View Top Left: ") || entry.startsWith("View Open Cell: ")) {
            const pos = ref(entry.slice(entry.startsWith("View Top") ? 15 : 16), ":");
            if (pos) s.view[entry.startsWith("View Top") ? "topLeft" : "selection"] = { row: pos.row, column: pos.column };
          } else if (entry.startsWith("View Row Heights: ") || entry.startsWith("View Column Widths: ")) {
            const rows = entry.startsWith("View Row"), values = entry.slice(rows ? 18 : 20).split(" ").filter(Boolean);
            for (const value of values) {
              const [index, raw] = value.split(":"), n = parseInt(raw ?? "", 10);
              const idx = rows ? Number(index) - 1 : legacyCoordinate(index + "1", 1)?.column;
              if (idx === undefined || idx < 0 || !(n > 0)) { errors.push(rows ? "Invalid row size" : "Invalid column size"); break; }
              (rows ? s.rows : s.columns).push({ index: idx, sizePoints: pixelsToPoints(rows ? (n >= 32768 ? n - 32768 : n) + 4 : 8 * n + 3, Number(s.view.zoom)),
                style: { gnumeric: { name: rows ? "RowInfo" : "ColInfo", namespace: "http://www.gnumeric.org/v10.dtd", text: "", children: [], attributes: [{ name: "HardSize", namespace: "", value: "1" }] } } });
            }
          } else if (entry.startsWith("View Default Column Width ") || entry.startsWith("View Default Row Height: ")) {
            const rows = entry.startsWith("View Default Row"), n = parseInt(entry.slice(rows ? 25 : 26), 10);
            if (n > 0) s.view[rows ? "defaultRowSizePoints" : "defaultColumnSizePoints"] = pixelsToPoints(rows ? n + 4 : 8 * n + 3, Number(s.view.zoom));
            else errors.push(rows ? "Invalid default row height" : "Invalid default column width");
          }
        }
      } else if (line.startsWith("Open Cell:")) {
        const source = line.slice(10).trimStart();
        let end = 0; while (source[end] !== undefined && !" \t\r\n\v\f".includes(source[end]!)) end++;
        if (!end) { errors.push("invalid cur cell"); break; }
        openCell = source.slice(0, Math.min(end, 25));
      }
      // Unknown header records are ignored by the native reader.
      continue;
    }
    const fmt = style(line); if (!fmt) break;
    const source = line.slice(fmt.end), target = ref(source, "!");
    if (!target) { errors.push("Expression did not specify target cell"); break; }
    const type = source[target.end], text = source.slice(target.end + 2);
    let cell: Cell = { row: target.row, column: target.column, value: { kind: "blank" }, style: fmt.style, ...(fmt.format ? { format: fmt.format } : {}) };
    if (type === ":") {
      const entered = valueCell(text, fmt.string, target.row, target.column);
      cell = { ...cell, value: entered.value, style: { ...cell.style, ...entered.style } };
      const old = sheet(target.name).out.cells.get(`${target.row}:${target.column}`);
      if (old?.formulaGroup) cell = { ...cell, formula: old.formula!, formulaGroup: old.formulaGroup, cachedResult: entered.value, formulaDirty: false };
    } else if (type === ";" || type === ".") {
      let value = "", expression = "";
      if (text.startsWith('"')) {
        let i = 1;
        while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; value = text[i++] ?? ""; }
        // Released applix_parse_value overwrites its first destination byte without advancing it.
        value += text.slice(2, i);
        if (text[i] !== '"') { errors.push("Invalid quoted value"); break; } expression = text.slice(i + 3);
      } else { const sep = text.indexOf(" "); if (sep < 0) { errors.push("Invalid value"); break; } value = text.slice(0, sep); expression = text.slice(sep + 2); }
      const entered = valueCell(value, fmt.string, target.row, target.column);
      cell = { ...cell, value: entered.value, style: { ...cell.style, ...entered.style } };
      if (type === ";") {
        let array: { name: string; range: Range } | undefined;
        if (expression.startsWith("~")) {
          const start = ref(expression.slice(1), ":"), dots = start ? start.end + 1 : -1;
          const end = dots < 0 || expression.slice(dots, dots + 2) !== ".." ? undefined : ref(expression.slice(dots + 2), ":");
          const close = end ? dots + 2 + end.end : -1;
          if (!start || !end || expression[close] !== "~") { errors.push("Invalid array expression"); continue; }
          if (start.name !== end.name) { errors.push("3D array functions are not supported."); continue; }
          array = { name: start.name, range: { startRow: start.row, endRow: end.row, startColumn: start.column, endColumn: end.column } };
          expression = expression.slice(close + 3);
        }
        if (!expression.startsWith("=") && !expression.startsWith("+")) errors.push(`Expression did not start with '=' ? '${expression}'`);
        const parsed = legacyExpression(expression.startsWith("+") ? expression.slice(1) : expression, legacyApplixGrammar,
          { sheet: target.name, row: target.row, column: target.column }, context);
        if (parsed.ok) {
          cell = { ...cell, formula: parsed.formula, cachedResult: cell.value, formulaDirty: false };
          if (array) {
            const count = (array.range.endRow - array.range.startRow + 1) * (array.range.endColumn - array.range.startColumn + 1);
            if (!Number.isSafeInteger(count) || count < 1 || count > context.limits.cells - totalCells)
              throw new SsconvertError("resource-limit", "ssconvert Applix array cells limit exceeded");
            const s = sheet(array.name), id = `array-${input.line}`;
            s.groups.push({ id, kind: "array", range: array.range, expression: parsed.formula });
            for (let row = array.range.startRow; row <= array.range.endRow; row++) for (let column = array.range.startColumn; column <= array.range.endColumn; column++)
              put(array.name, { row, column, formula: parsed.formula, formulaGroup: id, value: { kind: "blank" }, formulaDirty: false });
            cell = { ...cell, formulaGroup: id };
          }
          const id = await next();
          if (!id?.startsWith("Formula: ")) errors.push("Missing formula ID");
          else expressions.set(id.slice(9), parsed.document);
        } else { errors.push(`${target.name}!${source.slice(target.name.length + 1, target.end)} : unable to parse '${expression}'\n     ${parsed.diagnostic.message}`); await next(); }
      } else {
        const id = expression.slice(expression.lastIndexOf(" ") + 1), document = expressions.get(id);
        if (document) cell = { ...cell, formula: serializeExpression({ ...document, position: { sheet: target.name, row: target.row, column: target.column } },
          { ...gnumericGrammar, quoteSheetName: quoteNativeSheet }, false, true), cachedResult: cell.value, formulaDirty: false };
        else {
          // A missing native texpr makes gnm_cell_set_expr_and_value a no-op;
          // formatting has already been applied, but the supplied cache is not assigned.
          await context.diagnostic?.({ code: "applix-shared-expression", severity: "warning",
            message: "gnm_cell_set_expr_and_value: assertion 'texpr != NULL' failed" });
          const old = sheet(target.name).out.cells.get(`${target.row}:${target.column}`);
          cell = { ...(old ?? { row: target.row, column: target.column, value: { kind: "blank" } }),
            style: fmt.style, ...(fmt.format ? { format: fmt.format } : {}) };
        }
      }
    } else await context.diagnostic?.({ code: "applix-cell", severity: "warning", message: `Unknown cell type '${type}'` });
    put(target.name, cell);
  }
  if (!errors.length) {
    const separator = openCell.indexOf(":");
    if (separator < 0) errors.push("Invalid sheet name.");
    else { const pos = ref(openCell, ":"); if (pos) activeSheet = pos.name; else sheet(openCell.slice(0, separator)); }
  }
  if (errors.length) throw new SsconvertError("io", `E Parse error while reading Applix file.\n${errors.map(e => `  E ${e}`).join("\n")}`);
  const ids = [...new Set([...order, ...sheets.keys()])];
  function rename(formula: string, id: string, row: number, column: number) {
    const parsed = legacyExpression(formula, { ...gnumericGrammar, quoteSheetName: quoteNativeSheet }, { sheet: id, row, column }, context);
    return parsed.ok ? rewriteReferences(parsed.document, { sheets: renames, signal: context.signal }) : formula;
  }
  function node(name: string, style: Record<string, ImportedValue>, children: ImportedValue[] = [], text = ""): ImportedValue {
    return { name, namespace: "http://www.gnumeric.org/v10.dtd", text, children, attributes: Object.entries(style).map(([name, value]) => {
      let text = typeof value === "boolean" ? String(Number(value)) : String(value);
      if (["Fore", "Back", "PatternColor", "Color"].includes(name) && text.length === 8 && [...text].every(c => "0123456789ABCDEF".includes(c)))
        text = [text.slice(2, 4), text.slice(4, 6), text.slice(6, 8)].map(s => (parseInt(s, 16) * 257).toString(16).toUpperCase()).join(":");
      return { name, namespace: "", value: text };
    }) };
  }
  function styleNode(style: Readonly<Record<string, ImportedValue>>): ImportedValue {
    const font = style.Font as Record<string, ImportedValue> | undefined, borders = style.StyleBorder as Record<string, ImportedValue> | undefined;
    return node("Style", Object.fromEntries(Object.entries(style).filter(([key]) => key !== "Font" && key !== "StyleBorder" && key !== "gnumericValueFormat")), [
      ...(font ? [node("Font", Object.fromEntries(Object.entries(font).filter(([key]) => key !== "Name")), [], String(font.Name ?? "Sans"))] : []),
      ...(borders ? [node("StyleBorder", {}, Object.entries(borders).map(([side, value]) => node(side, value as Record<string, ImportedValue>)))] : [])
    ]);
  }
  return { sheets: ids.map(id => {
    const s = sheets.get(id)!;
    const retained = [];
    if (s.regions.length) retained.push({ source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained" as const, data: node("Styles", {}, s.regions.map(r => node("StyleRegion",
      { startRow: r.range.startRow, endRow: r.range.endRow, startCol: r.range.startColumn, endCol: r.range.endColumn }, [styleNode(r.style)]))) });
    for (const [kind, key] of [["Cols", "defaultColumnSizePoints"], ["Rows", "defaultRowSizePoints"]])
      if (s.view[key!] !== undefined) retained.push({ source: "Gnumeric_XmlIO:sax", kind: kind!, disposition: "retained" as const, data: node(kind!, { DefaultSizePts: s.view[key!]! }) });
    const selection = s.view.selection as { row: number; column: number } | undefined;
    if (selection) retained.push({ source: "Gnumeric_XmlIO:sax", kind: "Selections", disposition: "retained" as const,
      data: node("Selections", { CursorCol: selection.column, CursorRow: selection.row }, [node("Selection", {
        startCol: selection.column, endCol: selection.column, startRow: selection.row, endRow: selection.row })]) });
    const topLeft = s.view.topLeft as { row: number; column: number } | undefined;
    if (topLeft) retained.push({ source: "Gnumeric_XmlIO:sax", kind: "SheetLayout", disposition: "retained" as const, data: node("SheetLayout", { TopLeft: formatA1(topLeft.row, topLeft.column) }) });
    return { id, name: renames.get(id) ?? id, size: { rows: 65536, columns: 1024 },
    cells: s.out.finish().map(c => ({ ...c, ...(c.formula ? { formula: rename(c.formula, id, c.row, c.column) } : {}),
      ...(c.style ? { style: { ...c.style, gnumeric: styleNode(c.style) } } : {}) })), rows: s.rows, columns: s.columns, view: s.view,
    ...(s.groups.length ? { formulaGroups: s.groups.map(g => ({ ...g, expression: rename(g.expression, id, g.range.startRow, g.range.startColumn) })) } : {}),
    ...(retained.length ? { unsupportedRecords: retained } : {}) }; }),
    ...(activeSheet ?? ids[0] ? { activeSheet: activeSheet ?? ids[0]! } : {}), names: names.map(n => ({ ...n, expression: rename(n.expression, "", 0, 0) })) };
}
