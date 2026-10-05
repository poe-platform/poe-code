/*! Numeric recovery and malformed-command handling adapted from Mozilla PDF.js.
 * Copyright 2017 Mozilla Foundation. Licensed under Apache-2.0.
 * See licenses/PDFJS-APACHE-2.0.txt and THIRD_PARTY_NOTICES.md.
 */
import { CompactPdfNumber } from "./compact-number.js";
import {
  formatPdfNumber,
  type ByteSpan,
  type PdfPixelStorage,
  type PdfStoredBytes
} from "../ast.js";
import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";

export type CosToken =
  | { readonly kind: "boolean"; readonly value: boolean; readonly span: ByteSpan }
  | { readonly kind: "null"; readonly span: ByteSpan }
  | {
      readonly kind: "number";
      readonly value: number;
      readonly raw: string;
      readonly isInteger: boolean;
      readonly span: ByteSpan;
    }
  | {
      readonly kind: "name";
      readonly decoded: string;
      readonly rawBytes: Uint8Array;
      readonly span: ByteSpan;
    }
  | {
      readonly kind: "string";
      readonly bytes: Uint8Array;
      readonly byteLength?: number;
      readonly storedBytes?: PdfStoredBytes;
      readonly span: ByteSpan;
    }
  | {
      readonly kind: "hex-string";
      readonly bytes: Uint8Array;
      readonly byteLength?: number;
      readonly storedBytes?: PdfStoredBytes;
      readonly span: ByteSpan;
    }
  | { readonly kind: "array-start"; readonly span: ByteSpan }
  | { readonly kind: "array-end"; readonly span: ByteSpan }
  | { readonly kind: "dict-start"; readonly span: ByteSpan }
  | { readonly kind: "dict-end"; readonly span: ByteSpan }
  | { readonly kind: "keyword"; readonly value: string; readonly truncated?: true; readonly span: ByteSpan };

export function isPdfWhitespace(byte: number): boolean {
  return (
    byte === 0x00 ||
    byte === 0x09 ||
    byte === 0x0a ||
    byte === 0x0c ||
    byte === 0x0d ||
    byte === 0x20
  );
}

