import { PythonTextDecoder } from "./text-decoder.js";
import { yieldTurn } from "safe-bash-contracts/yield";
/** Original bounded CSV reader; UTF-8-sig, Python-style permissive quote closure profile. */
export class CsvError extends Error {
  constructor(
    readonly code: "ARGUMENT" | "REGEX" | "INPUT" | "LIMIT" | "UNSUPPORTED",
    message: string
  ) {
    super(message);
  }
}
export interface CsvLimits {
  inputBytes: number;
  decodedBytes: number;
  retainedBytes: number;
  outputBytes: number;
  work: number;
  fieldBytes: number;
  cells: number;
  scannedCells: number;
  patternBytes: number;
  setEntries: number;
  setBytes: number;
  argumentBytes: number;
}
export const defaultCsvLimits: Readonly<CsvLimits> = Object.freeze({
  inputBytes: Infinity,
  decodedBytes: Infinity,
  retainedBytes: Infinity,
  outputBytes: Infinity,
  work: Infinity,
  fieldBytes: Infinity,
  cells: Infinity,
  scannedCells: Infinity,
  patternBytes: Infinity,
  setEntries: Infinity,
  setBytes: Infinity,
  argumentBytes: Infinity
});
export class CsvBudget {
  private disposed = false;
  private lastYieldWork = 0;
  private aborted = false;
  private readonly onAbort = (): void => { this.aborted = true; };
  private readonly pollSignal: boolean;
  readonly limits: Readonly<CsvLimits>;
  private readonly usage = {
    inputBytes: 0,
    decodedBytes: 0,
    retainedBytes: 0,
    peakRetainedBytes: 0,
    outputBytes: 0,
    work: 0,
    cells: 0,
    scannedCells: 0,
    patternBytes: 0,
    setEntries: 0,
    setBytes: 0,
    argumentBytes: 0
  };
  /** Immutable observations cannot change the invocation's quota ledger. */
  get accounting(): Readonly<typeof this.usage> {
    return Object.freeze({ ...this.usage });
  }
  getUsage(key: keyof typeof this.usage): number {
    return this.usage[key];
  }
  async checkpoint(): Promise<void> {
    this.signal.throwIfAborted();
    if (this.usage.work - this.lastYieldWork < 4096) return;
    this.lastYieldWork = this.usage.work;
    await yieldTurn(this.signal);
    this.signal.throwIfAborted();
  }
  remaining(key: Exclude<keyof CsvLimits, "fieldBytes">): number {
    return this.limits[key] - this.usage[key];
  }
  constructor(
    limits: Partial<CsvLimits>,
    readonly signal: AbortSignal
  ) {
    const resolved = { ...defaultCsvLimits, ...limits };
    for (const name of Object.keys(defaultCsvLimits) as (keyof CsvLimits)[]) {
      if (resolved[name] === undefined) resolved[name] = defaultCsvLimits[name];
    }
    this.limits = Object.freeze(resolved);
    for (const value of Object.values(this.limits))
      if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0))
        throw new CsvError("ARGUMENT", "CSV limits must be nonnegative safe integers");
    this.aborted = signal.aborted;
    if (typeof signal.addEventListener === "function") {
      this.pollSignal = false;
      if (!this.aborted) {
        signal.addEventListener("abort", this.onAbort, { once: true });
      }
    } else {
      this.pollSignal = true;
    }
  }
  chargeWorkAndRetained(workAmount: number, retainedAmount: number): void {
    if (this.disposed) throw new CsvError("INPUT", "CSV budget is disposed");
    if (this.aborted || (this.pollSignal && this.signal.aborted))
      this.signal.throwIfAborted();
    if (workAmount > this.limits.work - this.usage.work)
      throw new CsvError("LIMIT", "work limit exceeded");
    this.usage.work += workAmount;
    if (retainedAmount > this.limits.retainedBytes - this.usage.retainedBytes)
      throw new CsvError("LIMIT", "retainedBytes limit exceeded");
    this.usage.retainedBytes += retainedAmount;
    if (this.usage.retainedBytes > this.usage.peakRetainedBytes)
      this.usage.peakRetainedBytes = this.usage.retainedBytes;
  }
  chargeAppend(newFieldLen: number, appendedUnits: number): void {
    if (this.disposed) throw new CsvError("INPUT", "CSV budget is disposed");
    if (this.aborted || (this.pollSignal && this.signal.aborted))
      this.signal.throwIfAborted();
    const bytes = appendedUnits * 2;
    if (newFieldLen * 2 > this.limits.fieldBytes) throw new CsvError("LIMIT", "Field byte limit exceeded");
    if (appendedUnits > this.limits.work - this.usage.work) throw new CsvError("LIMIT", "work limit exceeded");
    this.usage.work += appendedUnits;
    if (bytes > this.limits.retainedBytes - this.usage.retainedBytes) throw new CsvError("LIMIT", "retainedBytes limit exceeded");
    this.usage.retainedBytes += bytes;
    if (this.usage.retainedBytes > this.usage.peakRetainedBytes)
      this.usage.peakRetainedBytes = this.usage.retainedBytes;
  }
  charge(key: keyof CsvLimits, amount: number): void {
    if (this.disposed) throw new CsvError("INPUT", "CSV budget is disposed");
    if (this.aborted || (this.pollSignal && this.signal.aborted))
      this.signal.throwIfAborted();
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new CsvError("ARGUMENT", "Invalid resource charge");
    if (key === "fieldBytes") {
      if (amount > this.limits.fieldBytes) throw new CsvError("LIMIT", "Field byte limit exceeded");
      return;
    }
    if (amount > this.limits[key] - this.usage[key])
      throw new CsvError("LIMIT", `${key} limit exceeded`);
    this.usage[key] += amount;
    if (key === "retainedBytes")
      this.usage.peakRetainedBytes = Math.max(
        this.usage.peakRetainedBytes,
        this.usage.retainedBytes
      );
  }
  /** Conservative allocation ledger: no allocation credit is reused during an invocation. */
  text(text: string): void {
    this.charge("retainedBytes", text.length * 2);
  }
  dispose(): void {
    this.signal.removeEventListener?.("abort", this.onAbort);
    this.disposed = true;
    this.usage.retainedBytes = 0;
  }
}
export interface CsvDialect {
  /** Strict-v1 is an isolation profile, not Python csvkit's permissive reader. */
  profile?: "utf8-sig-permissive-v1" | "utf8-sig-strict-v1";
  delimiter?: string;
  tabs?: boolean;
  quote?: string;
  escape?: string;
  doubleQuote?: boolean;
  skipInitialSpace?: boolean;
  skipLines?: number;
  quoting?: 0 | 1 | 2 | 3 | 4 | 5;
  encoding?: string;
  fieldCharacters?: number;
}
export interface CsvRow {
  /** Text representation: numeric modes use float text; null and empty fields both become empty strings. */
  readonly cells: readonly string[];
  readonly line: number;
}
/** Synchronous field events for callers that spool payloads instead of retaining
 * complete rows. Text fragments contain at most 2049 UTF-16 code units. */
