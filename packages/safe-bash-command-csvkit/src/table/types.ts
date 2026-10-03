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

const DEFAULT_NULL_SET: ReadonlySet<string> = new Set(["", "na", "n/a", "none", "null", "."]);
const CURRENCY_SYMBOLS = ["؋", "$", "ƒ", "៛", "¥", "₡", "₱", "£", "€", "¢", "﷼", "₪", "₩", "₭", "₮", "₦", "฿", "₤", "₫"] as const;
const BOOLEAN_TRUE_SET: ReadonlySet<string> = new Set(["yes", "y", "true", "t", "1"]);
const BOOLEAN_FALSE_SET: ReadonlySet<string> = new Set(["no", "n", "false", "f", "0"]);

/** Decimal multiplication by one under the frozen precision-28 half-even context. */
function decimal(text: string, options: InferenceOptions, step: () => void): string {
  let allAscii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) >= 0x80) { allAscii = false; break; }
  }
  let ascii: string;
  if (allAscii) {
    for (let i = 0; i < text.length; i++) step();
    ascii = stripWhitespace(text);
    if (ascii.includes("_")) ascii = ascii.replaceAll("_", "");
  } else {
    ascii = "";
    for (const char of text) {
      step();
      const code = char.codePointAt(0)!;
      const zero = decimalZeroes.find(start => code >= start && code < start + 10);
      ascii += zero === undefined ? char : String(code - zero);
    }
    ascii = stripWhitespace(ascii).replaceAll("_", "");
  }
  if (/^[+-]?(inf(inity)?)$/i.test(ascii)) return ascii.startsWith("-") ? "-Infinity" : "Infinity";
  const nan = /^[+-]?nan(\d*)$/i.exec(ascii);
  if (nan) {
    if (nan[1]!.length > (options.maxDecimalDigits ?? Infinity)) throw new CsvkitBlocked("Decimal admission budget exceeded");
    return (ascii.startsWith("-") ? "-" : "") + "NaN" + nan[1]!.slice(-28).replace(/^0+/, "");
  }
  if (/^[+-]?snan\d*$/i.test(ascii)) throw new CastError();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(ascii);
  if (!match) throw new CastError();
  const fraction = match[3] ?? match[4] ?? "";
  if ((match[2]?.length ?? 0) + fraction.length > (options.maxDecimalDigits ?? Infinity) ||
      Math.abs(Number(match[5] ?? 0)) > (options.maxDecimalExponent ?? Infinity)) throw new CsvkitBlocked("Decimal admission budget exceeded");
  if (
    match[2] !== undefined &&
    fraction.length === 0 &&
    match[5] === undefined &&
    !ascii.includes(".") &&
    match[2].length <= 27 &&
    (match[2].length === 1 || match[2].charCodeAt(0) !== 48)
  ) {
    if (match[2] === "0") return match[1] === "-" ? "-0" : "0";
    return (match[1] === "-" ? "-" : "") + match[2];
  }
  return Decimal.parse(ascii).multiply(Decimal.parse("1")).toString();
}

