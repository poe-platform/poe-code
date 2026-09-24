import { formatPdfNumber, type ByteSpan } from "../ast.js";
import { PdfError } from "../errors.js";

export type CosToken =
  | { readonly kind: "boolean"; readonly value: boolean; readonly span: ByteSpan }
  | { readonly kind: "null"; readonly span: ByteSpan }
  | { readonly kind: "number"; readonly value: number; readonly raw: string; readonly isInteger: boolean; readonly span: ByteSpan }
  | { readonly kind: "name"; readonly decoded: string; readonly rawBytes: Uint8Array; readonly span: ByteSpan }
  | { readonly kind: "string"; readonly bytes: Uint8Array; readonly span: ByteSpan }
  | { readonly kind: "hex-string"; readonly bytes: Uint8Array; readonly span: ByteSpan }
  | { readonly kind: "array-start"; readonly span: ByteSpan }
  | { readonly kind: "array-end"; readonly span: ByteSpan }
  | { readonly kind: "dict-start"; readonly span: ByteSpan }
  | { readonly kind: "dict-end"; readonly span: ByteSpan }
  | { readonly kind: "keyword"; readonly value: string; readonly span: ByteSpan };

export function isPdfWhitespace(byte: number): boolean {
  return byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;
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

export class CosByteLexer {
  readonly bytes: Uint8Array;
  pos: number;
  readonly end: number;
  readonly maxTokenBytes: number;

  constructor(bytes: Uint8Array, start = 0, end = bytes.length, maxTokenBytes = 16_000_000) {
    this.bytes = bytes;
    this.pos = start;
    this.end = end;
    this.maxTokenBytes = maxTokenBytes;
  }

  get offset(): number {
    return this.pos;
  }

  set offset(value: number) {
    this.pos = value;
  }

  skipWhitespaceAndComments(): void {
    while (this.pos < this.end) {
      const b = this.bytes[this.pos]!;
      if (isPdfWhitespace(b)) {
        this.pos++;
      } else if (b === 0x25) {
        this.pos++;
        while (this.pos < this.end) {
          const c = this.bytes[this.pos]!;
          if (c === 0x0a || c === 0x0d) break;
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  nextToken(): CosToken | undefined {
    this.skipWhitespaceAndComments();
    if (this.pos >= this.end) return undefined;

    const start = this.pos;
    const b = this.bytes[start]!;

    if (b === 0x5b) {
      this.pos++;
      return { kind: "array-start", span: { start, end: this.pos } };
    }
    if (b === 0x5d) {
      this.pos++;
      return { kind: "array-end", span: { start, end: this.pos } };
    }
    if (b === 0x3c) {
      if (this.pos + 1 < this.end && this.bytes[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return { kind: "dict-start", span: { start, end: this.pos } };
      }
      return this.readHexString();
    }
    if (b === 0x3e) {
      if (this.pos + 1 < this.end && this.bytes[this.pos + 1] === 0x3e) {
        this.pos += 2;
        return { kind: "dict-end", span: { start, end: this.pos } };
      }
      this.pos++;
      return { kind: "keyword", value: ">", span: { start, end: this.pos } };
    }
    if (b === 0x28) {
      return this.readLiteralString();
    }
    if (b === 0x2f) {
      return this.readName();
    }

    while (this.pos < this.end) {
      const cur = this.bytes[this.pos]!;
      if (isPdfWhitespace(cur) || isPdfDelimiter(cur)) break;
      this.pos++;
      if (this.pos - start > this.maxTokenBytes) {
        throw new PdfError("E_LIMIT", "PDF token exceeds maximum byte length");
      }
    }

    let raw = "";
    for (let i = start; i < this.pos; i++) {
      raw += String.fromCharCode(this.bytes[i]!);
    }
    const span: ByteSpan = { start, end: this.pos };

    if (raw === "true") return { kind: "boolean", value: true, span };
    if (raw === "false") return { kind: "boolean", value: false, span };
    if (raw === "null") return { kind: "null", span };

    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new PdfError("E_CAPABILITY", `Non-finite PDF number: ${raw}`);
      }
      const isInteger = Number.isInteger(value) && !raw.includes(".") && !/[eE]/.test(raw);
      const normalizedRaw = /[eE]/.test(raw) ? formatPdfNumber(value) : raw;
      return { kind: "number", value, raw: normalizedRaw, isInteger, span };
    }

    return { kind: "keyword", value: raw, span };
  }

  private readName(): CosToken {
    const start = this.pos;
    this.pos++;
    const nameStart = this.pos;
    const decodedBytes: number[] = [];

    while (this.pos < this.end) {
      const b = this.bytes[this.pos]!;
      if (isPdfWhitespace(b) || isPdfDelimiter(b)) break;
      if (b === 0x23 && this.pos + 2 < this.end) {
        const h1 = hexValue(this.bytes[this.pos + 1]!);
        const h2 = hexValue(this.bytes[this.pos + 2]!);
        if (h1 >= 0 && h2 >= 0) {
          decodedBytes.push((h1 << 4) | h2);
          this.pos += 3;
          continue;
        }
      }
      decodedBytes.push(b);
      this.pos++;
      if (this.pos - start > this.maxTokenBytes) {
        throw new PdfError("E_LIMIT", "PDF name token exceeds maximum byte length");
      }
    }

    const rawBytes = this.bytes.subarray(nameStart, this.pos);
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(decodedBytes));
    return {
      kind: "name",
      decoded,
      rawBytes,
      span: { start, end: this.pos },
    };
  }

  private readHexString(): CosToken {
    const start = this.pos;
    this.pos++;
    const nibbles: number[] = [];

    while (this.pos < this.end) {
      const b = this.bytes[this.pos++]!;
      if (b === 0x3e) break;
      if (isPdfWhitespace(b)) continue;
      const h = hexValue(b);
      if (h >= 0) {
        nibbles.push(h);
        if (nibbles.length > this.maxTokenBytes * 2) {
          throw new PdfError("E_LIMIT", "PDF hex string exceeds maximum byte length");
        }
      }
    }

    if (nibbles.length % 2 === 1) {
      nibbles.push(0);
    }
    const out = new Uint8Array(nibbles.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = (nibbles[i * 2]! << 4) | nibbles[i * 2 + 1]!;
    }
    return { kind: "hex-string", bytes: out, span: { start, end: this.pos } };
  }

  private readLiteralString(): CosToken {
    const start = this.pos;
    this.pos++;
    let depth = 1;
    const out: number[] = [];

    while (this.pos < this.end && depth > 0) {
      const b = this.bytes[this.pos++]!;
      if (b === 0x5c) {
        if (this.pos >= this.end) break;
        const esc = this.bytes[this.pos++]!;
        if (esc === 0x6e) out.push(0x0a);
        else if (esc === 0x72) out.push(0x0d);
        else if (esc === 0x74) out.push(0x09);
        else if (esc === 0x62) out.push(0x08);
        else if (esc === 0x66) out.push(0x0c);
        else if (esc === 0x28) out.push(0x28);
        else if (esc === 0x29) out.push(0x29);
        else if (esc === 0x5c) out.push(0x5c);
        else if (esc === 0x0d) {
          if (this.pos < this.end && this.bytes[this.pos] === 0x0a) this.pos++;
        } else if (esc === 0x0a) {
          // line continuation
        } else if (esc >= 0x30 && esc <= 0x37) {
          let oct = esc - 0x30;
          if (this.pos < this.end && this.bytes[this.pos]! >= 0x30 && this.bytes[this.pos]! <= 0x37) {
            oct = (oct << 3) | (this.bytes[this.pos++]! - 0x30);
            if (this.pos < this.end && this.bytes[this.pos]! >= 0x30 && this.bytes[this.pos]! <= 0x37) {
              oct = (oct << 3) | (this.bytes[this.pos++]! - 0x30);
            }
          }
          out.push(oct & 0xff);
        } else {
          out.push(esc);
        }
      } else if (b === 0x28) {
        depth++;
        out.push(b);
      } else if (b === 0x29) {
        depth--;
        if (depth > 0) out.push(b);
      } else if (b === 0x0d) {
        if (this.pos < this.end && this.bytes[this.pos] === 0x0a) this.pos++;
        out.push(0x0a);
      } else {
        out.push(b);
      }
      if (out.length > this.maxTokenBytes) {
        throw new PdfError("E_LIMIT", "PDF literal string exceeds maximum byte length");
      }
    }

    return {
      kind: "string",
      bytes: Uint8Array.from(out),
      span: { start, end: this.pos },
    };
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
