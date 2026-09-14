import {decodeStringLiteral} from "./string-literal-decoding.js";
import type { PythonSource, SourcePosition } from "./source.js";
import { lookupUnicodeName } from "./unicode-names.js";

export type StringToken = {
  readonly text: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
} & (
  | { readonly kind: "string"; readonly value: Uint32Array }
  | { readonly kind: "bytes"; readonly value: Uint8Array }
);

const simpleEscapes: Readonly<Record<string, number>> = {
  a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11,
  "\\": 92, "'": 39, '"': 34
};

/** Reads ordinary/raw text and bytes; interpolated f/t strings use expression parsing. */
export function readString(
  source: PythonSource,
  onWarning?: (message: string, position: SourcePosition) => void
): StringToken;
export function readString(source: PythonSource, onWarning: ((message: string, position: SourcePosition) => void) | undefined, decode: boolean): StringToken | undefined;
export function readString(
  source: PythonSource,
  onWarning?: (message: string, position: SourcePosition) => void,
  decode = true
): StringToken | undefined {
  try {
  source.meter?.checkpoint(1,240);
  const start = source.position;
  let prefix = "";
  while (prefix.length < 2 && "rRuUbB".includes(source.peek()) && !source.done) {
    source.meter?.checkpoint(0,80);
    prefix += source.advance().toLowerCase();
  }
  if (prefix!==""&&prefix!=="r"&&prefix!=="u"&&prefix!=="b"&&prefix!=="br"&&prefix!=="rb") {
    throw source.error("invalid string prefix", start);
  }
  const quote = source.advance();
  if (quote !== "'" && quote !== '"') throw source.error("expected string literal", start);
  const triple = source.peek() === quote && source.peek(1) === quote;
  if (triple) { source.advance(); source.advance(); }
  const bytes = prefix.includes("b");
  const raw = prefix.includes("r");
  const contentStart = source.position;
  while (!source.done) {
    const character = source.peek();
    if (character === quote && (!triple || (source.peek(1) === quote && source.peek(2) === quote))) {
      const contentEnd = source.position;
      source.advance();
      if (triple) { source.advance(); source.advance(); }
      if (!decode) return;
      const end=source.position;
      source.meter?.checkpoint(1+end.offset-start.offset,32+2*(end.offset-start.offset));
      const span = { start, end, text: source.text.slice(start.offset, end.offset) };
      const value = decodeStringLiteral(source, contentStart, contentEnd, start, end, bytes, raw, onWarning);
      source.meter?.checkpoint(0,64);
      return bytes
        ? { ...span, kind: "bytes", value: value as Uint8Array }
        : { ...span, kind: "string", value: value as Uint32Array };
    }
    if (character === "\n" && !triple) throw source.error("unterminated string literal", start);
    source.advance();
    // Establish the complete lexical token before decoding its bounded content.
    // In particular, malformed named escapes cannot consume a closing quote.
    if (character === "\\" && !source.done) source.advance();
  }
  throw source.error(triple ? "unterminated triple-quoted string literal" : "unterminated string literal", start);
  } finally {source.meter?.checkpoint();}
}

export {escapeWarning} from "./string-literal-decoding.js";

export function readEscape(
  source: PythonSource,
  bytes: boolean,
  position: SourcePosition,
  warn: (escape: string, position: SourcePosition, octal?: boolean) => void
): number[] {
  try {
  source.meter?.checkpoint(1,48);
  const escape = source.advance();
  if (escape === "\n") return [];
  const simple = simpleEscapes[escape];
  if (simple !== undefined) return [simple];
  if (escape >= "0" && escape <= "7") {
    let octal = escape;
    while (octal.length < 3 && source.peek() >= "0" && source.peek() <= "7") {source.meter?.checkpoint(0,40);octal += source.advance();}
    source.meter?.checkpoint(1+octal.length);
    const value = Number.parseInt(octal, 8);
    if (value > 255) warn(octal, position, true);
    return [bytes ? value & 255 : value];
  }
  if (escape === "x" || (!bytes && (escape === "u" || escape === "U"))) {
    const width = escape === "x" ? 2 : escape === "u" ? 4 : 8;
    let value = 0;
    for (let index = 0; index < width; index++) {
      source.meter?.checkpoint(0,40);
      const character = source.peek().toLowerCase();
      const digit = "0123456789abcdef".indexOf(character);
      if (character === "" || digit < 0) {source.meter?.checkpoint(0,96);throw source.error(`truncated \\${escape} escape`, position);}
      value = value * 16 + digit;
      source.advance();
    }
    if (value > 0x10ffff) throw source.error("illegal Unicode character", position);
    return [value];
  }
  if (!bytes && escape === "N") {
    if (source.peek() !== "{") throw source.error("malformed \\N character escape", position);
    source.advance();
    let name = "";
    while (!source.done && source.peek() !== "}") {
      const character=source.advance();source.meter?.checkpoint(0,64+2*character.length);name+=character;
    }
    if (source.done || name === "") throw source.error("malformed \\N character escape", position);
    source.advance();
    source.meter?.checkpoint(1+name.length,32+2*name.length);
    const character = lookupUnicodeName(name,source.meter);
    if (character === undefined) throw source.error("unknown Unicode character name", position);
    return [character.codePointAt(0)!];
  }
  if (escape.codePointAt(0)! < 128) warn(escape, position);
  return [92, escape.codePointAt(0)!];
  } finally {source.meter?.checkpoint();}
}
