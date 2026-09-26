import type { CsvWriteCell } from "../csv.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { stripWhitespace, lowerText } from "../python-text.js";
import { Decimal } from "../types/decimal.js";
import { duration, temporalDate, TemporalCastError } from "../types/temporal.js";
import { decimalZeroes } from "../unicode-profile.js";

export type ColumnType = "Boolean" | "Number" | "TimeDelta" | "Date" | "DateTime" | "Text";
export type TableValue = Exclude<CsvWriteCell, number | bigint>;
export interface InferenceOptions {
  readonly noInference?: boolean;
  readonly numberTextOnly?: boolean;
  readonly blanks?: boolean;
  readonly nullValues?: readonly string[];
  readonly noLeadingZeroes?: boolean;
  readonly dateFormat?: string;
  readonly datetimeFormat?: string;
  readonly locale?: string;
  readonly limit?: number;
  readonly now?: number;
  readonly timezone?: string;
  readonly maxDecimalDigits?: number;
  readonly maxDecimalExponent?: number;
}

export function columnTypeOrder(options: InferenceOptions): readonly ColumnType[] {
  if (options.noInference) return ["Text"];
  if (options.numberTextOnly) return ["Number", "Text"];
  if (options.datetimeFormat) return ["Boolean", "TimeDelta", "Date", "DateTime", "Number", "Text"];
  if (options.dateFormat) return ["Boolean", "TimeDelta", "Date", "Number", "DateTime", "Text"];
  return ["Boolean", "Number", "TimeDelta", "Date", "DateTime", "Text"];
}

export class CastError extends Error {}

/** Decimal multiplication by one under the frozen precision-28 half-even context. */
function decimal(text: string, options: InferenceOptions, step: () => void): string {
  let ascii = "";
  for (const char of text) {
    step();
    const code = char.codePointAt(0)!;
    const zero = decimalZeroes.find(start => code >= start && code < start + 10);
    ascii += zero === undefined ? char : String(code - zero);
  }
  ascii = stripWhitespace(ascii).replaceAll("_", "");
  if (/^[+-]?(inf(inity)?)$/i.test(ascii)) return ascii.startsWith("-") ? "-Infinity" : "Infinity";
  const nan = /^[+-]?nan(\d*)$/i.exec(ascii);
  if (nan) {
    if (nan[1]!.length > (options.maxDecimalDigits ?? 10000)) throw new CsvkitBlocked("Decimal admission budget exceeded");
    return (ascii.startsWith("-") ? "-" : "") + "NaN" + nan[1]!.slice(-28).replace(/^0+/, "");
  }
  if (/^[+-]?snan\d*$/i.test(ascii)) throw new CastError();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(ascii);
  if (!match) throw new CastError();
  const fraction = match[3] ?? match[4] ?? "";
  if ((match[2]?.length ?? 0) + fraction.length > (options.maxDecimalDigits ?? 10000) ||
      Math.abs(Number(match[5] ?? 0)) > (options.maxDecimalExponent ?? 10000)) throw new CsvkitBlocked("Decimal admission budget exceeded");
  return Decimal.parse(ascii).multiply(Decimal.parse("1")).toString();
}

