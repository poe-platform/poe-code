import type { CffCodeSource } from "../vendor/pdfjs-fonts.mjs";
import { FontDecimal } from "./font-decimal.js";

function white(byte: number | undefined) {
  return byte === 32 || byte === 9 || byte === 10 || byte === 13;
}
function special(byte: number | undefined) {
  return (
    byte === 47 ||
    byte === 91 ||
    byte === 93 ||
    byte === 123 ||
    byte === 125 ||
    byte === 40 ||
    byte === 41
  );
}

export class StoredType1Token {
  constructor(
    readonly source: CffCodeSource,
    readonly start: number,
    readonly length: number
  ) {}
  async equals(text: string): Promise<boolean> {
    if (text.length !== this.length) return false;
    for (let i = 0; i < this.length; i++)
      if (text.charCodeAt(i) !== (await this.source.byte(this.start + i))) return false;
    return true;
  }
  /** All parser keywords fit this bound; arbitrary names stay source spans. */
  async keyword(): Promise<string | undefined> {
    if (this.length > 32) return undefined;
    let value = "";
    for (let i = 0; i < this.length; i++)
      value += String.fromCharCode((await this.source.byte(this.start + i))!);
    return value;
  }
  async number(): Promise<number> {
    const decimal = new FontDecimal(this.length * 2 + 2048);
    for (let i = 0; i < this.length; i++)
      decimal.accept(String.fromCharCode((await this.source.byte(this.start + i))!));
    return decimal.value();
  }
  async integer(): Promise<number> {
    let sign = "",
      digits = "",
      started = false,
      at = 0;
    while (at < this.length) {
      const value = (await this.source.byte(this.start + at))!;
      if (![9, 10, 11, 12, 13, 32, 160].includes(value)) break;
      at++;
    }
    const first = await this.source.byte(this.start + at);
    if (first === 43 || first === 45) {
      sign = first === 45 ? "-" : "";
      at++;
    }
    for (; at < this.length; at++) {
      const value = (await this.source.byte(this.start + at))!;
      if (value < 48 || value > 57) break;
      if (value !== 48 || started) {
        started = true;
        digits += String.fromCharCode(value);
      }
      // Any decimal integer of 310 significant digits overflows binary64;
      // parseInt then converts Infinity to zero under the native bitwise cast.
      if (digits.length === 310) return sign === "-" ? -Infinity : Infinity;
    }
    return parseInt(sign + (digits || "0"), 10);
  }
  async int32(): Promise<number> {
    return (await this.integer()) | 0;
  }
  async digits(): Promise<boolean> {
    if (!this.length) return false;
    for (let i = 0; i < this.length; i++) {
      const value = (await this.source.byte(this.start + i))!;
      if (value < 48 || value > 57) return false;
    }
    return true;
  }
}

/** The cursor denotes native currentChar, including its one-byte lookahead. */
export class StoredType1Lexer {
  position = 0;
  constructor(readonly source: CffCodeSource) {}
  async next(): Promise<StoredType1Token | null> {
    let comment = false,
      byte: number | undefined;
    while ((byte = await this.source.byte(this.position)) !== undefined) {
      if (comment) {
        if (byte === 10 || byte === 13) comment = false;
      } else if (byte === 37) comment = true;
      else if (!white(byte)) break;
      this.position++;
    }
    if (byte === undefined) return null;
    const start = this.position++;
    if (!special(byte))
      while (
        (byte = await this.source.byte(this.position)) !== undefined &&
        !white(byte) &&
        !special(byte)
      )
        this.position++;
    return new StoredType1Token(this.source, start, this.position - start);
  }
  binary(length: number): { start: number; length: number } {
    const start = Math.min(this.source.length, this.position + 1),
      end = Math.min(this.source.length, start + Math.max(0, length));
    this.position = end;
    return { start, length: end - start };
  }
  previous(): void {
    this.position = Math.max(0, this.position - 1);
  }
}
