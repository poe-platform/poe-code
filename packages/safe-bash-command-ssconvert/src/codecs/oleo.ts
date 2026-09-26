// Released Gnumeric 1.12.61 plugins/oleo/oleo.c (GPL-2.0-or-later).
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Cell, ImportedValue, Workbook } from "../workbook.js";
import { formatA1 } from "../workbook/model.js";
import { sylkGrammar } from "../formulas/conventions.js";
import { enteredRecord, recordInput } from "./record-text.js";
import { asciiDigit, legacyCells, legacyExpression } from "./legacy-records.js";
import { sylkStyleNode } from "./sylk-styles.js";

// number-match.c:format_match_simple does not perform date/currency/text-entry inference.
function simpleValue(text: string, row: number, column: number, context: CapabilityContext): Cell {
  const value = text.trim();
  let at = value[0] === "+" || value[0] === "-" ? 1 : 0, digits = 0;
  while (asciiDigit(value[at])) { at++; digits++; }
  if (value[at] === ".") { at++; while (asciiDigit(value[at])) { at++; digits++; } }
  if (digits && (value[at] === "e" || value[at] === "E")) {
    at++;
    if (value[at] === "+" || value[at] === "-") at++;
    const start = at; while (asciiDigit(value[at])) at++;
    if (at === start) digits = 0;
  }
  if (digits && at === value.length && Number.isFinite(Number(value)))
    return { row, column, value: { kind: "number", value: Number(value) } };
  const upper = text.toUpperCase();
  if (upper === "TRUE" || upper === "FALSE" ||
    ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"].includes(text))
    return enteredRecord(text, row, column, context);
  return { row, column, value: { kind: "string", value: text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text } };
}

export async function readOleo(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  const input = recordInput(bytes, context, "Oleo"), out = legacyCells(context, "Oleo");
  let row = 0, column = 0, style: Record<string, ImportedValue> | undefined, format: string | undefined;
  const grammar = { ...sylkGrammar, id: "oleo", intersection: "" };
  for (let line; (line = await input.next()) !== undefined;) {
    if (line[0] === "F") {
      style = {}; format = undefined;
      let at = 1;
      while (at < line.length) {
        const c = line[at++]!;
        if (c === "c" || c === "r" || c === "F" || c === "G") {
          const type = c === "F" || c === "G" ? line[at++] : undefined;
          if (type === undefined) while (line[at] !== undefined && " \t\r\n\v\f".includes(line[at]!)) at++;
          const start = at;
          if (type === undefined && (line[at] === "-" || line[at] === "+")) at++;
          while (asciiDigit(line[at])) at++;
          const n = parseInt(line.slice(start, at), 10) || 0;
          if (c === "c") column = n - 1;
          else if (c === "r") row = n - 1;
          else {
            if (n > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert Oleo format length limit exceeded");
            format = type === "F" || type === "%" ? "0" + "0".repeat(Math.max(0, n)) + (type === "%" ? "%" : "") : undefined;
          }
        } else if (c === "L") style.HAlign = 2;
        else if (c === "R") style.HAlign = 4;
      }
    } else if (line[0] === "C") {
      let at = 1, value: string | undefined, expression: string | undefined;
      while (line[at] === ";") {
        const type = line[++at]; at++;
        const start = at;
        if (type === "r" || type === "c") {
          // astol advances only over the integer; trailing bytes stop the record.
          while (line[at] !== undefined && " \t\r\n\v\f".includes(line[at]!)) at++;
          if (line[at] === "+" || line[at] === "-") at++;
          const digits = at;
          while (asciiDigit(line[at])) at++;
          const n = digits === at ? 0 : parseInt(line.slice(start, at), 10);
          if (digits === at) at = start;
          if (type === "r") row = n - 1;
          else column = n - 1;
          continue;
        }
        let quoted = false;
        while (at < line.length && (line[at] !== ";" || type === "K" && quoted)) {
          if (type === "K" && line[at] === '"') quoted = !quoted;
          at++;
        }
        const text = line.slice(start, at);
        if (type === "K") value = text;
        else if (type === "E") expression = text;
        else break;
      }
      if (row < 0 || row >= 65536 || column < 0 || column >= 256) continue;
      const parsed = expression === undefined ? undefined : legacyExpression(expression, grammar, { sheet: "Sheet1", row, column }, context);
      if (parsed && !parsed.ok) await context.diagnostic?.({ code: "oleo-formula", severity: "warning",
        message: `${parsed.diagnostic.message === "Invalid formula" ? "Invalid expression" : parsed.diagnostic.message} "${expression}" at Sheet1!${formatA1(row, column)}.` });
      let cell: Cell = out.cells.get(`${row}:${column}`) ?? { row, column, value: { kind: "blank" } };
      if (value === undefined && !parsed?.ok) { out.put(cell); continue; }
      if (value !== undefined) cell = simpleValue(value, row, column, context);
      if (parsed?.ok) cell = { ...cell, formula: parsed.formula, ...(value !== undefined ? { cachedResult: cell.value } : {}), formulaDirty: value === undefined };
      if (value !== undefined && style) cell = { ...cell, style: { ...cell.style, ...style,
        gnumeric: sylkStyleNode({ ...style, ...(format ? { Format: format } : {}) }) }, ...(format ? { format } : {}) };
      out.put(cell);
    }
  }
  return { sheets: [{ id: "Sheet1", name: "Sheet1", size: { rows: 65536, columns: 256 }, cells: out.finish() }], activeSheet: "Sheet1" };
}