export function castValue(type: ColumnType, value: string | null, options: InferenceOptions, step: () => void = () => {}): TableValue {
  step();
  if (value === null) return null;
  if (type === "Text" && (!options.nullValues || options.nullValues.length === 0)) {
    if (options.blanks) return value;
    const len = value.length;
    if (len > 4) {
      const c0 = value.charCodeAt(0);
      const cLast = value.charCodeAt(len - 1);
      if (c0 > 32 && c0 < 0x80 && cLast > 32 && cLast < 0x80) return value;
    }
  }
  let text = stripWhitespace(value);
  if (type === "Boolean" && value.includes(",")) text = stripWhitespace(value.replaceAll(",", ""));
  const lowered = lowerText(text);
  if (!options.blanks && DEFAULT_NULL_SET.has(lowered)) return null;
  if (options.nullValues && options.nullValues.length > 0 && options.nullValues.some(item => lowerText(item) === lowered)) return null;
  if (type === "Text") return value;
  if (type === "Boolean") {
    if (BOOLEAN_TRUE_SET.has(lowered)) return true;
    if (BOOLEAN_FALSE_SET.has(lowered)) return false;
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
  if (text.startsWith("%") || text.endsWith("%")) text = text.replace(/^%+|%+$/g, "");
  const negative = text.startsWith("-");
  if (negative) text = text.slice(1);
  if (text.length > 0) {
    const fCode = text.charCodeAt(0);
    const lCode = text.charCodeAt(text.length - 1);
    if (fCode < 48 || fCode > 57 || lCode < 48 || lCode > 57) {
      for (const symbol of CURRENCY_SYMBOLS) {
        while (text.startsWith(symbol)) { step(); text = text.slice(symbol.length); }
        while (text.endsWith(symbol)) { step(); text = text.slice(0, -symbol.length); }
      }
    }
  }
  if (text.includes(symbols.group)) text = text.replaceAll(symbols.group, "");
  if (symbols.decimal !== "." && text.includes(symbols.decimal)) text = text.replaceAll(symbols.decimal, ".");
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

/** Inference retains only six hypotheses per column, never input records. */
export class TableInference {
  readonly #order: readonly ColumnType[];
  readonly #hypotheses: Set<ColumnType>[];
  #observed = 0;
  constructor(readonly headers: readonly string[], readonly options: InferenceOptions = {}, readonly step: () => void = () => {}) {
    if (headers.some(name => !name) || new Set(headers).size !== headers.length) throw new CsvkitBlocked("Agate duplicate/unnamed column warning provenance");
    this.#order = options.limit === 0 ? ["Text"] : columnTypeOrder(options);
    this.#hypotheses = headers.map(() => new Set(this.#order));
  }
  observe(row: readonly (string | null)[]): void {
    if (!this.headers.length) throw new CsvkitBlocked("Agate duplicate/unnamed column warning provenance");
    if (this.options.limit !== undefined && this.options.limit >= 0 && this.#observed++ >= this.options.limit) return;
    for (const [index, candidates] of this.#hypotheses.entries()) {
      this.step();
      if (candidates.size === 1 || row.length <= index) continue;
      for (const type of candidates) {
        if (type === "Text") { this.step(); continue; }
        try { castValue(type, row[index]!, this.options, this.step); }
        catch (error) { if (!(error instanceof CastError)) throw error; candidates.delete(type); }
      }
    }
  }
  columns(): readonly TypedColumn[] {
    return this.headers.map((name, index) => ({ name, type: this.#order.find(type => this.#hypotheses[index]!.has(type))! }));
  }
  cast(row: readonly (string | null)[], rowIndex: number): readonly TableValue[] {
    if (row.length > this.headers.length) throw new CsvkitDiagnostic(`ValueError: Row ${rowIndex} has ${row.length} values, but Table only has ${this.headers.length} columns.`);
    return this.columns().map((column, index) => {
      try { return castValue(column.type, row[index] ?? null, this.options.limit === 0 ? {} : this.options, this.step); }
      catch (error) {
        if (!(error instanceof CastError)) throw error;
        throw new CsvkitDiagnostic(`CastError: ${error.message} Error at row ${rowIndex} column ${column.name}.`);
      }
    });
  }
}

/** Buffering convenience API; streaming callers use TableInference and replay. */
export function inferTable(headers: readonly string[], rows: readonly (readonly (string | null)[])[], options: InferenceOptions = {}, step: () => void = () => {}): TypedTable {
  const inference = new TableInference(headers, options, step);
  for (const row of options.limit && options.limit < 0 ? rows.slice(0, options.limit) : rows) inference.observe(row);
  return { headers, columns: inference.columns(), rows: rows.map((row, index) => inference.cast(row, index)), rawRows: rows };
}
