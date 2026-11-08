import type { Codec } from "./types.js";
import { parseFormatSections, selectFormatSection } from "../formatting/sections.js";
import { scanFormat } from "../formatting/numeric.js";
import { formattingLocale } from "../formatting/locale.js";
import type { FormatHost } from "../formatting/number-format.js";
import { renderCellText } from "../formatting.js";
import { SsconvertError } from "../contracts.js";
import { formatA1, type Cell } from "../workbook.js";
import { documentOutput, documentSheet, documentFont } from "./document-export.js";
import { latexBorders } from "./latex-borders.js";
import { latexHeader, latexFragmentHeader, latexWidthSetup, latexTableOptions, latexEnd } from "./latex-syntax.js";

/** Native default is Latin-1 with '?' fallback and U+2212 converted to '-'. */
function latexEscape(text: string, tick: (amount?: number) => void, math = false): string {
  let latin = "", result = "";
  for (const c of text) { tick(); if (c === "\0") break; latin += c === "−" ? "-" : c.codePointAt(0)! > 255 ? "?" : c; }
  for (let at = 0; at < latin.length; at++) {
    tick(); const c = latin[at]!;
    if (c === "\\" && latin.slice(at + 1, at + 3).toLowerCase() === "l{") {
      let depth = 1, end = at + 3;
      for (; end < latin.length; end++) { tick(); if (latin[end] === "{") depth++; else if (latin[end] === "}" && --depth === 0) break; }
      if (!depth) { result += latin.slice(at + 3, end); at = end; continue; }
    }
    result += (math ? "$&%#" : "$&%#_{}").includes(c) ? "\\" + c : c === "~" || c === "^" && !math ? `\\${c}{ }` : c === "\\" ? "$\\backslash$" : !math && "<>".includes(c) ? `$${c}$` : c;
  }
  return result;
}
function columnName(column: number): string { return formatA1(0, column).slice(0, -1); }