export function castValue(type: ColumnType, value: string | null, options: InferenceOptions, step: () => void = () => {}): TableValue {
  step();
  if (value === null) return null;
  const nulls = options.blanks ? [] : ["", "na", "n/a", "none", "null", "."];
  const isNull = (text: string): boolean => [...nulls, ...(options.nullValues ?? [])].some(item => lowerText(item) === lowerText(text));
  let text = stripWhitespace(value);
  if (type === "Boolean") text = stripWhitespace(value.replaceAll(",", ""));
  if (isNull(text)) return null;
  if (type === "Text") return value;
  if (type === "Boolean") {
    if (["yes", "y", "true", "t", "1"].includes(lowerText(text))) return true;
    if (["no", "n", "false", "f", "0"].includes(lowerText(text))) return false;
    throw new CastError(`Can not convert value ${text} to bool.`);
  }
  // csvkit's --locale configures Number only; Date/DateTime constructors use
  // their own default parser locale, including during unused hypotheses.
  const { locale: numberLocale, ...temporalOptions } = options;
  if (type === "TimeDelta" || type === "Date" || type === "DateTime") {
    try { return type === "TimeDelta" ? duration(text, step) : temporalDate(type, text, temporalOptions, step); }
    catch (error) { if (error instanceof TemporalCastError) throw new CastError(error.message); throw error; }
  }
  const separators = { en_US: { group: ",", decimal: "." }, de_DE: { group: ".", decimal: "," } };
  const locale = numberLocale ?? "en_US";
  const symbols = separators[locale as keyof typeof separators];
  if (!symbols) throw new CsvkitBlocked(`Agate Number locale ${locale}`);
  text = text.replace(/^%+|%+$/g, "");
  const negative = text.startsWith("-");
  if (negative) text = text.slice(1);
  for (const symbol of ["؋", "$", "ƒ", "៛", "¥", "₡", "₱", "£", "€", "¢", "﷼", "₪", "₩", "₭", "₮", "₦", "฿", "₤", "₫"]) {
    while (text.startsWith(symbol)) { step(); text = text.slice(symbol.length); }
    while (text.endsWith(symbol)) { step(); text = text.slice(0, -symbol.length); }
  }
  text = text.replaceAll(symbols.group, "").replaceAll(symbols.decimal, ".");
  if (options.noLeadingZeroes && text.length > 1 && text[0] === "0" && text[1] !== ".") throw new CastError(`Can not parse value "${text}" as Decimal without leading zeroes`);
  try {
    let value = decimal(text, options, step);
    if (negative && !value.includes("NaN")) value = value.startsWith("-") ? value.slice(1) : "-" + value;
    return { kind: "decimal", value };
  }
  catch (error) {
    if (!(error instanceof CastError)) throw error;
    throw new CastError(`Can not parse value "${text}" as Decimal.`);
  }
}

export interface TypedColumn { readonly name: string; readonly type: ColumnType }
export interface TypedTable {
  readonly headers: readonly string[];
  readonly columns: readonly TypedColumn[];
  readonly rows: readonly (readonly TableValue[])[];
  readonly rawRows: readonly (readonly (string | null)[])[];
}

/** Sample only for inference; every row is subsequently cast with the chosen type. */
export function inferTable(headers: readonly string[], rows: readonly (readonly (string | null)[])[], options: InferenceOptions = {}, step: () => void = () => {}): TypedTable {
  if (headers.some(name => !name) || new Set(headers).size !== headers.length || !headers.length && rows.length) throw new CsvkitBlocked("Agate duplicate/unnamed column warning provenance");
  const order = options.limit === 0 ? ["Text" as const] : columnTypeOrder(options);
  const sample = options.limit ? rows.slice(0, options.limit) : rows;
  const hypotheses = headers.map(() => new Set(order));
  // Agate tests every surviving hypothesis in physical row/column order,
  // then chooses by preference. Accepting one type does not skip other tests.
  for (const row of sample) {
    for (const [index, candidates] of hypotheses.entries()) {
      step();
      if (candidates.size === 1 || row.length <= index) continue;
      for (const type of candidates) {
        try { castValue(type, row[index]!, options, step); }
        catch (error) { if (!(error instanceof CastError)) throw error; candidates.delete(type); }
      }
    }
  }
  const columns = headers.map((name, index): TypedColumn => {
    for (const type of order) {
      if (hypotheses[index]!.has(type)) return { name, type };
    }
    throw new CsvkitBlocked("no compatible Agate column type");
  });
  const typedRows = rows.map((row, rowIndex) => {
    if (row.length > headers.length) throw new CsvkitDiagnostic(`ValueError: Row ${rowIndex} has ${row.length} values, but Table only has ${headers.length} columns.`);
    return columns.map((column, index) => {
      try { return castValue(column.type, row[index] ?? null, options.limit === 0 ? {} : options, step); }
      catch (error) {
        if (!(error instanceof CastError)) throw error;
        throw new CsvkitDiagnostic(`CastError: ${error.message} Error at row ${rowIndex} column ${column.name}.`);
      }
    });
  });
  return { headers, columns, rows: typedRows, rawRows: rows };
}
