import { CsvkitBlocked, CsvkitDiagnostic } from "./errors.js";
import { decimalZeroes, integerWhitespace } from "./unicode-profile.js";
import { repr } from "./cli/parser.js";

export interface CsvDialect {
  readonly delimiter?: string;
  readonly quotechar?: string | null;
  readonly escapechar?: string | null;
  readonly doublequote?: boolean;
  readonly quoting?: number;
  readonly skipinitialspace?: boolean;
  readonly lineterminator?: string;
  readonly fieldLimit?: number;
  readonly fieldBudget?: number;
  readonly columnBudget?: number;
}
export type CsvCell = string | number | null;
export interface CsvRecord<T extends CsvCell = string> { readonly cells: readonly T[]; readonly line: number }

/** Python float grammar, including Unicode decimal digits and digit separators. */
export function numericField(field: string): number {
  const invalid = (): never => { throw new CsvkitDiagnostic(`ValueError: could not convert string to float: ${repr(field)}`); };
  const chars = Array.from(field);
  let first = 0; let last = chars.length;
  while (first < last && integerWhitespace.includes(chars[first]!.codePointAt(0)!)) first++;
  while (last > first && integerWhitespace.includes(chars[last - 1]!.codePointAt(0)!)) last--;
  let value = "";
  for (let index = first; index < last; index++) {
    const char = chars[index]!;
    const code = char.codePointAt(0)!;
    const zero = decimalZeroes.find(start => code >= start && code < start + 10);
    value += zero === undefined ? char : String(code - zero);
  }
  const lower = value.toLowerCase();
  const unsigned = lower[0] === "+" || lower[0] === "-" ? lower.slice(1) : lower;
  if (unsigned === "inf" || unsigned === "infinity") return lower[0] === "-" ? -Infinity : Infinity;
  if (unsigned === "nan") return NaN;
  const digit = (char: string | undefined): boolean => char !== undefined && char >= "0" && char <= "9";
  let normalized = "";
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "_") {
      if (!digit(value[index - 1]) || !digit(value[index + 1])) invalid();
    } else normalized += value[index];
  }
  let index = normalized[0] === "+" || normalized[0] === "-" ? 1 : 0;
  let digits = 0;
  while (digit(normalized[index])) { index++; digits++; }
  if (normalized[index] === ".") {
    index++;
    while (digit(normalized[index])) { index++; digits++; }
  }
  if (!digits) invalid();
  if (normalized[index] === "e" || normalized[index] === "E") {
    index++;
    if (normalized[index] === "+" || normalized[index] === "-") index++;
    const start = index;
    while (digit(normalized[index])) index++;
    if (index === start) invalid();
  }
  if (index !== normalized.length) invalid();
  return Number(normalized);
}

function character(value: string | undefined, fallback: string, name: string): string {
  const result = value ?? fallback;
  if (Array.from(result).length !== 1) throw new CsvkitDiagnostic(`TypeError: "${name}" must be a unicode character${name === "delimiter" ? "" : " or None"}, not a string of length ${Array.from(result).length}`);
  return result;
}

function dialectCharacters(dialect: CsvDialect): { delimiter: string; quote: string; escape: string | undefined } {
  const quoting = dialect.quoting ?? (dialect.quotechar === null ? 3 : 0);
  if (!Number.isInteger(quoting) || quoting < 0 || quoting > 5) throw new CsvkitDiagnostic('TypeError: bad "quoting" value');
  if (dialect.quotechar === null && quoting !== 3) throw new CsvkitDiagnostic("TypeError: quotechar must be set if quoting enabled");
  const delimiter = character(dialect.delimiter, ",", "delimiter");
  const quote = dialect.quotechar === null ? "" : character(dialect.quotechar, '"', "quotechar");
  const escape = dialect.escapechar === undefined || dialect.escapechar === null ? undefined : character(dialect.escapechar, "", "escapechar");
  for (const [name, value] of [["delimiter", delimiter], ["quotechar", quote], ["escapechar", escape]] as const) {
    if (value === "\r" || value === "\n" || name !== "delimiter" && value === " " && dialect.skipinitialspace)
      throw new CsvkitDiagnostic(`ValueError: bad ${name} value`);
  }
  if (delimiter === quote) throw new CsvkitDiagnostic("ValueError: bad delimiter or quotechar value");
  if (delimiter === escape) throw new CsvkitDiagnostic("ValueError: bad delimiter or escapechar value");
  if (escape === quote) throw new CsvkitDiagnostic("ValueError: bad escapechar or quotechar value");
  return { delimiter, quote, escape };
}

