/** Original first-party strict PDF object syntax. No document/stream interpretation. */
export class PdfSyntaxError extends Error {
  constructor(
    readonly code: "SYNTAX" | "LIMIT" | "ARGUMENT" | "REFERENCE" | "UNSUPPORTED",
    message: string,
    readonly offset: number
  ) {
    super(`${message} at byte ${offset}`);
  }
}
export interface PdfLimits {
  inputBytes: number;
  tokenBytes: number;
  retainedBytes: number;
  expandedBytes: number;
  nesting: number;
  objects: number;
  work: number;
}
export const defaultPdfLimits: Readonly<PdfLimits> = Object.freeze({
  inputBytes: 16 * 1024 * 1024,
  tokenBytes: 1024 * 1024,
  retainedBytes: 32 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  nesting: 64,
  objects: 100_000,
  work: 64 * 1024 * 1024
});
export interface PdfObject {
  kind: "number" | "boolean" | "null" | "name" | "string" | "array" | "dictionary" | "reference";
  start: number;
  end: number;
  raw?: Uint8Array;
  bytes?: Uint8Array;
  value?: number | boolean;
  items?: PdfObject[];
  entries?: { key: PdfObject; value: PdfObject }[];
  objectNumber?: number;
  generation?: number;
}
export interface PdfParseOptions {
  limits?: Partial<PdfLimits>;
  signal?: AbortSignal;
  offset?: number;
  duplicateKeys?: "preserve" | "reject";
}
interface Token {
  start: number;
  end: number;
  type: string;
  object?: PdfObject;
}
const whitespace = (b: number) =>
  b === 0 || b === 9 || b === 10 || b === 12 || b === 13 || b === 32;
const delimiter = (b: number) =>
  whitespace(b) ||
  b === 40 ||
  b === 41 ||
  b === 60 ||
  b === 62 ||
  b === 91 ||
  b === 93 ||
  b === 123 ||
  b === 125 ||
  b === 47 ||
  b === 37;