export function createLatexWriter(profile: { readonly fragment?: boolean; readonly visibleRows?: boolean }): NonNullable<Codec["write"]> {
  return async (book, _options, context, selection) => {
    const out = documentOutput(context, "LaTeX", true);
    if (book.sheets.length > context.limits.sheets) throw new SsconvertError("resource-limit", "ssconvert document sheets limit exceeded");
    const id = selection?.sheets[0] ?? book.activeSheet;
    const sheet = book.sheets.find(s => s.id === id || s.name === id) ?? book.sheets[0];
    if (!sheet) throw new SsconvertError("invalid-request", "No sheet to export");
    const { cells, extent: r, styleAt, records } = documentSheet(sheet, context, out.tick, true, selection?.range);
    const width = (col: number) => { for (const axis of sheet.columns ?? []) { out.tick(); if (axis.index === col && axis.sizePoints !== undefined) return axis.sizePoints; } return 48; };
    if (profile.fragment) out.put(latexFragmentHeader);
    else {
      const landscape = records.get("PrintInformation")?.some(n => n.name === "orientation" && n.text.toLowerCase().includes("landscape"));
      out.put(landscape ? latexHeader.split("%,landscape%").join(",landscape%") : latexHeader);
      out.put("\\setlength\\gnumericTableWidth{%\n");
      for (let col = r.startColumn; col <= r.endColumn; col++) out.put(`\t${width(col).toFixed(1)}pt+%\n`);
      const count = r.endColumn - r.startColumn + 1;
      out.put(`0pt}\n\\def\\gumericNumCols{${count}}\n`);
      out.put(latexWidthSetup);
      for (let col = r.startColumn; col <= r.endColumn; col++) {
        const n = columnName(col); out.put(`\\ifthenelse{\\isundefined{\\gnumericCol${n}}}{\\newlength{\\gnumericCol${n}}}{}\\settowidth{\\gnumericCol${n}}{\\begin{tabular}{@{}p{${width(col).toFixed(1)}pt*\\gnumericScale}@{}}x\\end{tabular}}\n`);
      }
      out.put("\n\\begin{longtable}[c]{%\n");
      for (let col = r.startColumn; col <= r.endColumn; col++) out.put(`\tb{\\gnumericCol${columnName(col)}}%\n`);
      out.put("\t}\n\n");
      let options = latexTableOptions;
      for (const align of ["c", "l", "r"]) options = options.split(`\\multicolumn{1}{${align}}`).join(`\\multicolumn{${count}}{${align}}`);
      // Column tag rows always span one column, independently of the table width.
      options = options.split(`\\multicolumn{${count}}{c}{colTag}`).join("\\multicolumn{1}{c}{colTag}");
      let middle = "";
      for (let col = 2; col < count; col++) { out.tick(); middle += `%\t&\\multicolumn{1}{c}{colTag}\t%Column ${col}\n`; }
      options = options.split("%\t&\\multicolumn{1}{c}{colTag}\t\\\\").join(middle + "%\t&\\multicolumn{1}{c}{colTag}\t\\\\");
      out.put(options);
    }
    async function content(cell: Cell, row: number, col: number): Promise<string> {
      const style = styleAt(row, col, cell), a = style?.attributes ?? {}, font = documentFont(style), f = font.attributes;
      const rendered = await renderCellText(cell, book, context, "preserve");
      const text = latexEscape(rendered, out.tick);
      if (profile.fragment) return Number(a.Hidden ?? 0) ? "" : text;
      const value = cell.cachedResult ?? cell.value;
      const alignment = Number(a.HAlign ?? 1);
      const align = alignment === 1 ? value.kind === "number" ? "r" : value.kind === "boolean" || value.kind === "error" ? "c" : "l" : alignment === 4 ? "r" : [8, 64, 128].includes(alignment) ? "c" : alignment === 2 ? "l" : alignment === 32 ? "s" : "";
      let result = align && align !== "s" ? `\\gnumericPB{\\${align === "r" ? "raggedleft" : align === "c" ? "centering" : "raggedright"}}` : "";
      const wrap = Number(a.WrapText ?? 0);
      if (!wrap) result += align ? `\\gnumbox${align === "c" ? "" : `[${align}]`}{` : "\\makebox{";
      const closings: string[] = [];
      function tag(open: string) { result += open; closings.unshift("}"); }
      const fore = a.Fore?.split(":").map(c => parseInt(c, 16) >>> 8);
      if (fore?.length === 3 && fore.some(c => c !== 0)) tag(`{\\color[rgb]{${fore.map(c => (c / 255).toFixed(2)).join(",")}} `);
      if (Number(a.Hidden ?? 0)) tag("\\phantom{");
      if (font.mono) tag("\\texttt{"); else if (font.sans) tag("\\textsf{");
      if (Number(f.Bold ?? 0)) tag("\\textbf{");
      if (Number(f.Italic ?? 0)) tag("\\textit{");
      const format = cell.format ?? a.Format ?? "General";
      const host: FormatHost = { context, book, locale: formattingLocale(context.environment.locale), tick: out.tick };
      const sections = parseFormatSections(format, host);
      const section = value.kind === "number" ? selectFormatSection(sections, value.value).section : sections[0]!;
      const tokens = scanFormat(section.pattern, host).filter(t => !t.literal).map(t => t.text.toLowerCase()).join("");
      const numeric = [...tokens].some(c => "0#?".includes(c)) && ![...tokens].some(c => "ymdhs".includes(c));
      if (numeric) result += "$" + (Number(f.Italic ?? 0) ? "\\gnumericmathit{" : "") + latexEscape(rendered, out.tick, true) + (Number(f.Italic ?? 0) ? "}" : "") + "$";
      else result += text;
      result += closings.join("") + (wrap ? "" : "}");
      return result;
    }
    const borders = latexBorders((row, col) => styleAt(row, col, cells.get(`${row}:${col}`)), sheet.merges ?? [], out.tick);
    let previousVertical: number[] | undefined;
    for (let row = r.startRow; row <= r.endRow; row++) {
      out.tick();
      if (profile.visibleRows && sheet.rows?.some(a => { out.tick(); return a.index === row && a.hidden; })) continue;
      const vertical = profile.fragment ? [] : borders.rowVertical(row, r.startColumn, r.endColumn);
      if (!profile.fragment) {
        const horizontal = borders.rowHorizontal(row, r.startColumn, r.endColumn, row > r.startRow);
        if (horizontal.present) out.put(borders.hhline(horizontal.lines, previousVertical, vertical));
      }
      for (let col = r.startColumn; col <= r.endColumn; col++) {
        out.tick(); out.put(col === r.startColumn ? profile.fragment ? "" : "\t " : "\t&");
        const cell = cells.get(`${row}:${col}`), v = cell?.cachedResult ?? cell?.value;
        const empty = !v || v.kind === "blank" || v.kind === "string" && !v.value;
        if (profile.fragment) { if (!empty) out.put(await content(cell!, row, col)); continue; }
        const merge = sheet.merges?.find(m => { out.tick(); return m.startRow === row && m.startColumn === col; });
        const cols = merge ? merge.endColumn - col + 1 : 1, rows = merge ? merge.endRow - row + 1 : 1;
        const left = col === r.startColumn ? vertical[0]! : 0, right = vertical[col - r.startColumn + cols]!;
        const multicolumn = cols > 1 || left !== 0 || right !== 0;
        if (multicolumn) {
          out.put(`\\multicolumn{${cols}}{`);
          out.put(borders.verticalSyntax(left));
          if (cols === 1) out.put(`p{\\gnumericCol${columnName(col)}}`);
          else if (rows > 1) out.put("c");
          else { out.put("p{"); for (let i = 0; i < cols; i++) out.put(`\t\\gnumericCol${columnName(col + i)}+%\n`); out.put(`\t\\tabcolsep*2*${cols - 1}}`); }
          out.put(borders.verticalSyntax(right));
          out.put("}%\n\t{");
        }
        if (rows > 1) {
          out.put("\\setlength{\\gnumericMultiRowLength}{0pt}%\n");
          for (let i = 0; i < cols; i++) {
            out.put(`\t \\addtolength{\\gnumericMultiRowLength}{\\gnumericCol${columnName(col + i)}}%\n`);
            if (i > 0) out.put("\t \\addtolength{\\gnumericMultiRowLength}{\\tabcolsep}%\n");
          }
          out.put(`\t \\multirow{${rows}}[${Math.trunc(rows / 2)}]{\\gnumericMultiRowLength}{${empty ? "" : "\\parbox{\\gnumericMultiRowLength}{"}%\n\t `);
        }
        if (!empty) out.put(await content(cell!, row, col));
        if (rows > 1) out.put(empty ? "}" : "}}");
        if (multicolumn) out.put("}");
        out.put("\n"); col += cols - 1;
      }
      out.put("\\\\\n"); previousVertical = vertical;
    }
    if (!profile.fragment) {
      const horizontal = borders.rowHorizontal(r.endRow + 1, r.startColumn, r.endColumn, true);
      if (horizontal.present) out.put(borders.hhline(horizontal.lines, previousVertical));
      out.put(latexEnd);
    }
    return out.finish();
  };
}