/** CPython's non-strict CSV state machine over universally normalized text. */
function* parseCsv(dialect: CsvDialect, step: () => void, preserveNewlines = false, physicalLine?: () => number, admitRow: () => void = () => {}): Generator<CsvRecord<CsvCell> | undefined, void, string | null | undefined> {
  const { delimiter, quote, escape } = dialectCharacters(dialect);
  let state: "start" | "plain" | "quoted" | "after" | "escaped" | "quotedEscape" | "escapedNewline" = "start";
  let field = "";
  let length = 0;
  let cells: CsvCell[] = [];
  let wasQuoted = false;
  let line = 1;
  let active = false;
  let previousCR = false;
  let rowStarted = false;
  const append = (char: string) => {
    if (cells.length >= (dialect.columnBudget ?? Infinity)) throw new CsvkitBlocked("column budget exceeded");
    length++;
    if (length > (dialect.fieldBudget ?? Infinity)) throw new CsvkitBlocked("field character budget exceeded");
    if (length > (dialect.fieldLimit ?? 131072)) throw new CsvkitDiagnostic(`FieldSizeLimitError: CSV contains a field longer than the maximum length of ${dialect.fieldLimit ?? 131072} characters on line ${physicalLine?.() ?? line}. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.`);
    field += char;
  };
  const finish = () => {
    if (cells.length >= (dialect.columnBudget ?? Infinity)) throw new CsvkitBlocked("column budget exceeded");
    const quoting = dialect.quoting ?? 0;
    cells.push(!wasQuoted && !field && (quoting === 4 || quoting === 5) ? null :
      !wasQuoted && field && (quoting === 2 || quoting === 4) ? numericField(field) : field);
    field = ""; length = 0; state = "start"; wasQuoted = false;
  };
  let lastChar = "";
  while (true) {
    let char = yield undefined;
    if (char === null) break;
    if (char === undefined) {
      if (!rowStarted) { admitRow(); rowStarted = true; }
      previousCR = false;
      if (state === "escaped" || state === "quotedEscape") {
        append("\n");
        state = state === "escaped" ? "plain" : "quoted";
        continue;
      }
      // CPython's AFTER_ESCAPED_CRNL also ignores later empty iterator items.
      if (state === "escapedNewline") continue;
      if (state === "quoted") continue;
      if (active || cells.length || field) finish();
      yield { cells, line: physicalLine?.() ?? line };
      cells = []; state = "start"; active = false; rowStarted = false;
      continue;
    }
    lastChar = char;
    step();
    const pairedLF = previousCR && char === "\n";
    if (pairedLF && !preserveNewlines) { previousCR = false; continue; }
    if (!rowStarted) { admitRow(); rowStarted = true; }
    previousCR = char === "\r";
    if (previousCR && !preserveNewlines) char = "\n";
    const wasActive = active;
    active = true;
    if (state === "escaped" || state === "quotedEscape") {
      append(char);
      state = state === "escaped" ? char === "\n" || char === "\r" ? "escapedNewline" : "plain" : "quoted";
    } else if (state === "quoted") {
      if (char === escape) state = "quotedEscape";
      else if (char === quote) state = dialect.doublequote === false ? "plain" : "after";
      else append(char);
    } else if (state === "after" && char === quote) { append(char); state = "quoted"; }
    else if (char === "\n" || char === "\r") {
      if (wasActive || cells.length || field) finish();
      yield { cells, line: physicalLine?.() ?? line };
      cells = []; state = "start"; active = false; rowStarted = false;
    } else if (state === "start" && char === " " && dialect.skipinitialspace) { /* skip only ASCII spaces */ }
    else if (char === delimiter) finish();
    else if (state === "after") { append(char); state = "plain"; }
    else if (char === escape) state = "escaped";
    else if (state === "start" && char === quote && dialect.quoting !== 3) { state = "quoted"; wasQuoted = true; }
    // Ordinary text does not leave AFTER_ESCAPED_CRNL: its next iterator
    // boundary remains a continuation until a separator or escape changes state.
    else { append(char); if (state !== "escapedNewline") state = "plain"; }
    if ((char === "\n" || char === "\r") && !pairedLF) line++;
  }
  if (active) {
    if (state === "escaped" || state === "quotedEscape") append("\n");
    finish();
    yield { cells, line: physicalLine?.() ?? line - (lastChar === "\n" || lastChar === "\r" ? 1 : 0) };
  }
}

export function readCsv(text: string, dialect?: CsvDialect & { quoting?: 0 | 1 | 3 }, step?: () => void): Generator<CsvRecord>;
export function readCsv(text: string, dialect: CsvDialect, step?: () => void): Generator<CsvRecord<CsvCell>>;
export function* readCsv(text: string, dialect: CsvDialect = {}, step: () => void = () => {}): Generator<CsvRecord<CsvCell>> {
  const parser = parseCsv(dialect, step);
  parser.next();
  for (const char of text) {
    let next = parser.next(char);
    while (!next.done && next.value) { yield next.value; next = parser.next(null); }
  }
  const end = parser.next(null);
  if (!end.done && end.value) yield end.value;
}

