import { CsvkitBlocked, CsvkitDiagnostic } from "./errors.js";
import { decimalZeroes, integerWhitespace } from "./unicode-profile.js";
import { repr } from "./cli/lexical.js";

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

interface CsvStateMachine {
  feed(char: string | null | undefined): CsvRecord<CsvCell> | undefined;
  isIdle?(): boolean;
  advancePlainLine?(): void;
  readonly done: boolean;
}

/** CPython's non-strict CSV state machine over universally normalized text. */
function createCsvParser(dialect: CsvDialect, step: () => void, preserveNewlines = false, physicalLine?: () => number, admitRow: () => void = () => {}): CsvStateMachine {
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
  let finished = false;
  const append = (char: string) => {
    if (cells.length >= (dialect.columnBudget ?? Infinity)) throw new CsvkitBlocked("column budget exceeded");
    length++;
    if (length > (dialect.fieldBudget ?? Infinity)) throw new CsvkitBlocked("field character budget exceeded");
    if (length > (dialect.fieldLimit ?? Infinity)) throw new CsvkitDiagnostic(`FieldSizeLimitError: CSV contains a field longer than the maximum length of ${dialect.fieldLimit} characters on line ${physicalLine?.() ?? line}. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.`);
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
  return {
    get done() { return finished; },
    isIdle() { return !finished && !rowStarted && state === "start" && !previousCR && !active && cells.length === 0 && field.length === 0; },
    advancePlainLine() { lastChar = "\n"; line++; },
    feed(char: string | null | undefined): CsvRecord<CsvCell> | undefined {
      if (finished) return undefined;
      if (char === null) {
        finished = true;
        if (active) {
          if (state === "escaped" || state === "quotedEscape") append("\n");
          finish();
          const rec = { cells, line: physicalLine?.() ?? line - (lastChar === "\n" || lastChar === "\r" ? 1 : 0) };
          cells = [];
          return rec;
        }
        return undefined;
      }
      if (char === undefined) {
        if (!rowStarted) { admitRow(); rowStarted = true; }
        previousCR = false;
        if (state === "escaped" || state === "quotedEscape") {
          append("\n");
          state = state === "escaped" ? "plain" : "quoted";
          return undefined;
        }
        // CPython's AFTER_ESCAPED_CRNL also ignores later empty iterator items.
        if (state === "escapedNewline") return undefined;
        if (state === "quoted") return undefined;
        if (active || cells.length || field) finish();
        const rec = { cells, line: physicalLine?.() ?? line };
        cells = []; state = "start"; active = false; rowStarted = false;
        return rec;
      }
      lastChar = char;
      step();
      const pairedLF = previousCR && char === "\n";
      if (pairedLF && !preserveNewlines) { previousCR = false; return undefined; }
      if (!rowStarted) { admitRow(); rowStarted = true; }
      previousCR = char === "\r";
      if (previousCR && !preserveNewlines) char = "\n";
      const wasActive = active;
      active = true;
      let emitted: CsvRecord<CsvCell> | undefined;
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
        emitted = { cells, line: physicalLine?.() ?? line };
        cells = []; state = "start"; active = false; rowStarted = false;
      } else if (state === "start" && char === " " && dialect.skipinitialspace) { /* skip only ASCII spaces */ }
      else if (char === delimiter) finish();
      else if (state === "after") { append(char); state = "plain"; }
      else if (char === escape) state = "escaped";
      else if (state === "start" && char === quote && dialect.quoting !== 3) { state = "quoted"; wasQuoted = true; }
      else { append(char); if (state !== "escapedNewline") state = "plain"; }
      if ((char === "\n" || char === "\r") && !pairedLF) line++;
      return emitted;
    },
  };
}

export function readCsv(text: string, dialect?: CsvDialect & { quoting?: 0 | 1 | 3 }, step?: () => void): Generator<CsvRecord>;
export function readCsv(text: string, dialect: CsvDialect, step?: () => void): Generator<CsvRecord<CsvCell>>;
export function* readCsv(text: string, dialect: CsvDialect = {}, step: () => void = () => {}): Generator<CsvRecord<CsvCell>> {
  const parser = createCsvParser(dialect, step);
  for (const char of text) {
    const next = parser.feed(char);
    if (next) yield next;
  }
  const end = parser.feed(null);
  if (end) yield end;
}

/** Interactive readers discard the failing physical line and allow another next().
 * Keep the iterator outside the parser generator so a row diagnostic cannot close it. */
