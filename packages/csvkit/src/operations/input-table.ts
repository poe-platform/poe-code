import type { Runtime } from "../runtime.js";
import { inferTable, type TypedTable, type TableValue } from "../table/index.js";

export function csvifiedRow(row: readonly TableValue[]): readonly TableValue[] {
  return row.map(value => typeof value === "object" && value?.kind === "datetime" ? { ...value, value: value.value.replace(" ", "T") } : value);
}

/** Non-CSV importers construct rows before Agate's shared column inference. */
export function inputTable(runtime: Runtime, headers: readonly string[], rows: readonly (readonly (string | null)[])[]): TypedTable {
  const o = runtime.options;
  runtime.retain(64 + rows.length * (64 + headers.length * 64));
  return inferTable(headers, rows, {
    noInference: Boolean(o.no_inference), blanks: Boolean(o.blanks),
    nullValues: (o.null_values ?? []) as readonly string[], noLeadingZeroes: Boolean(o.no_leading_zeroes),
    now: runtime.context.clock.now(), timezone: runtime.context.locale.timezone,
    maxDecimalDigits: runtime.context.limits.maxDecimalDigits, maxDecimalExponent: runtime.context.limits.maxDecimalExponent,
    ...(o.locale ? { locale: String(o.locale) } : {}),
    ...(o.date_format ? { dateFormat: String(o.date_format) } : {}),
    ...(o.datetime_format ? { datetimeFormat: String(o.datetime_format) } : {})
  }, runtime.step);
}
