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
): StringToken {
  const start = source.position;
  let prefix = "";
  while (prefix.length < 2 && "rRuUbB".includes(source.peek()) && !source.done) {
    prefix += source.advance().toLowerCase();
  }
  if (!["", "r", "u", "b", "br", "rb"].includes(prefix)) {
    throw source.error("invalid string prefix", start);
  }
  const quote = source.advance();
  if (quote !== "'" && quote !== '"') throw source.error("expected string literal", start);
  const triple = source.peek() === quote && source.peek(1) === quote;
  if (triple) { source.advance(); source.advance(); }
  const bytes = prefix.includes("b");
  const raw = prefix.includes("r");
  const points: number[] = [];
  let warning: { message: string; position: SourcePosition } | undefined;
  const warn = (escape: string, position: SourcePosition, octal = false): void => {
    warning ??= {
      message: `"\\${escape}" is an invalid ${octal ? "octal " : ""}escape sequence. ` +
        `Such sequences will not work in the future. Did you mean "\\\\${escape}"? A raw string is also an option.`,
      position
    };
  };
  while (!source.done) {
    const character = source.peek();
    if (character === quote && (!triple || (source.peek(1) === quote && source.peek(2) === quote))) {
      source.advance();
      if (triple) { source.advance(); source.advance(); }
      const span = { start, end: source.position, text: source.text.slice(start.offset, source.position.offset) };
      if (warning) onWarning?.(warning.message, warning.position);
      return bytes
        ? { ...span, kind: "bytes", value: Uint8Array.from(points) }
        : { ...span, kind: "string", value: Uint32Array.from(points) };
    }
    if (character === "\n" && !triple) throw source.error("unterminated string literal", start);
    if (bytes && character.codePointAt(0)! > 127) {
      throw source.error("bytes can only contain ASCII literal characters", start);
    }
    const position = source.position;
    source.advance();
    if (character !== "\\") {
      points.push(character.codePointAt(0)!);
    } else {
      if (source.done) break;
      if (bytes && source.peek().codePointAt(0)! > 127) {
        throw source.error("bytes can only contain ASCII literal characters", start);
      }
      if (raw) points.push(92, source.advance().codePointAt(0)!);
      else points.push(...readEscape(source, bytes, position, warn));
    }
  }
  throw source.error(triple ? "unterminated triple-quoted string literal" : "unterminated string literal", start);
}

function readEscape(
  source: PythonSource,
  bytes: boolean,
  position: SourcePosition,
  warn: (escape: string, position: SourcePosition, octal?: boolean) => void
): number[] {
  const escape = source.advance();
  if (escape === "\n") return [];
  const simple = simpleEscapes[escape];
  if (simple !== undefined) return [simple];
  if (escape >= "0" && escape <= "7") {
    let octal = escape;
    while (octal.length < 3 && source.peek() >= "0" && source.peek() <= "7") octal += source.advance();
    const value = Number.parseInt(octal, 8);
    if (value > 255) warn(octal, position, true);
    return [bytes ? value & 255 : value];
  }
  if (escape === "x" || (!bytes && (escape === "u" || escape === "U"))) {
    const width = escape === "x" ? 2 : escape === "u" ? 4 : 8;
    let value = 0;
    for (let index = 0; index < width; index++) {
      const character = source.peek().toLowerCase();
      const digit = "0123456789abcdef".indexOf(character);
      if (character === "" || digit < 0) throw source.error(`truncated \\${escape} escape`, position);
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
    while (!source.done && source.peek() !== "}") name += source.advance();
    if (source.done || name === "") throw source.error("malformed \\N character escape", position);
    source.advance();
    const character = lookupUnicodeName(name);
    if (character === undefined) throw source.error("unknown Unicode character name", position);
    return [character.codePointAt(0)!];
  }
  if (escape.codePointAt(0)! < 128) warn(escape, position);
  return [92, escape.codePointAt(0)!];
}