/** Feed physical lines without collecting input; each yielded row pauses upstream.
 * Reserve a row before accumulating its fields, including empty physical rows.
 * Quoted/escaped continuations keep that reservation across physical lines. */
export function readCsvStream(lines: AsyncIterable<string>, dialect?: CsvDialect & { quoting?: 0 | 1 | 3 }, step?: () => void, admitRow?: () => void): AsyncGenerator<CsvRecord>;
export function readCsvStream(lines: AsyncIterable<string>, dialect: CsvDialect, step?: () => void, admitRow?: () => void): AsyncGenerator<CsvRecord<CsvCell>>;
export async function* readCsvStream(lines: AsyncIterable<string>, dialect: CsvDialect = {}, step: () => void = () => {}, admitRow: () => void = () => {}): AsyncGenerator<CsvRecord<CsvCell>> {
  let physicalLine = 0;
  const parser = parseCsv(dialect, step, true, () => physicalLine, admitRow);
  parser.next();
  try {
    for await (const text of lines) {
      physicalLine++;
      let offset = 0;
      let completed = false;
      for (const char of text) {
        offset += char.length;
        const next = parser.next(char);
        if (!next.done && next.value) {
          for (const trailing of text.slice(offset)) if (trailing !== "\n" && trailing !== "\r")
            throw new CsvkitDiagnostic("Error: new-line character seen in unquoted field - do you need to open the file with newline=''?");
          yield next.value;
          parser.next(null);
          completed = true;
          break;
        }
      }
      if (!completed) {
        const boundary = parser.next(undefined);
        if (!boundary.done && boundary.value) {
          yield boundary.value;
          parser.next(null);
        }
      }
    }
    const end = parser.next(null);
    if (!end.done && end.value) yield end.value;
  } finally { parser.return(); }
}

/** Canonical Python str values supplied by typed engines, without JS precision loss. */
export type CsvWriteCell = string | number | bigint | boolean | null |
  { readonly kind: "decimal" | "float" | "date" | "datetime"; readonly value: string } |
  { readonly kind: "timedelta"; readonly microseconds: bigint };

export function pythonValueText(value: CsvWriteCell): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (!Number.isFinite(value)) return value < 0 ? "-inf" : "inf";
    if (Object.is(value, -0)) return "-0.0";
  }
  if (typeof value !== "object") return String(value);
  if (value.kind !== "timedelta") return value.value;
  const day = 86400000000n;
  let days = value.microseconds / day;
  let remainder = value.microseconds % day;
  if (remainder < 0n) { days--; remainder += day; }
  if (days < -999999999n || days > 999999999n) throw new CsvkitDiagnostic("OverflowError: timedelta days out of range");
  const seconds = remainder / 1000000n;
  const micros = remainder % 1000000n;
  const time = `${seconds / 3600n}:${String(seconds / 60n % 60n).padStart(2, "0")}:${String(seconds % 60n).padStart(2, "0")}`;
  return (days ? `${days} day${days === 1n || days === -1n ? "" : "s"}, ` : "") + time +
    (micros ? `.${String(micros).padStart(6, "0")}` : "");
}