const digit = (b: number) => b >= 48 && b <= 57;
function hex(b: number): number {
  if (digit(b)) return b - 48;
  if (b >= 65 && b <= 70) return b - 55;
  if (b >= 97 && b <= 102) return b - 87;
  return -1;
}
export function admittedByteLength(value: unknown): number | undefined {
  if (!ArrayBuffer.isView(value)) return undefined;
  // Intrinsic getters inspect storage, independent of realm and own properties.
  const prototype = Object.getPrototypeOf(Uint8Array.prototype);
  const tag = Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)!.get!;
  if (tag.call(value) !== "Uint8Array") return undefined;
  return Object.getOwnPropertyDescriptor(prototype, "length")!.get!.call(value) as number;
}
export class SyntaxReader {
  readonly data: Uint8Array;
  readonly limits: PdfLimits;
  private position: number;
  private work = 0;
  private retained = 0;
  private expanded = 0;
  private objects = 0;
  private queue: Token[] = [];
  constructor(
    input: Uint8Array | readonly Uint8Array[],
    readonly options: PdfParseOptions,
    private readonly owner?: SyntaxReader,
    private readonly words = false
  ) {
    this.limits = { ...defaultPdfLimits, ...options.limits };
    for (const [key, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 0 || (key === "nesting" && value > 128))
        this.fail("ARGUMENT", "invalid limit");
    }
    this.check();
    if (
      options.duplicateKeys !== undefined &&
      options.duplicateKeys !== "preserve" &&
      options.duplicateKeys !== "reject"
    )
      this.fail("ARGUMENT", "invalid duplicate-key policy");
    const chunks = Array.isArray(input) ? input : [input];
    let size = 0;
    for (const chunk of chunks) {
      this.charge();
      const length = admittedByteLength(chunk);
      if (length === undefined) this.fail("ARGUMENT", "expected Uint8Array input");
      if (length > this.limits.inputBytes - size) this.fail("LIMIT", "input byte limit");
      size += length;
    }
    this.position = options.offset ?? 0;
    if (!Number.isSafeInteger(this.position) || this.position < 0 || this.position > size)
      this.fail("ARGUMENT", "invalid offset");
    // Charge snapshot allocation and copying before allocating owned input.
    this.charge(size);
    this.reserve(size);
    this.data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      this.check();
      this.data.set(chunk, offset);
      offset += admittedByteLength(chunk)!;
    }
  }
  seek(offset: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.data.length)
      this.fail("SYNTAX", "invalid offset");
    this.position = offset;
    this.queue = [];
  }
  get offset(): number {
    return this.position;
  }
  fork(data: Uint8Array, words = false): SyntaxReader {
    return new SyntaxReader(data, { ...this.options, offset: 0 }, this, words);
  }
  fail(code: PdfSyntaxError["code"], message: string): never {
    throw new PdfSyntaxError(code, message, this.position ?? 0);
  }
  check(): void {
    if (this.options.signal?.aborted) throw this.options.signal.reason;
  }
  charge(n = 1): void {
    if (this.owner) {
      this.owner.charge(n);
      return;
    }
    this.check();
    if (n > this.limits.work - this.work) this.fail("LIMIT", "work limit");
    this.work += n;
  }
  reserve(n: number): void {
    if (this.owner) {
      this.owner.reserve(n);
      return;
    }
    if (n > this.limits.retainedBytes - this.retained) this.fail("LIMIT", "retained byte limit");
    this.retained += n;
  }
  expand(n: number): void {
    if (this.owner) {
      this.owner.expand(n);
      return;
    }
    this.check();
    if (n > this.limits.expandedBytes - this.expanded)
      this.fail("LIMIT", "expanded byte limit");
    this.expanded += n;
  }
  read(start: number): number {
    this.charge();
    if (this.position - start >= this.limits.tokenBytes) this.fail("LIMIT", "token byte limit");
    if (this.position >= this.data.length) this.fail("SYNTAX", "unexpected EOF");
    return this.data[this.position++]!;
  }
  peekByte(): number {
    return this.data[this.position] ?? -1;
  }
  skip(): void {
    while (this.position < this.data.length) {
      this.charge();
      if (whitespace(this.peekByte())) {
        this.position++;
        continue;
      }
      if (this.peekByte() !== 37) break;
      const start = this.position;
      while (this.position < this.data.length && this.peekByte() !== 10 && this.peekByte() !== 13)
        this.read(start);
    }
  }
  token(): Token {
    this.skip();
    const start = this.position;
    if (start === this.data.length) return { type: "EOF", start, end: start };
    const b = this.read(start);
    let type = "";
    let object: PdfObject | undefined;
    if (b === 91 || b === 93) type = b === 91 ? "[" : "]";
    else if ((b === 60 || b === 62) && this.peekByte() === b) {
      this.read(start);
      type = b === 60 ? "<<" : ">>";
    } else if (b === 47 || b === 40 || b === 60) {
      const decoded: number[] = [];
      const add = (v: number) => {
        this.reserve(9);
        decoded.push(v);
      };
      if (b === 47) {
        while (this.peekByte() !== -1 && !delimiter(this.peekByte())) {
          const c = this.read(start);
          if (c !== 35) add(c);
          else {
            const h = hex(this.read(start)),
              l = hex(this.read(start));
            if (h < 0 || l < 0) this.fail("SYNTAX", "malformed name escape");
            add(h * 16 + l);
          }
        }
      } else if (b === 60) {
        let high = -1;
        while (true) {
          const c = this.read(start);
          if (c === 62) {
            if (high >= 0) add(high * 16);
            break;
          }
          if (whitespace(c)) continue;
          const v = hex(c);
          if (v < 0) this.fail("SYNTAX", "malformed hex string");
          if (high < 0) high = v;
          else {
            add(high * 16 + v);
            high = -1;
          }
        }
      } else {
        let depth = 1;
        if (depth > this.limits.nesting) this.fail("LIMIT", "string nesting limit");
        while (depth) {
          let c = this.read(start);
          if (c === 92) {
            c = this.read(start);
            if (c === 13 || c === 10) {
              if (c === 13 && this.peekByte() === 10) this.read(start);
              continue;
            }
            if (c >= 48 && c <= 55) {
              let value = c - 48;
              for (let i = 0; i < 2 && this.peekByte() >= 48 && this.peekByte() <= 55; i++)
                value = value * 8 + this.read(start) - 48;
              add(value % 256);
              continue;
            }
            const escapes: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
            add(escapes[c] ?? c);
            continue;
          }
          if (c === 40) {
            depth++;
            if (depth > this.limits.nesting) this.fail("LIMIT", "string nesting limit");
          }
          if (c === 41 && --depth === 0) break;
          if (c === 13) {
            if (this.peekByte() === 10) this.read(start);
            c = 10;
          }
          add(c);
        }
      }
      this.reserve((this.position - start) * 3);
      object = {
        kind: b === 47 ? "name" : "string",
        start,
        end: this.position,
        raw: this.data.slice(start, this.position),
        bytes: Uint8Array.from(decoded)
      };
      type = "object";
    } else {
      while (this.peekByte() !== -1 && !delimiter(this.peekByte())) this.read(start);
      this.reserve((this.position - start) * 8);
      const raw = this.data.slice(start, this.position);
      // ASCII grammar only: never decode arbitrary PDF bytes through UTF-8.
      let word = "";
      for (const c of raw) {
        this.charge();
        word += String.fromCharCode(c);
      }
      if (
        [
          "R",
          "obj",
          "endobj",
          "stream",
          "endstream",
          "xref",
          "trailer",
          "startxref",
          "n",
          "f"
        ].includes(word)
      )
        type = word;
      else if (this.words && !digit(raw[0]!) && ![43, 45, 46].includes(raw[0]!) && !["true", "false", "null"].includes(word)) type = word;
      else if (word === "true" || word === "false" || word === "null") {
        object =
          word === "null"
            ? { kind: "null", start, end: this.position, raw }
            : { kind: "boolean", start, end: this.position, raw, value: word === "true" };
        type = "object";
      } else {
        let i = raw[0] === 43 || raw[0] === 45 ? 1 : 0,
          digits = 0,
          dots = 0;
        for (; i < raw.length; i++) {
          if (digit(raw[i]!)) digits++;
          else if (raw[i] === 46) dots++;
          else this.fail("SYNTAX", "invalid numeric token");
        }
        if (!digits || dots > 1) this.fail("SYNTAX", "invalid numeric token");
        const unsigned = word[0] === "+" || word[0] === "-" ? word.slice(1) : word;
        const parts = unsigned.split(".");
        let integer = parts[0]!;
        let leading = 0;
        while (leading < integer.length && integer[leading] === "0") leading++;
        integer = integer.slice(leading);
        const maximum = "9007199254740991";
        let nonzeroFraction = false;
        for (const c of parts[1] ?? "") {
          this.charge();
          if (c !== "0") nonzeroFraction = true;
        }
        if (
          integer.length > maximum.length ||
          (integer.length === maximum.length &&
            (integer > maximum || (integer === maximum && nonzeroFraction)))
        )
          this.fail("SYNTAX", "numeric range");
        const value = Number(word);
        if (
          !Number.isFinite(value) ||
          Math.abs(value) > Number.MAX_SAFE_INTEGER ||
          (dots === 0 && !Number.isSafeInteger(value))
        )
          this.fail("SYNTAX", "numeric range");
        object = { kind: "number", start, end: this.position, raw, value };
        type = "object";
      }
    }
    return { type, start, end: this.position, ...(object ? { object } : {}) };
  }
  peek(index = 0): Token {
    while (this.queue.length <= index) this.queue.push(this.token());
    return this.queue[index]!;
  }
  take(): Token {
    const t = this.peek();
    this.queue.shift();
    return t;
  }
  countObject(): void {
    if (this.owner) {
      this.owner.countObject();
      return;
    }
    if (++this.objects > this.limits.objects) this.fail("LIMIT", "object count limit");
  }
  object(depth = 0): PdfObject {
    this.charge();
    if (this.owner) this.owner.countObject();
    else this.countObject();
    this.reserve(128);
    const t = this.take();
    if (t.object) {
      if (
        t.object.kind === "number" &&
        this.peek().object?.kind === "number" &&
        this.peek(1).type === "R"
      ) {
        const generation = this.take().object!,
          end = this.take().end;
        for (const n of [t.object, generation])
          if (!Number.isSafeInteger(n.value) || (n.value as number) < 0 || n.raw?.includes(46))
            this.fail("SYNTAX", "invalid reference integer");
        if ((generation.value as number) > 65535) this.fail("SYNTAX", "invalid generation");
        this.reserve(end - t.start);
        this.charge(end - t.start);
        return {
          kind: "reference",
          start: t.start,
          end,
          raw: this.data.slice(t.start, end),
          objectNumber: t.object.value as number,
          generation: generation.value as number
        };
      }
      return t.object;
    }
    if (t.type !== "[" && t.type !== "<<") this.fail("SYNTAX", "expected object");
    if (depth >= this.limits.nesting) this.fail("LIMIT", "nesting limit");
    const items: PdfObject[] = [],
      entries: { key: PdfObject; value: PdfObject }[] = [],
      keys = new Set<string>();
    const close = t.type === "[" ? "]" : ">>";
    while (this.peek().type !== close) {
      if (t.type === "[") items.push(this.object(depth + 1));
      else {
        const key = this.object(depth + 1);
        if (key.kind !== "name") this.fail("SYNTAX", "dictionary key must be a name");
        if (this.options.duplicateKeys === "reject") {
          this.reserve(key.bytes!.length * 2);
          let identity = "";
          for (const b of key.bytes!) {
            this.charge();
            identity += String.fromCharCode(b);
          }
          if (keys.has(identity)) this.fail("SYNTAX", "duplicate dictionary key");
          keys.add(identity);
        }
        this.reserve(32);
        entries.push({ key, value: this.object(depth + 1) });
      }
    }
    const end = this.take().end;
    return t.type === "["
      ? { kind: "array", start: t.start, end, items }
      : { kind: "dictionary", start: t.start, end, entries };
  }
  parse(): PdfObject[] {
    const result: PdfObject[] = [];
    while (this.peek().type !== "EOF") result.push(this.object());
    return result;
  }
}
export function parsePdfObjects(
  input: Uint8Array | readonly Uint8Array[],
  options: PdfParseOptions = {}
): PdfObject[] {
  return new SyntaxReader(input, options).parse();
}
/** Resolve only a chain of references; graph traversal belongs to a separate gate. */
export function resolvePdfReference(
  object: PdfObject,
  lookup: (reference: PdfObject) => PdfObject,
  options: { maxReferences?: number; signal?: AbortSignal } = {}
): PdfObject {
  const limit = options.maxReferences ?? 1024;
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new PdfSyntaxError("ARGUMENT", "invalid reference limit", object.start);
  const visited = new Set<string>();
  while (object.kind === "reference") {
    if (options.signal?.aborted) throw options.signal.reason;
    if (visited.size >= limit) throw new PdfSyntaxError("LIMIT", "reference limit", object.start);
    if (
      !Number.isSafeInteger(object.objectNumber) ||
      object.objectNumber! < 0 ||
      !Number.isSafeInteger(object.generation) ||
      object.generation! < 0 ||
      object.generation! > 65535
    )
      throw new PdfSyntaxError("REFERENCE", "invalid reference", object.start);
    const key = `${object.objectNumber}:${object.generation}`;
    if (visited.has(key)) throw new PdfSyntaxError("REFERENCE", "reference cycle", object.start);
    visited.add(key);
    object = lookup(object);
  }
  if (options.signal?.aborted) throw options.signal.reason;
  return object;
}
