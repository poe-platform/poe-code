// Based on Gnumeric 1.12.61 src/stf.c and src/stf-parse.c (GPL-2.0-or-later).
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Cell, Workbook } from "../workbook.js";
import { inferTextColumns } from "./text-values.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { parseFormula } from "../workbook/updates/formula.js";
import { DEFAULT_SHEET_SIZE, MAX_SHEET_SIZE } from "../workbook/model.js";
import { formattingLocale } from "../formatting/locale.js";

function admit(bytes: Uint8Array, context: CapabilityContext) {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes)
    throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
}

import { decodeText } from "../encoding/decode.js";

export function probeTextName(filename: string): boolean {
  const basename = filename.slice(filename.lastIndexOf("/") + 1);
  return ["csv", "tsv", "txt"].includes(basename.slice(basename.lastIndexOf(".") + 1).toLowerCase());
}

export async function probeText(bytes: Uint8Array, context: CapabilityContext): Promise<boolean> {
  admit(bytes, context);
  // Automatic import must leave the unambiguous SYLK ID signature to its opener,
  // including a misleading .csv/.txt name. Explicit CSV selection bypasses probes.
  if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 59) return false;
  if (!bytes.length) return context.inputFilename !== undefined && probeTextName(context.inputFilename);
  const header = decodeText(bytes.subarray(0, 512));
  let index = 0;
  for (const c of header) {
    const n = c.codePointAt(0)!;
    if (!n) break;
    if (c === "\n" || c === "\t" || c === "\r" || c === "\ufeff" && index === 0) { index++; continue; }
    // GLib g_unichar_isprint excludes control, format, surrogate and unassigned categories.
    if (/[\p{Cc}\p{Cf}\p{Cn}\p{Cs}]/u.test(c)) return false;
    index++;
  }
  return true;
}

function lineEnding(text: string): string {
  let cr = 0, lf = 0, crlf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r") { if (text[i + 1] === "\n") { crlf++; i++; } else cr++; }
    else if (text[i] === "\n") lf++;
  }
  const max = Math.max(cr, lf, crlf);
  return max === lf ? "\n" : max === crlf ? "\r\n" : "\r";
}

function trimSpace(field: string): string {
  let start = 0, end = field.length;
  while (start < end && /[\p{Z}\u0009-\u000d]/u.test(field[start]!)) start++;
  while (end > start && /[\p{Z}\u0009-\u000d]/u.test(field[end - 1]!)) end--;
  return field.slice(start, end);
}

function separator(text: string, ending: string, csv: boolean, decimal: string): string {
  // stf_parse_lines(..., 1000, FALSE) counts from one and increments before
  // checking the limit. Do not materialize every row just to inspect this prefix.
  const lines: string[] = [];
  let offset = 0;
  while (offset < text.length && lines.length < 999) {
    const end = text.indexOf(ending, offset);
    if (end < 0) { lines.push(text.slice(offset)); break; }
    lines.push(text.slice(offset, end));
    offset = end + ending.length;
  }
  if (csv) {
    const line = lines.slice(1).find(l => l.startsWith('"')) ?? (lines[0]?.startsWith('"') ? lines[0] : undefined) ?? lines.find(l => l.includes('"'));
    if (line) {
      const start = line.indexOf('"');
      let i = start + 1;
      while (i < line.length) {
        if (line[i++] === '"') { if (line[i] === '"') i++; else break; }
      }
      // Native advances past the first character following the closing quote.
      if (i < line.length) i += line.codePointAt(i)! > 0xffff ? 2 : 1;
      while (i < line.length && /[\p{Z}\u0009-\u000d]/u.test(line[i]!)) i++;
      const punct = (c: string | undefined) => c !== undefined && c !== '"' && /[\p{P}\p{S}]/u.test(c);
      const following = i < line.length ? String.fromCodePoint(line.codePointAt(i)!) : undefined;
      if (punct(following)) return following!;
      for (let j = start - 1; j >= 0; j--) {
        if (line.charCodeAt(j) >= 0xdc00 && line.charCodeAt(j) <= 0xdfff) j--;
        const preceding = String.fromCodePoint(line.codePointAt(j)!);
        if (punct(preceding)) return preceding;
      }
    }
    return ",";
  }
  const quantile = (c: string, q: number) => {
    const counts = lines.filter(l => l.length).map(l => l.split(c).length - 1).sort((a, b) => a - b);
    return counts[Math.min(counts.length - 1, Math.ceil(q * counts.length))] ?? 0;
  };
  const argumentSeparator = decimal === "," ? ";" : ",";
  const columnSeparator = decimal === "," ? "\\" : ",";
  if (quantile("\t", .2) >= 1 && quantile("\t", .2) >= quantile(argumentSeparator, .2) - 1) return "\t";
  for (const c of [argumentSeparator, columnSeparator, ":", ",", ";", "|", "!", " "]) if (quantile(c, .5)) return c === " " ? " \t" : c;
  return "";
}

