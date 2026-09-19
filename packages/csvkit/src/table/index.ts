import type { Runtime } from "../runtime.js";
import { defaultHeaders, normalizeHeaders } from "./headers.js";
import { CsvkitBlocked } from "../errors.js";
import { inferTable, type InferenceOptions, type TypedTable } from "./types.js";

export { inferTable, columnTypeOrder, castValue } from "./types.js";
export type { ColumnType, TableValue, TypedColumn, TypedTable, InferenceOptions } from "./types.js";

export async function readTable(runtime: Runtime, path?: string, rowLimit?: number, normalize = false, lineNumbers = false): Promise<TypedTable> {
  const o = runtime.options;
  let headers: readonly string[] | undefined;
  const rows: (readonly string[])[] = [];
  const recordLimit = rowLimit === undefined ? undefined : rowLimit + (o.no_header_row ? 0 : 1);
  for await (const record of runtime.records(path, runtime.input(path), Number(o.skip_lines ?? 0), true, recordLimit)) {
    const cells = lineNumbers ? [!o.no_header_row && record.line === 1 ? "line_numbers" : String(record.line - (o.no_header_row ? 0 : 1)), ...record.cells] : record.cells;
    if (cells.length > runtime.context.limits.maxColumns) throw new CsvkitBlocked("column budget exceeded");
    if (headers === undefined) {
      headers = o.no_header_row ? defaultHeaders(cells.length) : cells;
      if (normalize) headers = await normalizeHeaders(headers, runtime);
      if (headers.some(name => !name) || new Set(headers).size !== headers.length) throw new CsvkitBlocked("Agate duplicate/unnamed column warning provenance");
      if (!o.no_header_row) { if (rowLimit === 0) break; continue; }
    }
    runtime.retain(64 + record.cells.length * 16 + record.cells.reduce((size, value) => size + value.length * 16 + 32, 0));
    rows.push(cells);
    if (rowLimit !== undefined && rows.length >= rowLimit) break;
  }
  const options: InferenceOptions = {
    now: runtime.context.clock.now(), timezone: runtime.context.locale.timezone,
    noInference: Boolean(o.no_inference), numberTextOnly: o.out_quoting === 2,
    blanks: Boolean(o.blanks), nullValues: (o.null_values ?? []) as readonly string[],
    noLeadingZeroes: Boolean(o.no_leading_zeroes),
    maxDecimalDigits: runtime.context.limits.maxDecimalDigits,
    maxDecimalExponent: runtime.context.limits.maxDecimalExponent,
    ...(o.date_format ? { dateFormat: String(o.date_format) } : {}),
    ...(o.datetime_format ? { datetimeFormat: String(o.datetime_format) } : {}),
    ...(o.locale ? { locale: String(o.locale) } : {})
  };
  runtime.retain(64 + rows.length * (64 + (headers?.length ?? 0) * 64));
  return inferTable(headers ?? [], rows, options, runtime.step);
}