export function isPdfDelimiter(byte: number): boolean {
  return (
    byte === 0x28 ||
    byte === 0x29 ||
    byte === 0x3c ||
    byte === 0x3e ||
    byte === 0x5b ||
    byte === 0x5d ||
    byte === 0x7b ||
    byte === 0x7d ||
    byte === 0x2f ||
    byte === 0x25
  );
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

type LexWork<T> = Generator<number | Uint8Array, T, Uint8Array>;
type StringMode = "buffer" | "count" | "stream";

/** The same escape grammar can collect, measure, or emit decoded bytes. */
class StringOutput {
  length = 0;
  private readonly values: number[] | undefined;
  private readonly chunk: Uint8Array | undefined;
  private used = 0;
  private sent = 0;
  constructor(
    private readonly mode: StringMode,
    private readonly maximum: number,
    private readonly label: string,
    private readonly admit?: (bytes: number) => void
  ) {
    if (mode === "buffer") this.values = [];
    if (mode === "stream") this.chunk = new Uint8Array(4096);
  }
  *append(value: number): LexWork<void> {
    if (this.length >= this.maximum)
      throw new PdfError("E_LIMIT", `PDF ${this.label} string exceeds maximum byte length`);
    this.length++;
    if (this.values) {
      this.admit?.(32);
      this.values.push(value);
    } else if (this.chunk) {
      this.chunk[this.used++] = value;
      if (this.used === this.chunk.length) {
        yield this.chunk;
        this.sent += this.used;
        this.used = 0;
      }
    }
  }
  truncate(length: number): void {
    this.length = length;
    if (this.values) this.values.length = length;
    this.used = Math.max(0, length - this.sent);
  }
  *finish(): LexWork<Uint8Array> {
    if (this.chunk && this.used) yield this.chunk.subarray(0, this.used);
    return this.values ? Uint8Array.from(this.values) : new Uint8Array();
  }
}

/** One grammar for buffered and retained-range input. It suspends only on a
 * missing input window, never once per byte on the asynchronous path. */
class CosLexerState {
  private window: Uint8Array;
  private windowStart = 0;
  pos: number;
  readonly end: number;
  readonly maxTokenBytes: number;
  private readonly keywordLimit: number;

  constructor(
    bytes: Uint8Array,
    start = 0,
    end = bytes.length,
    maxTokenBytes = Infinity,
    readonly knownCommands?: ReadonlySet<string>,
    private readonly onTokenAllocation?: (bytes: number) => void,
    public stringMode: StringMode = "buffer",
    private readonly compactNumbers = false,
    compactKeywords = false
  ) {
    this.window = bytes;
    this.pos = start;
    this.end = end;
    this.maxTokenBytes = maxTokenBytes;
    let keywordLimit = compactKeywords ? 64 : Infinity;
    if(compactKeywords)for(const command of knownCommands ?? [])keywordLimit=Math.max(keywordLimit,command.length);
    this.keywordLimit=keywordLimit;
  }

  private *byte(position: number): LexWork<number | undefined> {
    if (position < 0 || position >= this.end) return undefined;
    if (position < this.windowStart || position >= this.windowStart + this.window.length) {
      const bytes = yield position;
      if (bytes.length === 0) throw new PdfError("E_PARSE", "Unexpected EOF in PDF token");
      this.window = bytes;
      this.windowStart = position;
    }
    return this.window[position - this.windowStart];
  }

  private *spanBytes(start: number, end: number): LexWork<Uint8Array> {
    const result = new Uint8Array(end - start);
    for (let i = start; i < end; i++) result[i - start] = (yield* this.byte(i))!;
    return result;
  }

  get offset(): number {
    return this.pos;
  }

  set offset(value: number) {
    this.pos = value;
  }

  *skipWhitespaceAndCommentsSteps(): LexWork<void> {
    while (this.pos < this.end) {
      const b = (yield* this.byte(this.pos))!;
      if (isPdfWhitespace(b)) {
        this.pos++;
      } else if (b === 0x25) {
        this.pos++;
        while (this.pos < this.end) {
          const c = (yield* this.byte(this.pos))!;
          if (c === 0x0a || c === 0x0d) break;
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  *nextTokenSteps(): LexWork<CosToken | undefined> {
    yield* this.skipWhitespaceAndCommentsSteps();
    if (this.pos >= this.end) return undefined;

    const start = this.pos;
    const b = (yield* this.byte(start))!;

    if (b === 0x5b) {
      this.pos++;
      return { kind: "array-start", span: { start, end: this.pos } };
    }
    if (b === 0x5d) {
      this.pos++;
      return { kind: "array-end", span: { start, end: this.pos } };
    }
    if (b === 0x3c) {
      if (this.pos + 1 < this.end && (yield* this.byte(this.pos + 1)) === 0x3c) {
        this.pos += 2;
        return { kind: "dict-start", span: { start, end: this.pos } };
      }
      return yield* this.readHexString();
    }
    if (b === 0x3e) {
      if (this.pos + 1 < this.end && (yield* this.byte(this.pos + 1)) === 0x3e) {
        this.pos += 2;
        return { kind: "dict-end", span: { start, end: this.pos } };
      }
      this.pos++;
      return { kind: "keyword", value: ">", span: { start, end: this.pos } };
    }
    if (b === 0x28) {
      return yield* this.readLiteralString();
    }
    if (b === 0x2f) {
      return yield* this.readName();
    }
    if ((b >= 0x30 && b <= 0x39) || b === 0x2b || b === 0x2d || b === 0x2e) {
      return yield* this.readNumber();
    }
    if (b === 0x29) {
      this.pos++;
      throw new PdfError("E_PARSE", "Unexpected closing parenthesis in PDF token");
    }
    if (
      b === 0x7b ||
      b === 0x7d ||
      ((b < 0x20 || b > 0x7f) &&
        (yield* this.byte(start + 1))! >= 0x20 &&
        (yield* this.byte(start + 1))! <= 0x7f)
    ) {
      this.pos++;
      return { kind: "keyword", value: String.fromCharCode(b), span: { start, end: this.pos } };
    }

    let raw = "", truncated = false;
    while (this.pos < this.end) {
      // Only suspend for a new source window, not for every cached token byte.
      const cur = this.window[this.pos - this.windowStart] ?? (yield* this.byte(this.pos))!;
      if (isPdfWhitespace(cur) || isPdfDelimiter(cur)) break;
      if(!truncated){
        this.onTokenAllocation?.(32);
        const next = raw + String.fromCharCode(cur);
        if (this.knownCommands?.has(raw) && !this.knownCommands.has(next)) break;
        if(next.length>this.keywordLimit)truncated=true;
        else raw=next;
      }
      this.pos++;
      if (this.pos - start > this.maxTokenBytes) {
        throw new PdfError("E_LIMIT", "PDF token exceeds maximum byte length");
      }
    }

    const span: ByteSpan = { start, end: this.pos };

    if (raw === "true") return { kind: "boolean", value: true, span };
    if (raw === "false") return { kind: "boolean", value: false, span };
    if (raw === "null") return { kind: "null", span };

    // The extra marker makes this longer than every recognized command, so a
    // shortened unknown keyword cannot accidentally become a known one.
    return { kind: "keyword", value: truncated ? raw + "…" : raw, ...(truncated ? {truncated:true as const} : {}), span };
  }

  private *readNumber(): LexWork<CosToken> {
    const start = this.pos;
    const compact = this.compactNumbers ? new CompactPdfNumber() : undefined;
    if(compact)this.onTokenAllocation?.(16384);
    const advance = (character?: number) => {
      if(!compact)this.onTokenAllocation?.(32);
      if (character !== undefined) {if(compact)compact.append(character);else normalized += String.fromCharCode(character);}
      this.pos++;
      if (this.pos - start > this.maxTokenBytes) {
        throw new PdfError("E_LIMIT", "PDF token exceeds maximum byte length");
      }
    };
    let normalized = "";
    let decimal = false;
    let exponent = false;
    const first = yield* this.byte(this.pos);
    if (first === 0x2d || first === 0x2b) {
      advance(first);
      if (first === 0x2d && this.pos < this.end && (yield* this.byte(this.pos)) === 0x2d) advance();
    }
    while (
      this.pos < this.end &&
      ((yield* this.byte(this.pos)) === 0x0a || (yield* this.byte(this.pos)) === 0x0d)
    )
      advance();
    if (this.pos < this.end && (yield* this.byte(this.pos)) === 0x2e) {
      decimal = true;
      advance(0x2e);
    }
    const digit = this.pos < this.end ? (yield* this.byte(this.pos))! : -1;
    if (digit < 0x30 || digit > 0x39) {
      if (digit === -1 || isPdfWhitespace(digit) || digit === 0x28 || digit === 0x3c) {
        return {
          kind: "number",
          value: 0,
          raw: "0",
          isInteger: true,
          span: { start, end: this.pos }
        };
      }
      throw new PdfError("E_PARSE", "Invalid PDF number prefix");
    }
    while (this.pos < this.end) {
      const b = this.window[this.pos - this.windowStart] ?? (yield* this.byte(this.pos))!;
      if (b >= 0x30 && b <= 0x39) {
        advance(b);
      } else if (b === 0x2e && !decimal) {
        decimal = true;
        advance(0x2e);
      } else if (b === 0x2d) {
        advance();
      } else {
        break;
      }
    }
    // Retain existing exponent compatibility without consuming the E of ET.
    if ((yield* this.byte(this.pos)) === 0x65 || (yield* this.byte(this.pos)) === 0x45) {
      let next = this.pos + 1;
      if ((yield* this.byte(next)) === 0x2b || (yield* this.byte(next)) === 0x2d) next++;
      if (
        next < this.end &&
        (yield* this.byte(next))! >= 0x30 &&
        (yield* this.byte(next))! <= 0x39
      ) {
        exponent = true;
        while (this.pos < next) {
          advance((yield* this.byte(this.pos))!);
        }
        while (
          this.pos < this.end &&
          (yield* this.byte(this.pos))! >= 0x30 &&
          (yield* this.byte(this.pos))! <= 0x39
        ) {
          advance((yield* this.byte(this.pos))!);
        }
      }
    }
    if(compact)normalized=compact.spelling;
    const value = Number(normalized);
    if (!Number.isFinite(value)) {
      throw new PdfError("E_CAPABILITY", `Non-finite PDF number: ${normalized}`);
    }
    return {
      kind: "number",
      value,
      raw: exponent ? formatPdfNumber(value) : compact?.shortened
        ? `${Object.is(value,-0)?"-0":formatPdfNumber(value)}${decimal && Number.isInteger(value)?".0":""}` : normalized,
      isInteger: Number.isInteger(value) && !decimal && !exponent,
      span: { start, end: this.pos }
    };
  }

  private *readName(): LexWork<CosToken> {
    const start = this.pos;
    this.pos++;
    const nameStart = this.pos;
    const decodedBytes: number[] = [];

    while (this.pos < this.end) {
      const b = (yield* this.byte(this.pos))!;
      if (isPdfWhitespace(b) || isPdfDelimiter(b)) break;
      if (b === 0x23 && this.pos + 2 < this.end) {
        const h1 = hexValue((yield* this.byte(this.pos + 1))!);
        const h2 = hexValue((yield* this.byte(this.pos + 2))!);
        if (h1 >= 0 && h2 >= 0) {
          if (this.pos - start + 3 > this.maxTokenBytes)
            throw new PdfError("E_LIMIT", "PDF name token exceeds maximum byte length");
          this.onTokenAllocation?.(96);
          decodedBytes.push((h1 << 4) | h2);
          this.pos += 3;
          continue;
        }
      }
      if (this.pos - start + 1 > this.maxTokenBytes)
        throw new PdfError("E_LIMIT", "PDF name token exceeds maximum byte length");
      this.onTokenAllocation?.(32);
      decodedBytes.push(b);
      this.pos++;
    }

    const rawBytes = yield* this.spanBytes(nameStart, this.pos);
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(
      Uint8Array.from(decodedBytes)
    );
    return {
      kind: "name",
      decoded,
      rawBytes,
      span: { start, end: this.pos }
    };
  }

  private *readHexString(): LexWork<CosToken> {
    const start = this.pos++;
    const out = new StringOutput(
      this.stringMode,
      this.maxTokenBytes,
      "hex",
      this.onTokenAllocation
    );
    let high = -1;
    while (this.pos < this.end) {
      const b = (yield* this.byte(this.pos++))!;
      if (b === 0x3e) break;
      if (isPdfWhitespace(b)) continue;
      const h = hexValue(b);
      if (h < 0) continue;
      if (out.length >= this.maxTokenBytes)
        throw new PdfError("E_LIMIT", "PDF hex string exceeds maximum byte length");
      if (high < 0) high = h;
      else {
        yield* out.append((high << 4) | h);
        high = -1;
      }
    }
    if (high >= 0) yield* out.append(high << 4);
    return {
      kind: "hex-string",
      bytes: yield* out.finish(),
      ...(this.stringMode === "buffer" ? {} : { byteLength: out.length }),
      span: { start, end: this.pos }
    };
  }

  private *readLiteralString(): LexWork<CosToken> {
    const start = this.pos;
    this.pos++;
    let depth = 1;
    let recovery: { offset: number; length: number } | undefined;
    const out = new StringOutput(
      this.stringMode,
      this.maxTokenBytes,
      "literal",
      this.onTokenAllocation
    );

    while (this.pos < this.end && depth > 0) {
      const b = (yield* this.byte(this.pos++))!;
      if (b === 0x5c) {
        if (this.pos >= this.end) break;
        const esc = (yield* this.byte(this.pos++))!;
        if (esc === 0x6e) yield* out.append(0x0a);
        else if (esc === 0x72) yield* out.append(0x0d);
        else if (esc === 0x74) yield* out.append(0x09);
        else if (esc === 0x62) yield* out.append(0x08);
        else if (esc === 0x66) yield* out.append(0x0c);
        else if (esc === 0x28) yield* out.append(0x28);
        else if (esc === 0x29) yield* out.append(0x29);
        else if (esc === 0x5c) yield* out.append(0x5c);
        else if (esc === 0x0d) {
          if (this.pos < this.end && (yield* this.byte(this.pos)) === 0x0a) this.pos++;
        } else if (esc === 0x0a) {
          // line continuation
        } else if (esc >= 0x30 && esc <= 0x37) {
          let oct = esc - 0x30;
          if (
            this.pos < this.end &&
            (yield* this.byte(this.pos))! >= 0x30 &&
            (yield* this.byte(this.pos))! <= 0x37
          ) {
            oct = (oct << 3) | ((yield* this.byte(this.pos++))! - 0x30);
            if (
              this.pos < this.end &&
              (yield* this.byte(this.pos))! >= 0x30 &&
              (yield* this.byte(this.pos))! <= 0x37
            ) {
              oct = (oct << 3) | ((yield* this.byte(this.pos++))! - 0x30);
            }
          }
          yield* out.append(oct & 0xff);
        } else {
          yield* out.append(esc);
        }
      } else if (b === 0x28) {
        depth++;
        yield* out.append(b);
      } else if (b === 0x29) {
        depth--;
        if (depth > 0) {
          // PDFBox BaseParser.checkForEndOfString identifies a dictionary
          // boundary after an unmatched close. Defer recovery until EOF so
          // balanced multiline strings retain their literal contents.
          const next = yield* this.byte(this.pos);
          const afterLine =
            next === 0x0d && (yield* this.byte(this.pos + 1)) === 0x0a
              ? this.pos + 2
              : this.pos + 1;
          const delimiter = yield* this.byte(afterLine);
          if (
            !recovery &&
            this.pos + 2 < this.end &&
            (next === 0x0a || next === 0x0d) &&
            (delimiter === 0x2f || delimiter === 0x3e)
          ) {
            recovery = { offset: this.pos, length: out.length };
          }
          yield* out.append(b);
        }
      } else if (b === 0x0d) {
        if (this.pos < this.end && (yield* this.byte(this.pos)) === 0x0a) this.pos++;
        yield* out.append(0x0a);
      } else {
        yield* out.append(b);
      }
    }

    if (depth > 0 && recovery) {
      this.pos = recovery.offset;
      out.truncate(recovery.length);
    }
    return {
      kind: "string",
      bytes: yield* out.finish(),
      ...(this.stringMode === "buffer" ? {} : { byteLength: out.length }),
      span: { start, end: this.pos }
    };
  }
}

/** Buffered convenience lexer; the shared grammar never suspends for this input. */
export class CosByteLexer extends CosLexerState {
  constructor(
    readonly bytes: Uint8Array,
    start = 0,
    end = bytes.length,
    maxTokenBytes = Infinity,
    knownCommands?: ReadonlySet<string>
  ) {
    super(bytes, start, end, maxTokenBytes, knownCommands);
  }

  nextToken(): CosToken | undefined {
    const step = this.nextTokenSteps().next();
    if (!step.done) throw new PdfError("E_PARSE", "PDF lexer requested bytes outside its buffer");
    return step.value;
  }

  skipWhitespaceAndComments(): void {
    const step = this.skipWhitespaceAndCommentsSteps().next();
    if (!step.done) throw new PdfError("E_PARSE", "PDF lexer requested bytes outside its buffer");
  }
}

export interface CosRangeLexerOptions {
  /** Retain only a prefix of unknown keywords, marking them truncated. */
  readonly compactKeywords?: boolean;
  /** Canonicalize number spellings longer than 2048 characters with bounded scratch. */
  readonly compactNumbers?: boolean;
  readonly onBackingError?: (error: unknown) => void;
  /** Decoded string payloads use caller-owned backing instead of token arrays. */
  readonly stringStorage?: PdfPixelStorage;
  /** Admit incremental token scratch and returned byte/string storage before growth. */
  readonly onTokenAllocation?: (bytes: number) => void;
  readonly start?: number;
  readonly end?: number;
  /** Decoded string / encoded name and number budget; independent of the input range cache. */
  readonly maxTokenBytes?: number;
  readonly knownCommands?: ReadonlySet<string>;
  readonly signal?: AbortSignal;
}

/** Pull tokens from a caller-owned retained source. Resident input is one source
 * chunk plus the source cache; the active token and returned tokens are additional.
 * The caller retains responsibility for closing the source. */
export class CosRangeLexer {
  private readonly state: CosLexerState;
  private active = false;
  private readonly signal: AbortSignal | undefined;
  private stringStorage: PdfPixelStorage | undefined;
  private storageAdmitted = false;
  private readonly onTokenAllocation: ((bytes: number) => void) | undefined;
  private readonly onBackingError: ((error: unknown) => void) | undefined;

  constructor(
    private readonly source: Pick<PdfFileSource, "size" | "chunkBytes" | "read">,
    options: CosRangeLexerOptions = {}
  ) {
    const start = options.start ?? 0;
    const end = options.end ?? source.size;
    const maximum = options.maxTokenBytes ?? Infinity;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > source.size
    ) {
      throw new RangeError("Invalid PDF lexer range");
    }
    if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0))
      throw new RangeError("Invalid PDF token byte budget");
    this.state = new CosLexerState(
      new Uint8Array(0),
      start,
      end,
      maximum,
      options.knownCommands,
      options.onTokenAllocation,
      options.stringStorage ? "count" : "buffer",
      options.compactNumbers,
      options.compactKeywords
    );
    this.onBackingError = options.onBackingError;
    this.onTokenAllocation = options.onTokenAllocation;
    this.setStringStorage(options.stringStorage);
    this.signal = options.signal;
  }

  /** Select backing before the next token; other token kinds remain unchanged. */
  setStringStorage(storage: PdfPixelStorage | undefined): void {
    if (this.active) throw new Error("PDF lexer operation is pending");
    if (storage && !this.storageAdmitted) { this.onTokenAllocation?.(16384); this.storageAdmitted = true; }
    this.stringStorage = storage;
    this.state.stringMode = storage ? "count" : "buffer";
  }

  get offset(): number {
    return this.state.offset;
  }
  set offset(value: number) {
    if (this.active) throw new Error("PDF lexer operation is pending");
    if (!Number.isSafeInteger(value) || value < 0 || value > this.state.end)
      throw new RangeError("Invalid PDF lexer offset");
    this.state.offset = value;
  }

  private async run<T>(work: LexWork<T>, emit?: (bytes: Uint8Array) => Promise<void>): Promise<T> {
    let reads = 0;
    try {
      this.signal?.throwIfAborted();
      let step = work.next();
      while (!step.done) {
        let bytes: Uint8Array;
        if (typeof step.value === "number")
          bytes = await this.source.read(
            step.value,
            Math.min(this.source.chunkBytes, this.state.end - step.value),
            this.signal
          );
        else {
          if (!emit) throw new Error("Unexpected streamed PDF token");
          await emit(step.value);
          bytes = new Uint8Array();
        }
        this.signal?.throwIfAborted();
        if (++reads % 64 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        this.signal?.throwIfAborted();
        step = work.next(bytes);
      }
      return step.value;
    } finally {
      work.return(undefined as T);
    }
  }

  async nextToken(): Promise<CosToken | undefined> {
    if (this.active) throw new Error("PDF lexer operation is pending");
    this.active = true;
    try {
      const token = await this.run(this.state.nextTokenSteps()),
        storage = this.stringStorage;
      if (!storage || !token || (token.kind !== "string" && token.kind !== "hex-string"))
        return token;
      const length = token.byteLength!;
      let position: number;
      try { position = storage.allocate(length); }
      catch (error) { this.onBackingError?.(error); throw error; }
      if (
        !Number.isSafeInteger(position) ||
        position < 0 ||
        !Number.isSafeInteger(position + length)
      )
        throw new RangeError("Invalid stored PDF string allocation");
      const replay = new CosLexerState(
        new Uint8Array(),
        token.span.start,
        token.span.end,
        this.state.maxTokenBytes,
        undefined,
        undefined,
        "stream"
      );
      let written = 0;
      await this.run(replay.nextTokenSteps(), async (bytes) => {
        // Malformed recovery selects a decoded prefix. The measuring pass defines
        // that prefix even when its raw closing parenthesis remains unmatched.
        const count = Math.min(bytes.length, length - written);
        if (count) {
          try {
            await storage.write(position + written, bytes.slice(0, count), this.signal ? { signal: this.signal } : undefined);
          } catch (error) { this.onBackingError?.(error); throw error; }
          written += count;
        }
      });
      this.signal?.throwIfAborted();
      if (written !== length) throw new PdfError("E_PARSE", "Incomplete stored PDF string");
      return { ...token, storedBytes: { storage, position, byteLength: length } };
    } finally {
      this.active = false;
    }
  }
  async skipWhitespaceAndComments(): Promise<void> {
    if (this.active) throw new Error("PDF lexer operation is pending");
    this.active = true;
    try {
      await this.run(this.state.skipWhitespaceAndCommentsSteps());
    } finally {
      this.active = false;
    }
  }
}

export function tokenizeCos(bytes: Uint8Array, start = 0, end = bytes.length): CosToken[] {
  const lexer = new CosByteLexer(bytes, start, end);
  const tokens: CosToken[] = [];
  while (true) {
    const tok = lexer.nextToken();
    if (!tok) break;
    tokens.push(tok);
  }
  return tokens;
}
