import type { Runtime } from "../runtime.js";
import { defaultHeaders, normalizeHeaders } from "./headers.js";
import { CsvkitBlocked } from "../errors.js";
import { inferTable, TableInference, type InferenceOptions, type TypedTable } from "./types.js";
import { pythonValueText } from "../csv.js";
import { inputWriteCell } from "../operations/input-cells.js";

export { inferTable, columnTypeOrder, castValue } from "./types.js";
export type { ColumnType, TableValue, TypedColumn, TypedTable, InferenceOptions } from "./types.js";

export async function readTable(runtime: Runtime, path?: string, rowLimit?: number, normalize = false, lineNumbers = false, preserveCells = false): Promise<TypedTable> {
  const o = runtime.options;
  let headers: readonly string[] | undefined;
  const rows: (readonly string[])[] = [];
  const recordLimit = rowLimit === undefined ? undefined : rowLimit + (o.no_header_row ? 0 : 1);
  const file = runtime.input(path);
  const records = preserveCells ? runtime.records(path, file, Number(o.skip_lines ?? 0), true, recordLimit, true) :
    runtime.records(path, file, Number(o.skip_lines ?? 0), true, recordLimit);
  for await (const record of records) {
    const values = record.cells.map(cell => pythonValueText(inputWriteCell(cell)));
    const cells = lineNumbers ? [!o.no_header_row && record.line === 1 ? "line_numbers" : String(record.line - (o.no_header_row ? 0 : 1)), ...values] : values;
    if (cells.length > runtime.context.limits.maxColumns) throw new CsvkitBlocked("column budget exceeded");
    if (headers === undefined) {
      headers = o.no_header_row ? defaultHeaders(cells.length) : cells;
      if (normalize) headers = await normalizeHeaders(headers, runtime);
      if (headers.some(name => !name) || new Set(headers).size !== headers.length) throw new CsvkitBlocked("Agate duplicate/unnamed column warning provenance");
      if (!o.no_header_row) { if (rowLimit === 0) break; continue; }
    }
    runtime.retain(64 + values.length * 16 + values.reduce((size, value) => size + value.length * 16 + 32, 0));
    rows.push(cells);
    if (rowLimit !== undefined && rows.length >= rowLimit) break;
  }
  const options = inferenceOptions(runtime);
  runtime.retain(64 + rows.length * (64 + (headers?.length ?? 0) * 64));
  return inferTable(headers ?? [], rows, options, runtime.step);
}

function inferenceOptions(runtime: Runtime): InferenceOptions {
  const o = runtime.options;
  return {
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
}

export interface ReplayTable {
  readonly headers: readonly string[];
  readonly columns: readonly import("./types.js").TypedColumn[];
  readonly count: number;
  rows(): AsyncIterable<readonly import("./types.js").TableValue[]>;
  close(): Promise<void>;
}

/** Infer in physical order, then cast on replay without retaining the table. */
export async function readReplayTable(runtime: Runtime, path?: string, rowLimit?: number, normalize = false, lineNumbers = false, preserveCells = false): Promise<ReplayTable> {
  if (!runtime.storage) {
    const table = await readTable(runtime, path, rowLimit, normalize, lineNumbers, preserveCells);
    return { ...table, count: table.rows.length, async *rows() { yield* table.rows; }, async close() {} };
  }
  const raw = await runtime.storage.file<readonly string[]>();
  const o = runtime.options;
  let headers: readonly string[] | undefined;
  let count = 0;
  const recordLimit = rowLimit === undefined ? undefined : rowLimit + (o.no_header_row ? 0 : 1);
  const file = runtime.input(path);
  const records = preserveCells ? runtime.records(path, file, Number(o.skip_lines ?? 0), true, recordLimit, true) : runtime.records(path, file, Number(o.skip_lines ?? 0), true, recordLimit);
  for await (const record of records) {
    const values = record.cells.map(cell => pythonValueText(inputWriteCell(cell)));
    const cells = lineNumbers ? [!o.no_header_row && record.line === 1 ? "line_numbers" : String(record.line - (o.no_header_row ? 0 : 1)), ...values] : values;
    if (cells.length > runtime.context.limits.maxColumns) throw new CsvkitBlocked("column budget exceeded");
    if (headers === undefined) {
      headers = o.no_header_row ? defaultHeaders(cells.length) : cells;
      if (normalize) headers = await normalizeHeaders(headers, runtime);
      if (headers.some(name => !name) || new Set(headers).size !== headers.length) throw new CsvkitBlocked("Agate duplicate/unnamed column warning provenance");
      if (!o.no_header_row) { if (rowLimit === 0) break; continue; }
    }
    await raw.write(cells);
    count++;
    if (rowLimit !== undefined && count >= rowLimit) break;
  }
  const selected = new TableInference(headers ?? [], inferenceOptions(runtime), runtime.step);
  await raw.file.seal();
  for await (const row of raw.read()) { selected.observe(row); await runtime.checkpoint(); }
  // Preserve validation before any output, including row width errors.
  let index = 0;
  for await (const row of raw.read()) { selected.cast(row, index++); await runtime.checkpoint(); }
  return { headers: headers ?? [], columns: selected.columns(), count,
    async *rows() { let index = 0; for await (const row of raw.read()) { runtime.step(); yield selected.cast(row, index++); } },
    close: () => raw.close()
  };
}
