import type { Runtime } from "./runtime.js";
import { defaultHeaders } from "./columns.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "./errors.js";
import { stripWhitespace, lowerText } from "./python-text.js";

export interface TextTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | null)[])[];
}

/** The measured no-inference Agate table path; no typed-value approximation. */
export async function readTextTable(runtime: Runtime, path?: string, rowLimit?: number): Promise<TextTable> {
  const o = runtime.options;
  if (!o.no_inference) throw new CsvkitBlocked("Agate table inference or dialect sniffing");
  const nulls = new Set<string>(o.blanks ? [] : ["", "na", "n/a", "none", "null", "."]);
  for (const value of (o.null_values ?? []) as readonly string[]) nulls.add(lowerText(value));
  let headers: readonly string[] | undefined;
  const rows: (string | null)[][] = [];
  for await (const record of runtime.records(path, runtime.input(path), Number(o.skip_lines ?? 0), true)) {
    if (headers === undefined) {
      headers = o.no_header_row ? defaultHeaders(record.cells.length) : record.cells;
      if (headers.some(name => !name) || new Set(headers).size !== headers.length) throw new CsvkitBlocked("Agate duplicate/unnamed column warning provenance");
      if (!o.no_header_row) { if (rowLimit === 0) break; continue; }
    }
    if (record.cells.length > headers.length) throw new CsvkitDiagnostic(`ValueError: Row ${rows.length} has ${record.cells.length} values, but Table only has ${headers.length} columns.`);
    runtime.retain(64 + headers.length * 16);
    rows.push(headers.map((_, index) => {
      runtime.step();
      const value = record.cells[index] ?? null;
      if (value === null) return null;
      runtime.retain(32 + value.length * 16);
      return nulls.has(lowerText(stripWhitespace(value))) ? null : value;
    }));
    if (rowLimit !== undefined && rows.length >= rowLimit) break;
  }
  return { headers: headers ?? [], rows };
}
