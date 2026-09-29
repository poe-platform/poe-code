import type { CellValue } from "@poe-code/spreadsheet-ast";
import { appendTextField } from "./text-export.js";
import { rendered } from "@poe-code/spreadsheet-engine/formulas/values";

export function parseSimpleSeparatedRows(text: string, sep: string): string[][] | undefined {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || field.length === 0) {
        quoted = !quoted;
      } else {
        return undefined;
      }
    } else if (!quoted && ch === sep) {
      if (field.startsWith("=") || field.startsWith("'")) return undefined;
      row.push(field);
      field = "";
    } else if (!quoted && (ch === "\r" || ch === "\n")) {
      if (field.startsWith("=") || field.startsWith("'")) return undefined;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += ch;
    }
  }
  if (quoted) return undefined;
  if (field.length > 0 || row.length > 0) {
    if (field.startsWith("=") || field.startsWith("'")) return undefined;
    row.push(field);
    rows.push(row);
  }
  return rows;
}


export function formatSimpleCsv(rows: readonly (readonly (string | CellValue)[])[]): string {
  let output = "";
  for (const row of rows) {
    for (let index = 0; index < row.length; index++) {
      if (index) output += ",";
      const value = row[index]!;
      appendTextField(typeof value === "string" ? value : rendered(value),
        { mode: "auto", quote: '"', whitespace: true }, text => { output += text; });
    }
    output += "\n";
  }
  return output;
}