export function readCsvRecoverable(text: string, dialect: CsvDialect, step: () => void): Iterator<CsvRecord<CsvCell>> {
  let offset = 0;
  let lineEnd = 0;
  let line = 0;
  let done = false;
  let parser = createCsvParser(dialect, step, true, () => line);
  return {
    next(): IteratorResult<CsvRecord<CsvCell>> {
      if (done) return { done: true, value: undefined };
      try {
        while (offset < text.length) {
          if (offset === lineEnd) {
            line++;
            lineEnd = offset;
            while (lineEnd < text.length && text[lineEnd] !== "\n" && text[lineEnd] !== "\r") { step(); lineEnd++; }
            if (text[lineEnd] === "\r") lineEnd++;
            if (text[lineEnd] === "\n") lineEnd++;
          }
          const char = String.fromCodePoint(text.codePointAt(offset)!);
          offset += char.length;
          const next = parser.feed(char);
          if (next) {
            offset = lineEnd;
            return { done: false, value: next };
          }
        }
        done = true;
        const end = parser.feed(null);
        return end ? { done: false, value: end } : { done: true, value: undefined };
      } catch (failure) {
        if (failure instanceof CsvkitDiagnostic && !(failure instanceof CsvkitBlocked)) {
          offset = lineEnd;
          parser = createCsvParser(dialect, step, true, () => line);
        } else done = true;
        throw failure;
      }
    },
    return() {
      done = true;
      return { done: true, value: undefined };
    }
  };
}

/** Feed physical lines without collecting input; each yielded row pauses upstream.
 * Reserve a row before accumulating its fields, including empty physical rows.
 * Quoted/escaped continuations keep that reservation across physical lines. */
export function readCsvStream(lines: AsyncIterable<string>, dialect?: CsvDialect & { quoting?: 0 | 1 | 3 }, step?: () => void, admitRow?: () => void): AsyncGenerator<CsvRecord>;
export function readCsvStream(lines: AsyncIterable<string>, dialect: CsvDialect, step?: () => void, admitRow?: () => void): AsyncGenerator<CsvRecord<CsvCell>>;
export async function* readCsvStream(lines: AsyncIterable<string>, dialect: CsvDialect = {}, step: () => void = () => {}, admitRow: () => void = () => {}): AsyncGenerator<CsvRecord<CsvCell>> {
  let physicalLine = 0;
  const parser = createCsvParser(dialect, step, true, () => physicalLine, admitRow);
  const { delimiter, quote, escape } = dialectCharacters(dialect);
  const quoting = dialect.quoting ?? (dialect.quotechar === null ? 3 : 0);
  const canFastPlain = (quoting === 0 || quoting === 1 || quoting === 3) && !dialect.skipinitialspace && escape === undefined && delimiter.length === 1;
  const quoteCode = quote ? quote.charCodeAt(0) : -1;
  const colBudget = dialect.columnBudget ?? Infinity;
  const maxFieldLen = Math.min(dialect.fieldBudget ?? Infinity, dialect.fieldLimit ?? Infinity);
  try {
    for await (const text of lines) {
      physicalLine++;
      const len = text.length;
      if (canFastPlain && len >= 2 && len <= maxFieldLen && text.charCodeAt(len - 1) === 10 && parser.isIdle?.()) {
        let plainAscii = true;
        let fieldCount = 1;
        const delimCode = delimiter.charCodeAt(0);
        for (let i = 0; i < len - 1; i++) {
          const c = text.charCodeAt(i);
          if (c >= 0x80 || c === 13 || c === 10 || c === quoteCode) { plainAscii = false; break; }
          if (c === delimCode) fieldCount++;
        }
        if (plainAscii && fieldCount <= colBudget) {
          for (let i = 0; i < len; i++) step();
          admitRow();
          parser.advancePlainLine?.();
          yield { cells: text.slice(0, len - 1).split(delimiter), line: physicalLine };
          continue;
        }
      }
      let offset = 0;
      let completed = false;
      for (const char of text) {
        offset += char.length;
        const next = parser.feed(char);
        if (next) {
          for (const trailing of text.slice(offset)) if (trailing !== "\n" && trailing !== "\r")
            throw new CsvkitDiagnostic("Error: new-line character seen in unquoted field - do you need to open the file with newline=''?");
          yield next;
          completed = true;
          break;
        }
      }
      if (!completed) {
        const boundary = parser.feed(undefined);
        if (boundary) {
          yield boundary;
        }
      }
    }
    const end = parser.feed(null);
    if (end) yield end;
  } finally { /* no-op */ }
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