export async function readText(bytes: Uint8Array, context: CapabilityContext, encoding?: string): Promise<Workbook> {
  admit(bytes, context);
  let text = decodeText(bytes, encoding);
  const nulParts = text.split("\0");
  const nuls = nulParts.length - 1;
  if (nuls) text = nulParts.join(" ");
  if (nuls) await context.diagnostic?.({ code: "text-nul", severity: "warning", message: nuls === 1 ?
    "The file contains 1 NUL character. It has been changed to a space." :
    `The file contains ${nuls} NUL characters. They have been changed to spaces.` });
  context.signal.throwIfAborted();
  const ending = lineEnding(text);
  const csv = context.inputFilename?.toLowerCase().endsWith(".csv") ?? false;
  const sep = separator(text, ending, csv, formattingLocale(context.environment.locale).decimal), collapse = sep.includes(" ");
  const separatorAt = (offset: number) => collapse ? (sep.includes(text[offset]!) ? 1 : 0) :
    (sep.length && text.startsWith(sep, offset) ? sep.length : 0);
  const cells: Cell[] = [];
  const name = context.inputFilename?.slice(context.inputFilename.lastIndexOf("/") + 1) ?? "Sheet1";
  const book: Workbook = { sheets: [{ id: "s1", name, cells }] };
  let i = 0, row = 0, column = 0;
  let maximumColumns = 0, rowsExceeded = false;
  while (i < text.length) {
    context.signal.throwIfAborted();
    if (row >= MAX_SHEET_SIZE.rows) { rowsExceeded = true; break; }
    if (text.startsWith(ending, i)) { i += ending.length; row++; column = 0; continue; }
    if (collapse) { while (i < text.length && separatorAt(i)) i++; if (i === text.length || text.startsWith(ending, i)) continue; }
    if (!csv) while (i < text.length && !text.startsWith(ending, i) && !separatorAt(i) && /[\p{Z}\u0009-\u000d]/u.test(text[i]!)) i++;
    let field = "";
    if (text[i] === '"') {
      i++;
      const parts: string[] = [];
      let start = i;
      while (i < text.length) {
        if (text[i++] !== '"') continue;
        parts.push(text.slice(start, i - 1));
        if (text[i] === '"') { parts.push('"'); i++; start = i; }
        else { while (i < text.length && !text.startsWith(ending, i) && !separatorAt(i)) i++; start = i; break; }
      }
      parts.push(text.slice(start, i)); field = parts.join("");
    } else {
      const start = i;
      while (i < text.length && !text.startsWith(ending, i) && !separatorAt(i)) i++;
      field = text.slice(start, i);
    }
    if (!csv) field = trimSpace(field);
    if (field && column < MAX_SHEET_SIZE.columns) {
      if (cells.length >= context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert cells limit exceeded");
      cells.push({ row, column, value: { kind: "string", value: field } });
    }
    column++;
    maximumColumns = Math.max(maximumColumns, column + (separatorAt(i) ? 1 : 0));
    if (i < text.length && separatorAt(i)) { i += separatorAt(i); if (collapse) while (i < text.length && separatorAt(i)) i++; }
  }
  const rowCount = Math.min(MAX_SHEET_SIZE.rows, row + (column > 0 ? 1 : 0));
  const size = { ...DEFAULT_SHEET_SIZE };
  while (size.rows < rowCount && size.rows < MAX_SHEET_SIZE.rows) size.rows *= 2;
  while (size.columns < maximumColumns && size.columns < MAX_SHEET_SIZE.columns) size.columns *= 2;
  const colsExceeded = maximumColumns > MAX_SHEET_SIZE.columns;
  if (rowsExceeded) await context.diagnostic?.({ code: "text-rows-exceeded", severity: "warning",
    message: "There are more rows of data than there is room for in the sheet.  Extra rows will be ignored." });
  if (colsExceeded) await context.diagnostic?.({ code: "text-cols-exceeded", severity: "warning",
    message: "There are more columns of data than there is room for in the sheet.  Extra columns will be ignored." });
  if (rowsExceeded || colsExceeded) await context.diagnostic?.({ code: "text-dropped", severity: "warning",
    message: "Some data did not fit on the sheet and was dropped." });
  context.signal.throwIfAborted();
  const sizedBook = { ...book, sheets: [{ ...book.sheets[0]!, size }] };
  const parsedCells: Cell[] = cells.map(cell => {
    context.signal.throwIfAborted();
    if (cell.value.kind !== "string") return cell;
    const field = cell.value.value;
    if (field.startsWith("=") && field.length > 1) {
      const unknown = {};
      try {
        if (parseFormula(field, sizedBook, "s1", () => { throw unknown; }, { sheet: "s1", row: cell.row, column: cell.column }))
          return { ...cell, value: { kind: "blank" }, formula: field, formulaDirty: true };
      } catch (error) { if (error !== unknown) throw error; }
    }
    return cell;
  });
  const inferred = { ...sizedBook, sheets: [{ ...sizedBook.sheets[0]!, cells: inferTextColumns(parsedCells, sizedBook, context, rowCount) }] };
  return parsedCells.some(cell => cell.formula) ? recalculateWorkbook(inferred, context) : inferred;
}

export async function readTextAssistant(_bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  context.signal.throwIfAborted();
  throw new SsconvertError("io", "E This importer can only be used with a GUI.");
}
