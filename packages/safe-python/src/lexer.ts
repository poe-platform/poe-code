import { PythonSource } from "./source.js";
import type { SourcePosition } from "./source.js";
import { Indentation } from "./indentation.js";
import { isIdentifierStart, readIdentifier } from "./identifiers.js";
import type { NameToken } from "./identifiers.js";
import { readNumber } from "./numbers.js";
import type { NumberToken } from "./numbers.js";
import { readString } from "./strings.js";
import type { StringToken } from "./strings.js";

export interface StructuralToken {
  readonly kind: "operator" | "newline" | "indent" | "dedent" | "end";
  readonly text: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export type Token = NameToken | NumberToken | StringToken | StructuralToken;

export interface LexerOptions {
  readonly filename?: string;
  readonly onWarning?: (message: string, position: SourcePosition) => void;
}

const operators = new Set([
  "**=", "//=", "<<=", ">>=", "...", "+=", "-=", "*=", "/=", "%=", "@=", "&=", "|=", "^=",
  "**", "//", "<<", ">>", "<=", ">=", "==", "!=", ":=", "->",
  "+", "-", "*", "/", "%", "@", "&", "|", "^", "~", "<", ">", "=", ":", ".", ",", ";", "!",
  "(", ")", "[", "]", "{", "}"
]);
const closingDelimiters: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };
const ordinaryPrefixes = new Set(["r", "u", "b", "br", "rb"]);
const interpolatedPrefixes = new Set(["f", "fr", "rf", "t", "tr", "rt"]);

/** Lazily emits significant tokens; comments and non-logical newlines are omitted. */
export function* lex(text: string, options: LexerOptions = {}): Generator<Token, void> {
  const source = new PythonSource(text, options.filename);
  const indentation = new Indentation();
  const delimiters: Array<{ text: string; start: SourcePosition }> = [];
  let lineStart = true;
  let lineHasCode = false;
  let pendingIndent: { text: string; start: SourcePosition; end: SourcePosition } | undefined;
  while (!source.done) {
    if (lineStart) {
      const start = source.position;
      while (isSpace(source.peek())) source.advance();
      pendingIndent = delimiters.length ? undefined : {
        text: text.slice(start.offset, source.position.offset), start, end: source.position
      };
      lineStart = false;
      if (source.done) break;
    }
    const character = source.peek();
    if (isSpace(character)) { source.advance(); continue; }
    if (character === "#") {
      while (!source.done && source.peek() !== "\n") source.advance();
      continue;
    }
    if (character === "\n") {
      const start = source.position;
      source.advance();
      if (!delimiters.length && lineHasCode) {
        yield { kind: "newline", text: "\n", start, end: source.position };
        lineHasCode = false;
      }
      lineStart = true;
      pendingIndent = undefined;
      continue;
    }
    if (character === "\\") {
      const start = source.position;
      source.advance();
      if (source.peek() !== "\n") throw source.error("unexpected character after line continuation character", start);
      source.advance();
      if (source.done) throw source.error("unexpected EOF after line continuation character", start);
      continue;
    }
    // A backslash may join this prefix to a blank/comment-only physical line.
    // Only a real token makes the logical line's indentation significant.
    if (pendingIndent) {
      for (const kind of indentation.accept(pendingIndent.text, source)) {
        yield kind === "INDENT"
          ? { kind: "indent", ...pendingIndent }
          : { kind: "dedent", text: "", start: source.position, end: source.position };
      }
      pendingIndent = undefined;
    }
    lineHasCode = true;
    const prefix = stringPrefix(source);
    if (prefix === "interpolated") {
      throw source.error("interpolated string tokenization is not implemented yet");
    }
    if (prefix === "ordinary") {
      yield readString(source, options.onWarning);
      continue;
    }
    if (isIdentifierStart(character.codePointAt(0)!)) {
      yield readIdentifier(source);
      continue;
    }
    if ((character >= "0" && character <= "9") ||
        (character === "." && source.peek(1) >= "0" && source.peek(1) <= "9")) {
      yield readNumber(source, options.onWarning);
      continue;
    }
    let operator = source.peek() + source.peek(1) + source.peek(2);
    while (operator && !operators.has(operator)) operator = operator.slice(0, -1);
    if (!operator) throw source.error(`invalid character ${JSON.stringify(character)}`);
    const start = source.position;
    if (operator === "(" || operator === "[" || operator === "{") delimiters.push({ text: operator, start });
    const opening = closingDelimiters[operator];
    if (opening) {
      const expected = delimiters.pop();
      if (!expected) throw source.error(`unmatched '${operator}'`, start);
      if (expected.text !== opening) {
        throw source.error(`closing parenthesis '${operator}' does not match opening parenthesis '${expected.text}'`, start);
      }
    }
    for (let index = 0; index < operator.length; index++) source.advance();
    yield { kind: "operator", text: operator, start, end: source.position };
  }
  const unclosed = delimiters[delimiters.length - 1];
  if (unclosed) throw source.error(`'${unclosed.text}' was never closed`, unclosed.start);
  const end = source.position;
  if (lineHasCode) yield { kind: "newline", text: "", start: end, end };
  const dedents = indentation.finish().length;
  for (let index = 0; index < dedents; index++) yield { kind: "dedent", text: "", start: end, end };
  yield { kind: "end", text: "", start: end, end };
}

function isSpace(character: string): boolean {
  return character === " " || character === "\t" || character === "\f";
}

function stringPrefix(source: PythonSource): "ordinary" | "interpolated" | undefined {
  if (source.peek() === "'" || source.peek() === '"') return "ordinary";
  let prefix = "";
  for (let length = 1; length <= 2; length++) {
    prefix += source.peek(length - 1).toLowerCase();
    const next = source.peek(length);
    if (next === "'" || next === '"') {
      if (ordinaryPrefixes.has(prefix)) return "ordinary";
      if (interpolatedPrefixes.has(prefix)) return "interpolated";
    }
  }
  return undefined;
}
