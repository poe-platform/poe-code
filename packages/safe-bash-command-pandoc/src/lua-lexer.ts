import {PandocError} from "./errors.js";
import {LuaNumbers} from "./lua-numbers.js";
import type {LuaReference, LuaStorage, StoredLuaValue} from "./lua-storage.js";

const keywords = new Set(["and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while"]);
const escapes: Readonly<Record<number, number>> = {97: 7, 98: 8, 102: 12, 110: 10, 114: 13, 116: 9, 118: 11, 92: 92, 34: 34, 39: 39};
const digit = (byte: number): boolean => byte >= 48 && byte <= 57;
const alpha = (byte: number): boolean => byte === 95 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122;
const space = (byte: number): boolean => byte === 32 || byte >= 9 && byte <= 13;
const newline = (byte: number): boolean => byte === 10 || byte === 13;
const hex = (byte: number): number => digit(byte) ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;

export interface LuaToken {kind: string; line: number; value?: StoredLuaValue}

/** Lua 5.3 tokens over an injected byte stream. Token payloads and the intern
 * index live in caller storage; buffers, lookahead and keyword state are fixed.
 * The caller consumes tokens incrementally and closes the lexer on early exit. */
export class LuaLexer {
  private readonly source: AsyncIterator<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  private current = -2;
  private line = 1;
  private units = 0;
  private closed = false;
  private interned: Promise<LuaReference> | undefined;
  private readonly numbers: LuaNumbers;
  constructor(source: AsyncIterable<Uint8Array>, private readonly heap: LuaStorage, private readonly cooperate: (units?: number) => Promise<void>) {
    this.source = source[Symbol.asyncIterator]();
    this.numbers = new LuaNumbers(heap);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.chunk = new Uint8Array();
    this.current = -1;
    await this.source.return?.();
  }
  private error(message: string): never {throw new PandocError("E_AST", "convert", message, undefined, `Lua line ${this.line}`);}
  private async readByte(): Promise<number> {
    while (this.offset === this.chunk.length) {
      if (this.closed) return -1;
      await this.cooperate();
      const next = await this.source.next();
      if (next.done) {this.closed = true; this.chunk = new Uint8Array(); return -1;}
      this.chunk = next.value; this.offset = 0;
    }
    const byte = this.chunk[this.offset++]!;
    if (++this.units >= 256) {await this.cooperate(this.units); this.units = 0;}
    return byte;
  }
  private async linebreak(): Promise<void> {
    const previous = this.current;
    this.current = await this.readByte();
    if (newline(this.current) && this.current !== previous) this.current = await this.readByte();
    if (++this.line >= 2147483647) this.error("chunk has too many lines");
  }
  private async store(bytes: AsyncIterable<number>): Promise<LuaReference> {
    return this.heap.string((async function* () {
      let buffer = new Uint8Array(8192), length = 0;
      for await (const byte of bytes) {
        buffer[length++] = byte;
        if (length === buffer.length) {yield buffer; buffer = new Uint8Array(8192); length = 0;}
      }
      if (length) yield buffer.subarray(0, length);
    })());
  }
  private async intern(value: LuaReference): Promise<LuaReference> {
    const heap = this.heap;
    // Fengari interns with unpadded hexadecimal byte hashes. Preserve its
    // existing collision behavior, without a payload-sized JS hash string.
    const key = await heap.string((async function* () {
      for await (const chunk of heap.bytes(value)) {
        const buffer = new Uint8Array(chunk.length * 2);
        let length = 0;
        for (const byte of chunk) for (const char of byte.toString(16)) buffer[length++] = char.charCodeAt(0);
        yield buffer.subarray(0, length);
      }
    })());
    const table = await (this.interned ??= heap.table()), previous = await heap.get(table, key);
    if (previous !== undefined) return previous as LuaReference;
    await heap.set(table, key, value);
    return value;
  }
  private async delimiter(): Promise<number> {
    const bracket = this.current;
    this.current = await this.readByte();
    let count = 0;
    while (this.current === 61) {count++; this.current = await this.readByte();}
    return this.current === bracket ? count : -count - 1;
  }
  private async *long(separator: number, comment: boolean): AsyncGenerator<number> {
    const start = this.line;
    this.current = await this.readByte();
    if (newline(this.current)) await this.linebreak();
    for (;;) {
      if (this.current < 0) this.error(`unfinished long ${comment ? "comment" : "string"} (starting at line ${start})`);
      if (this.current === 93) {
        this.current = await this.readByte();
        let count = 0;
        while (this.current === 61) {count++; this.current = await this.readByte();}
        if (this.current === 93 && count === separator) {this.current = await this.readByte(); return;}
        if (!comment) {yield 93; for (let i = 0; i < count; i++) yield 61;}
      } else if (newline(this.current)) {
        await this.linebreak(); if (!comment) yield 10;
      } else {const byte = this.current; this.current = await this.readByte(); if (!comment) yield byte;}
    }
  }
  private async *quoted(quote: number): AsyncGenerator<number> {
    this.current = await this.readByte();
    while (this.current !== quote) {
      if (this.current < 0 || newline(this.current)) this.error("unfinished string");
      if (this.current !== 92) {const byte = this.current; this.current = await this.readByte(); yield byte; continue;}
      this.current = await this.readByte();
      const escaped = escapes[this.current];
      if (escaped !== undefined) {this.current = await this.readByte(); yield escaped; continue;}
      if (newline(this.current)) {await this.linebreak(); yield 10; continue;}
      if (this.current === 122) {
        this.current = await this.readByte();
        while (space(this.current)) {if (newline(this.current)) await this.linebreak(); else this.current = await this.readByte();}
      } else if (this.current === 120) {
        let value = 0;
        for (let i = 0; i < 2; i++) {
          this.current = await this.readByte(); const n = hex(this.current);
          if (n < 0) this.error("hexadecimal digit expected");
          value = value * 16 + n;
        }
        this.current = await this.readByte(); yield value;
      } else if (this.current === 117) {
        this.current = await this.readByte(); if (this.current !== 123) this.error("missing '{'");
        this.current = await this.readByte(); if (hex(this.current) < 0) this.error("hexadecimal digit expected");
        let value = 0;
        while (hex(this.current) >= 0) {
          value = value * 16 + hex(this.current);
          if (value > 0x10ffff) this.error("UTF-8 value too large");
          this.current = await this.readByte();
        }
        if (this.current !== 125) this.error("missing '}'");
        this.current = await this.readByte();
        // Lua permits surrogate code points in binary strings; TextEncoder
        // would replace them, so encode the original value explicitly.
        if (value < 0x80) yield value;
        else if (value < 0x800) {yield 0xc0 | value >>> 6; yield 0x80 | value & 63;}
        else if (value < 0x10000) {yield 0xe0 | value >>> 12; yield 0x80 | value >>> 6 & 63; yield 0x80 | value & 63;}
        else {yield 0xf0 | value >>> 18; yield 0x80 | value >>> 12 & 63; yield 0x80 | value >>> 6 & 63; yield 0x80 | value & 63;}
      } else if (digit(this.current)) {
        let value = 0;
        for (let i = 0; i < 3 && digit(this.current); i++) {value = value * 10 + this.current - 48; this.current = await this.readByte();}
        if (value > 255) this.error("decimal escape too large");
        yield value;
      } else this.error(this.current < 0 ? "unfinished string" : "invalid escape sequence");
    }
    this.current = await this.readByte();
  }
  private async *identifier(): AsyncGenerator<number> {
    while (alpha(this.current) || digit(this.current)) {
      const byte = this.current;
      this.current = await this.readByte(); yield byte;
    }
  }
  private async *numeral(dot: boolean): AsyncGenerator<number> {
    if (dot) yield 46;
    const first = this.current;
    yield first; this.current = await this.readByte();
    let hexadecimal = false;
    if (first === 48 && (this.current === 120 || this.current === 88)) {
      hexadecimal = true; yield this.current; this.current = await this.readByte();
    }
    for (;;) {
      if (hexadecimal ? this.current === 112 || this.current === 80 : this.current === 101 || this.current === 69) {
        yield this.current; this.current = await this.readByte();
        if (this.current === 45 || this.current === 43) {yield this.current; this.current = await this.readByte();}
      }
      if (hex(this.current) >= 0 || this.current === 46) {yield this.current; this.current = await this.readByte();}
      else return;
    }
  }
  private async number(line: number, dot = false): Promise<LuaToken> {
    const source = await this.store(this.numeral(dot));
    try {return {kind: "number", line, value: await this.numbers.parse(source)};}
    catch (error) {
      if (error instanceof PandocError && error.code === "E_AST") this.error("malformed number");
      throw error;
    }
  }
  private async scan(): Promise<LuaToken> {
    if (this.current === -2) this.current = await this.readByte();
    for (;;) {
      if (newline(this.current)) {await this.linebreak(); continue;}
      if (space(this.current)) {this.current = await this.readByte(); continue;}
      const line = this.line, first = this.current;
      if (first < 0) return {kind: "eof", line};
      if (first === 45) {
        this.current = await this.readByte();
        if (this.current !== 45) return {kind: "-", line};
        this.current = await this.readByte();
        if (this.current === 91) {
          const separator = await this.delimiter();
          if (separator >= 0) {for await (const ignored of this.long(separator, true)) void ignored; continue;}
        }
        while (this.current >= 0 && !newline(this.current)) this.current = await this.readByte();
        continue;
      }
      if (first === 91) {
        const separator = await this.delimiter();
        if (separator >= 0) return {kind: "string", line, value: await this.intern(await this.store(this.long(separator, false)))};
        if (separator !== -1) this.error("invalid long string delimiter");
        return {kind: "[", line};
      }
      if (first === 34 || first === 39) return {kind: "string", line, value: await this.intern(await this.store(this.quoted(first)))};
      if (digit(first)) return await this.number(line);
      if (alpha(first)) {
        const raw = await this.store(this.identifier());
        let prefix = "";
        if (await this.heap.byteLength(raw) <= 8) {
          for await (const chunk of this.heap.bytes(raw)) prefix += String.fromCharCode(...chunk);
        }
        const value = await this.intern(raw);
        return keywords.has(prefix) ? {kind: prefix, line} : {kind: "name", line, value};
      }
      this.current = await this.readByte();
      if (first === 46) {
        if (this.current === 46) {this.current = await this.readByte(); if (this.current === 46) {this.current = await this.readByte(); return {kind: "...", line};} return {kind: "..", line};}
        if (digit(this.current)) return await this.number(line, true);
      }
      if ((first === 61 || first === 60 || first === 62 || first === 126) && this.current === 61 ||
          (first === 60 || first === 62 || first === 47 || first === 58) && this.current === first) {
        const kind = String.fromCharCode(first, this.current); this.current = await this.readByte(); return {kind, line};
      }
      return {kind: String.fromCharCode(first), line};
    }
  }
  async next(): Promise<LuaToken> {
    try {
      await this.cooperate(0);
      const token = await this.scan();
      await this.cooperate(this.units); this.units = 0;
      return token;
    } catch (error) {
      try {await this.close();} catch { /* Preserve the primary reader, syntax or cancellation failure. */ }
      throw error;
    }
  }
}