export interface CsvFieldEvents {
  text(value: string): void;
  field(): void;
  row(line: number): void;
}
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), "byteLength"
)!.get!;
export class CsvParser {
  private readonly decoder: PythonTextDecoder;
  private readonly encoding: string;
  private fieldCharacters = 0;
  private fieldUnits = 0;
  private notifying = false;
  private quotedField = false;
  private readonly delimiter: string;
  private field = "";
  private row: string[] = [];
  private state: "start" | "plain" | "quoted" | "closed" = "start";
  private escaped = false;
  private line = 1;
  private lastLine = 1;
  private cr = false;
  private active = false;
  private ended = false;
  private skipped = 0;
  constructor(
    private readonly dialect: CsvDialect,
    private readonly budget: CsvBudget,
    private readonly events?: CsvFieldEvents
  ) {
    if (events && (dialect.quoting === 2 || dialect.quoting === 4))
      throw new CsvError("ARGUMENT", "Streaming field events do not perform numeric field conversion");
    this.dialect = Object.freeze({ ...dialect });
    this.encoding = (dialect.encoding ?? "utf-8-sig").toLowerCase().replaceAll("_", "-");
    if (!["utf-8-sig", "utf8-sig", "utf-8", "utf8", "ascii", "us-ascii", "latin1", "latin-1", "iso-8859-1"].includes(this.encoding))
      throw new CsvError("UNSUPPORTED", "Unsupported CSV encoding");
    this.decoder = new PythonTextDecoder(this.encoding);
    if (dialect.fieldCharacters !== undefined && (!Number.isSafeInteger(dialect.fieldCharacters) || dialect.fieldCharacters < 0))
      throw new CsvError("ARGUMENT", "Field size must be a nonnegative safe integer");
    this.delimiter = dialect.tabs ? "\t" : (dialect.delimiter ?? ",");
    budget.charge("work", 0);
    if (dialect.profile !== undefined && dialect.profile !== "utf8-sig-permissive-v1" && dialect.profile !== "utf8-sig-strict-v1")
      throw new CsvError("UNSUPPORTED", "Unsupported CSV reader profile");
    if (dialect.quoting !== undefined && ![0, 1, 2, 3, 4, 5].includes(dialect.quoting))
      throw new CsvError("UNSUPPORTED", "Only quoting modes 0 through 5 are supported");
    for (const char of [
      this.delimiter,
      dialect.quote ?? '"',
      ...(dialect.escape === undefined ? [] : [dialect.escape])
    ]) {
      const scalar = char.codePointAt(0);
      if (scalar === undefined || char.length !== (scalar > 0xffff ? 2 : 1) ||
          (scalar >= 0xd800 && scalar <= 0xdfff) || char === "\r" || char === "\n" || char === "\0")
        throw new CsvError(
          "ARGUMENT",
          "CSV dialect characters must be single non-newline Unicode scalars"
        );
    }
    if (
      dialect.skipLines !== undefined &&
      (!Number.isSafeInteger(dialect.skipLines) || dialect.skipLines < 0)
    )
      throw new CsvError("ARGUMENT", "Skip lines must be nonnegative");
  }
  /** Consume a borrowed producer chunk in bounded units before its next pull. */
  async *pushAsync(bytes: Uint8Array): AsyncGenerator<CsvRow> {
    for (let offset = 0; offset < bytes.byteLength; offset += 4096) {
      await yieldTurn(this.budget.signal);
      this.budget.signal.throwIfAborted();
      yield* this.push(bytes.subarray(offset, offset + 4096));
    }
  }

