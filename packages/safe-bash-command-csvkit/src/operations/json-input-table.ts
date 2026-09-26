import type { Runtime } from "../runtime.js";
import { jsonNumberText, type JsonInput } from "../json-input.js";
import { Decimal } from "../types/decimal.js";
import { CsvkitBlocked } from "../errors.js";
import { castValue, CastError, columnTypeOrder, type ColumnType, type InferenceOptions, type TableValue } from "../table/types.js";

export type JsonCell = Exclude<JsonInput, JsonInput[] | Map<string, JsonInput>>;

/** Agate casts deserialized native values before applying string parsing rules. */
export function jsonInputTable(runtime: Runtime, headers: readonly string[], rows: readonly (readonly JsonCell[])[]) {
  const o = runtime.options;
  const options: InferenceOptions = {
    noInference: Boolean(o.no_inference), blanks: Boolean(o.blanks),
    nullValues: (o.null_values ?? []) as readonly string[], noLeadingZeroes: Boolean(o.no_leading_zeroes),
    now: runtime.context.clock.now(), timezone: runtime.context.locale.timezone,
    maxDecimalDigits: runtime.context.limits.maxDecimalDigits, maxDecimalExponent: runtime.context.limits.maxDecimalExponent,
    ...(o.locale ? { locale: String(o.locale) } : {}),
    ...(o.date_format ? { dateFormat: String(o.date_format) } : {}),
    ...(o.datetime_format ? { datetimeFormat: String(o.datetime_format) } : {})
  };
  if (!options.noInference && options.locale && !["en_US", "de_DE"].includes(options.locale))
    throw new CsvkitBlocked(`Agate Number locale ${options.locale}`);
  const cast = (type: ColumnType, value: JsonCell): TableValue | undefined => {
    runtime.step();
    if (value === null) return null;
    if (typeof value === "string") {
      try { return castValue(type, value, options, runtime.step); }
      catch (error) { if (!(error instanceof CastError)) throw error; return undefined; }
    }
    if (type === "Text") return typeof value === "boolean" ? value ? "True" : "False" : jsonNumberText(value, runtime);
    if (type === "Number") return { kind: "decimal", value: typeof value === "boolean" ? value ? "1" : "0" :
      value.token === "NaN" ? "NaN" : value.token === "Infinity" ? "Infinity" : value.token === "-Infinity" ? "-Infinity" : jsonNumberText(value, runtime) };
    if (type !== "Boolean") return undefined;
    if (typeof value === "boolean") return value;
    if (["NaN", "Infinity", "-Infinity"].includes(value.token)) return undefined;
    const decimal = Decimal.parse(jsonNumberText(value, runtime));
    if (decimal.coefficient === 0n) return false;
    if (!decimal.negative && decimal.exponent <= 0 && decimal.coefficient === 10n ** BigInt(-decimal.exponent)) return true;
    return undefined;
  };
  runtime.retain(64 + rows.length * (64 + headers.length * 64));
  const columns = headers.map((name, index) => {
    const type = columnTypeOrder(options).find(candidate => rows.every(row => cast(candidate, row[index] ?? null) !== undefined))!;
    return { name, type };
  });
  return { headers, columns, rows: rows.map(row => columns.map((column, index) => cast(column.type, row[index] ?? null)!)) };
}