/** Agate normalizes embedded CR in string cells before CPython serialization. */
export function writeCsvRow(row: readonly CsvWriteCell[], dialect: CsvDialect = {}, normalizeStrings = true,
  admission?: { readonly step: () => void; readonly admit: (bytes: number, codeUnits: number) => void }): string {
  const { delimiter, quote, escape } = dialectCharacters(dialect);
  const end = dialect.lineterminator ?? "\n";
  const quoting = dialect.quoting ?? (dialect.quotechar === null ? 3 : 0);
  function* fragments(): Generator<string> {
  for (let index = 0; index < row.length; index++) {
    const value = row[index]!;
    const field = pythonValueText(value);
    const normalized = typeof value === "string" && normalizeStrings;
    const numeric = typeof value === "number" || typeof value === "bigint" || typeof value === "boolean" || typeof value === "object" && (value?.kind === "decimal" || value?.kind === "float");
    let quoted = quoting === 1 || quoting === 2 && !numeric || quoting === 4 && typeof value === "string" || quoting === 5 && value !== null;
    for (const original of field) {
      admission?.step();
      const char = normalized && original === "\r" ? "\n" : original;
      const special = char === delimiter || char === quote || char === escape || char === "\r" || char === "\n" || end.includes(char);
      let escaped = char === escape;
      if (special && quoting === 3) escaped = true;
      else if (char === quote) {
        if (dialect.doublequote === false) escaped = true;
        if (!escaped) quoted = true;
      } else if (special && !escaped) quoted = true;
      if (escaped) {
        if (escape === undefined) throw new CsvkitDiagnostic("Error: need to escape, but no escapechar set");
      }
    }
    if (field === "" && delimiter === " " && dialect.skipinitialspace) {
      if (quoting === 3 || value === null && (quoting === 4 || quoting === 5))
        throw new CsvkitDiagnostic("Error: empty field must be quoted if delimiter is a space and skipinitialspace is true");
      quoted = true;
    }
    if (row.length === 1 && field === "" && !quoted) {
      if (quoting === 3 || value === null && (quoting === 4 || quoting === 5)) throw new CsvkitDiagnostic("Error: single empty field record must be quoted");
      quoted = true;
    }
    if (index) yield delimiter;
    if (quoted) yield quote;
    for (const original of field) {
      admission?.step();
      const char = normalized && original === "\r" ? "\n" : original;
      const special = char === delimiter || char === quote || char === escape || char === "\r" || char === "\n" || end.includes(char);
      if (char === escape || special && quoting === 3 || char === quote && dialect.doublequote === false) yield escape!;
      else if (char === quote) yield quote;
      yield char;
    }
    if (quoted) yield quote;
  }
  yield end;
  }
  if (admission) {
    let bytes = 0, codeUnits = 0, high = false;
    for (const fragment of fragments()) {
      codeUnits += fragment.length;
      for (const char of fragment) {
        admission.step();
        const code = char.codePointAt(0)!;
        bytes += high && code >= 0xdc00 && code <= 0xdfff ? 1 : code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
        high = code >= 0xd800 && code <= 0xdbff;
      }
    }
    // Finish native validation before budget selection; construct only admitted rows.
    admission.admit(bytes, codeUnits);
  }
  let result = "";
  for (const fragment of fragments()) result += fragment;
  return result;
}


export interface WriterOptions extends CsvDialect { readonly lineNumbers?: boolean }

/** Each writer owns its numbering and a frozen dialect snapshot. Output stays caller-owned. */
export class Writer {
  #rows = 0;
  readonly #options: WriterOptions;
  constructor(options: WriterOptions = {}) {
    dialectCharacters(options);
    this.#options = Object.freeze({ ...options });
  }
  writerow(row: readonly CsvWriteCell[]): string {
    const cells = this.#options.lineNumbers ? [this.#rows === 0 ? "line_number" : this.#rows, ...row] : row;
    // Agate advances numbering before serialization, including failed rows.
    if (this.#options.lineNumbers) this.#rows++;
    return writeCsvRow(cells, this.#options);
  }
  *writerows(rows: Iterable<readonly CsvWriteCell[]>): Generator<string> {
    for (const row of rows) yield this.writerow(row);
  }
}

export interface DictionaryWriterOptions extends WriterOptions {
  readonly restval?: CsvWriteCell;
  readonly extrasaction?: string;
}

export class DictionaryWriter {
  #rows = 0;
  readonly #fields: readonly string[];
  readonly #options: DictionaryWriterOptions;
  constructor(fieldnames: readonly string[], options: DictionaryWriterOptions = {}) {
    const action = options.extrasaction ?? "raise";
    if (!["raise", "ignore"].includes(action.toLowerCase()))
      throw new CsvkitDiagnostic(`ValueError: extrasaction (${action}) must be 'raise' or 'ignore'`);
    dialectCharacters(options);
    this.#options = Object.freeze({ ...options, extrasaction: action.toLowerCase() });
    this.#fields = Object.freeze(options.lineNumbers ? ["line_number", ...fieldnames] : [...fieldnames]);
  }
  writeheader(): string {
    return this.writerow(Object.fromEntries(this.#fields.map(field => [field, field])));
  }
  writerow(row: Readonly<Record<string, CsvWriteCell>>): string {
    const values = Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [key, typeof value === "string" ? value.split("\r").join("\n") : value]));
    if (this.#options.lineNumbers) {
      values.line_number = this.#rows === 0 ? "line_number" : this.#rows;
      this.#rows++;
    }
    if (this.#options.extrasaction === "raise") {
      const extra = Object.keys(values).filter(key => !this.#fields.includes(key));
      if (extra.length) throw new CsvkitDiagnostic(`ValueError: dict contains fields not in fieldnames: ${extra.map(repr).join(", ")}`);
    }
    return writeCsvRow(this.#fields.map(field => Object.hasOwn(values, field) ? values[field]! : this.#options.restval === undefined ? "" : this.#options.restval), this.#options, false);
  }
  *writerows(rows: Iterable<Readonly<Record<string, CsvWriteCell>>>): Generator<string> {
    for (const row of rows) yield this.writerow(row);
  }
}