  push(bytes: Uint8Array): CsvRow[] {
    if (this.notifying) throw new CsvError("INPUT", "CSV event callback cannot reenter the parser");
    if (this.ended) throw new CsvError("INPUT", "CSV parser is closed");
    this.budget.charge("work", 0);
    let byteLength: number;
    try {
      byteLength = typedArrayByteLength.call(bytes) as number;
    } catch {
      throw new CsvError("INPUT", "Invalid CSV byte chunk");
    }
    this.budget.charge("inputBytes", byteLength);
    this.budget.charge("work", byteLength + 1);
    // Admission before decoder allocation; UTF-16 output is at most two bytes per input byte plus buffered scalar.
    this.budget.charge("retainedBytes", byteLength * 2 + 8);
    let text: string;
    try {
      text = this.decoder.decode(bytes, { stream: true });
    } catch (error) {
      throw new CsvError("INPUT", error instanceof Error ? error.message : "Invalid UTF-8 input");
    }
    this.budget.charge("decodedBytes", text.length * 2);
    return this.consume(text);
  }
  end(): CsvRow[] {
    if (this.notifying) throw new CsvError("INPUT", "CSV event callback cannot reenter the parser");
    if (this.ended) throw new CsvError("INPUT", "CSV parser is closed");
    this.budget.charge("work", 0);
    this.ended = true;
    let tail: string;
    try {
      tail = this.decoder.decode();
    } catch {
      throw new CsvError("INPUT", "Truncated UTF-8 input");
    }
    this.budget.charge("decodedBytes", tail.length * 2);
    const rows = this.consume(tail);
    if (this.dialect.profile === "utf8-sig-strict-v1" && (this.escaped || this.state === "quoted"))
      throw new CsvError("INPUT", "Unterminated CSV quoted field or escape");
    if (this.escaped) this.append("\n"); // permissive reader escape at EOF profile, qualification open
    if (this.active || this.row.length || this.field.length) {
      this.finishField();
      const row = this.finishRow(this.lastLine);
      if (!this.events) rows.push(row);
    }
    return rows;
  }
  /** Releases parser-owned fields; returned rows remain owned by the caller. */
  dispose(): void {
    if (this.notifying) throw new CsvError("INPUT", "CSV event callback cannot reenter the parser");
    this.ended = true;
    this.field = "";
    this.row = [];
    this.escaped = false;
    this.active = false;
  }
  private append(char: string): void {
    if (++this.fieldCharacters > (this.dialect.fieldCharacters ?? Infinity)) throw new CsvError("INPUT", "Field character limit exceeded");
    this.budget.chargeAppend(this.fieldUnits + char.length, char.length);
    this.fieldUnits += char.length;
    this.field += char;
    if (this.events && this.field.length >= 2048) this.flushFieldText();
  }
  private notify(callback: () => void): void {
    this.budget.signal.throwIfAborted();
    this.notifying = true;
    try { callback(); } finally { this.notifying = false; }
  }
  private flushFieldText(): void {
    if (!this.field) return;
    const value = this.field;
    this.field = "";
    this.notify(() => this.events!.text(value));
  }
  private finishField(): void {
    this.budget.charge("cells", 1);
    this.budget.charge("retainedBytes", 32);
    let value = this.field;
    if ((this.dialect.quoting === 2 || this.dialect.quoting === 4) && !this.quotedField && value.length) {
      this.budget.charge("work", value.length);
      const raw = value.trim().toLowerCase();
      const unsigned = raw.startsWith("+") || raw.startsWith("-") ? raw.slice(1) : raw;
      const negative = raw.startsWith("-");
      if (["inf", "infinity", "nan"].includes(unsigned)) value = unsigned === "nan" ? "nan" : negative ? "-inf" : "inf";
      else {
        const digit = (char: string | undefined): boolean => char !== undefined && char >= "0" && char <= "9";
        for (let i = 0; i < raw.length; i++) {
          const char = raw[i]!;
          if (char === "_" && !(digit(raw[i - 1]) && digit(raw[i + 1])) ||
              !digit(char) && !".+-e_".includes(char)) throw new CsvError("INPUT", "Could not convert unquoted field to float");
        }
        const number = Number(raw.replaceAll("_", ""));
        if (!raw || Number.isNaN(number)) throw new CsvError("INPUT", "Could not convert unquoted field to float");
        const absolute = Math.abs(number);
        if (!Number.isFinite(number)) value = number < 0 ? "-inf" : "inf";
        else if (absolute !== 0 && (absolute < 1e-4 || absolute >= 1e16)) {
          const [mantissa, exponent] = number.toExponential().split("e") as [string, string];
          value = mantissa + "e" + exponent[0] + exponent.slice(1).padStart(2, "0");
        } else value = Object.is(number, -0) ? "-0.0" : Number.isInteger(number) ? number.toFixed(1) : String(number);
      }
      this.budget.charge("retainedBytes", value.length * 2);
    }
    if (this.events) {
      this.flushFieldText();
      this.notify(() => this.events!.field());
    } else this.row.push(value);
    this.fieldCharacters = 0;
    this.fieldUnits = 0;
    this.quotedField = false;
    this.field = "";
    this.state = "start";
  }
  private finishRow(line: number): CsvRow {
    this.budget.charge("retainedBytes", 64);
    const row = { cells: this.row, line };
    this.row = [];
    this.active = false;
    if (this.events) this.notify(() => this.events!.row(line));
    return row;
  }
  private consume(text: string): CsvRow[] {
    const rows: CsvRow[] = [];
    for (let idx = 0; idx < text.length; idx++) {
      const code = text.charCodeAt(idx);
      let char: string;
      if (code >= 0xd800 && code <= 0xdbff && idx + 1 < text.length) {
        const low = text.charCodeAt(idx + 1);
        if (low >= 0xdc00 && low <= 0xdfff) { char = text.slice(idx, idx + 2); idx++; }
        else char = text[idx]!;
      } else char = text[idx]!;
      this.budget.chargeWorkAndRetained(1, 0);
      if (char === "\0" && this.dialect.profile === "utf8-sig-strict-v1")
        throw new CsvError("INPUT", "NUL is unsupported by strict-v1");
      const newline = char === "\r" || char === "\n",
        paired = char === "\n" && this.cr;
      const physicalLine = this.line;
      this.cr = char === "\r";
      if (this.skipped < (this.dialect.skipLines ?? 0)) {
        if (newline && !paired) this.skipped++;
        continue;
      }
      this.lastLine = paired ? physicalLine - 1 : physicalLine;
      if (newline && !paired) this.line++;
      if (paired && this.state !== "quoted" && !this.escaped) continue;
      if (this.escaped) {
        this.append(char);
        if (this.state === "start" && this.dialect.profile === "utf8-sig-strict-v1") this.state = "plain";
        this.escaped = false;
        this.active = true;
        continue;
      }
      if (char === this.dialect.escape) {
        if (this.dialect.profile === "utf8-sig-strict-v1" && this.state === "closed")
          throw new CsvError("INPUT", "Escape after closing quote");
        this.escaped = true;
        this.active = true;
        continue;
      }
      const quote = this.dialect.quoting === 3 ? undefined : (this.dialect.quote ?? '"');
      if (this.state === "quoted") {
        if (char === quote) this.state = "closed";
        else this.append(char);
        continue;
      }
      if (this.state === "closed" && char === quote && this.dialect.doubleQuote !== false) {
        this.append(char);
        this.state = "quoted";
        this.quotedField = true;
        continue;
      }
      if (this.dialect.profile === "utf8-sig-strict-v1" && this.state === "closed" && !newline && char !== this.delimiter)
        throw new CsvError("INPUT", "Unexpected character after closing quote");
      if (newline) {
        if (this.active || this.row.length || this.field.length) this.finishField();
        const row = this.finishRow(physicalLine);
        if (!this.events) rows.push(row);
        continue;
      }
      this.active = true;
      if (char === this.delimiter) {
        this.finishField();
        continue;
      }
      if (this.state === "start" && char === " " && this.dialect.skipInitialSpace) continue;
      if (this.state === "start" && char === quote) {
        this.state = "quoted";
        this.quotedField = true;
        continue;
      }
      if (this.dialect.profile === "utf8-sig-strict-v1" && char === quote)
        throw new CsvError("INPUT", "Quote inside unquoted field");
      this.state = "plain";
      this.append(char);
    }
    return rows;
  }
}
function decimalPosition(token: string): number | undefined {
  let start = 0,
    end = token.length;
  const space = (char: string): boolean => char === " " || (char >= "\t" && char <= "\r");
  while (start < end && space(token[start]!)) start++;
  while (end > start && space(token[end - 1]!)) end--;
  const first = start;
  if (token[start] === "+" || token[start] === "-") start++;
  if (start === end) return undefined;
  for (let i = start; i < end; i++) if (token[i]! < "0" || token[i]! > "9") return undefined;
  const value = Number(token.slice(first, end));
  return value; // Syntactically numeric selectors stay positional even beyond JS precision.
}
export function selectColumns(
  selector: string,
  headers: readonly string[],
  zero: boolean,
  budget: CsvBudget,
  policy?: { readonly profile: "csvkit-2.2.0-ascii-v1"; readonly exclude?: boolean },
  numericOffset = 0
): number[] {
  budget.text(selector);
  budget.charge("work", selector.length);
  const result: number[] = [];
  const names = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]!;
    budget.charge("work", header.length * 2 + 1);
    budget.charge("retainedBytes", 64);
    if (!names.has(header)) names.set(header, i);
  }
  const position = (token: string): number => {
    budget.charge("work", token.length + 1);
    const numeric = decimalPosition(token);
    const number = numeric === undefined ? (names.get(token) ?? -1) : numeric - (zero ? 0 : 1) + numericOffset;
    if (number < (numeric === undefined ? 0 : numericOffset) || number >= headers.length)
      throw new CsvError("INPUT", `Column ${token} does not exist`);
    return number === 0 ? 0 : number;
  };
  budget.charge("retainedBytes", selector.length * 40 + 32);
  for (const token of selector.split(",")) {
    budget.charge("retainedBytes", token.length * 2 + 32);
    if (token === "" && !policy?.exclude && !(policy && names.has(token)))
      throw new CsvError("INPUT", "Empty column selector");
    const numeric = decimalPosition(token);
    const index = numeric === undefined ? -1 : numeric - (zero ? 0 : 1) + numericOffset;
    if (policy && index >= numericOffset && index < headers.length) {
      result.push(position(token));
      continue;
    }
    if (names.has(token) && numeric === undefined) {
      result.push(position(token));
      continue;
    }
    if (policy && (token.includes(":") || token.includes("-"))) {
      const parts = token.split(token.includes(":") ? ":" : "-");
      if (parts.length !== 2) throw new CsvError("INPUT", "Invalid column range");
      const startToken = parts[0] || "1";
      // Preserve release 2.2.0's exclusion open-end defect independently.
      const endToken = parts[1] || String(headers.length - numericOffset + (policy.exclude ? -1 : 0));
      if (decimalPosition(startToken) === undefined || decimalPosition(endToken) === undefined)
        throw new CsvError("INPUT", "Column range endpoints must be integers");
      const start = position(startToken), end = position(endToken);
      for (let index = start; index <= end; index++) {
        budget.charge("work", 1);
        budget.charge("retainedBytes", 8);
        result.push(index);
      }
    } else if (token.includes("-")) {
      const parts = token.split("-");
      if (parts.length !== 2 || !parts[1])
        throw new CsvError("UNSUPPORTED", "Open column ranges are not qualified");
      const start = position(parts[0] || (zero ? "0" : "1")),
        end = position(parts[1]);
      if (end < start) throw new CsvError("INPUT", "Reversed column range");
      for (let index = start; index <= end; index++) {
        budget.charge("work", 1);
        budget.charge("retainedBytes", 8);
        result.push(index);
      }
    } else {
      if (policy?.exclude && (numeric === undefined ? !names.has(token) : index < numericOffset || index >= headers.length)) continue;
      result.push(position(token));
    }
  }
  return result;
}
export interface CsvSelection {
  readonly include?: string;
  readonly exclude?: string;
  readonly zero?: boolean;
}
/** Candidate csvkit release contract: ASCII numeric syntax, no inference. */
export function resolveColumns(selection: CsvSelection, headers: readonly string[], budget: CsvBudget): number[] {
  budget.charge("work", 0);
  const zero = selection.zero ?? false;
  let included: number[];
  if (selection.include) included = selectColumns(selection.include, headers, zero, budget, { profile: "csvkit-2.2.0-ascii-v1" });
  else {
    included = [];
    for (let index = 0; index < headers.length; index++) {
      budget.charge("work", 1);
      budget.charge("retainedBytes", 8);
      included.push(index);
    }
  }
  if (!selection.exclude) return included;
  const excluded = selectColumns(selection.exclude, headers, zero, budget, { profile: "csvkit-2.2.0-ascii-v1", exclude: true });
  budget.charge("retainedBytes", excluded.length * 40 + included.length * 8);
  budget.charge("work", excluded.length + included.length);
  const removed = new Set(excluded);
  return included.filter(index => !removed.has(index));
}
export function serializeRow(cells: readonly string[], budget: CsvBudget): string {
  let result = "";
  for (let i = 0; i < cells.length; i++) {
    const raw = cells[i]!;
    let field = "",
      quoted = false,
      simple = true;
    for (let k = 0; k < raw.length; k++) {
      const c = raw.charCodeAt(k);
      if (c === 13 || c === 34 || (c >= 0xd800 && c <= 0xdfff)) { simple = false; break; }
      if (c === 44 || c === 10) quoted = true;
    }
    if (simple) {
      const n = raw.length;
      if (n > 0) {
        budget.chargeWorkAndRetained(n, n * 2);
      }
      field = raw;
    } else {
      quoted = false;
      for (const original of raw) {
        budget.charge("work", original.length);
        const char = original === "\r" ? "\n" : original;
        if (char === "," || char === '"' || char === "\n") quoted = true;
        const addition = char === '"' ? '""' : char;
        budget.charge("retainedBytes", addition.length * 2);
        field += addition;
      }
    }
    if (cells.length === 1 && field === "") quoted = true;
    const addition = (i ? "," : "") + (quoted ? '"' + field + '"' : field);
    budget.charge("retainedBytes", addition.length * 2);
    budget.charge("work", addition.length);
    result += addition;
  }
  budget.charge("retainedBytes", (result.length + 1) * 2);
  return result + "\n";
}
export function generatedHeaders(count: number, budget: CsvBudget): string[] {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new CsvError("ARGUMENT", "Header count must be a nonnegative safe integer");
  budget.charge("work", 0);
  const headers: string[] = [];
  for (let i = 0; i < count; i++) {
    const char = String.fromCharCode(97 + (i % 26)),
      length = Math.floor(i / 26) + 1;
    budget.charge("work", length);
    budget.charge("retainedBytes", 32 + length * 2);
    headers.push(char.repeat(length));
  }
  return headers;
}
