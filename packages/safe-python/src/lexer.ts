import { PythonSource, PythonSyntaxError } from "./source.js";
import { isUnicodeCharacter } from "./runtime/unicode-character-classification.js";
import type { SourcePosition,SourceMeter } from "./source.js";
import { Indentation } from "./indentation.js";
import { isIdentifierStart, readIdentifier } from "./identifiers.js";
import type { NameToken } from "./identifiers.js";
import { readNumber } from "./numbers.js";
import type { NumberToken } from "./numbers.js";
import { readString } from "./strings.js";
import type { StringToken } from "./strings.js";
import { Interpolation } from "./interpolation.js";
import type { InterpolatedToken } from "./interpolation.js";
import type { SourceSpan } from "./ast.js";
import {maximumDelimiterDepth} from "./lexical-limits.js";

export interface StructuralToken {
  readonly kind: "operator" | "newline" | "indent" | "dedent" | "end";
  readonly text: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export type Token = NameToken | NumberToken | StringToken | StructuralToken | InterpolatedToken;

export interface LexerOptions {
  /** Explicit/inherited future compiler bits, isolated per parse. */
  readonly futureFlags?:number;
  /** Accounts scanning, cursor work and expression validation, not all AST/analysis work. */
  readonly meter?:SourceMeter;
  /** Host-owned expression/pattern recursion guard. Successful entry returns an
   * unmetered restoration; resource failures must not be syntax errors. */
  readonly enterRecursiveCall?:()=>()=>void;
  readonly filename?: string;
  readonly onWarning?: (message: string, position: SourcePosition) => void;
  readonly onComment?: (span: SourceSpan) => void;
  /** Shared cursor state: after grammar failure, scan literal boundaries
   * without constructing their values or invoking decoder warnings. */
  readonly tokenization?: { syntaxOnly: boolean; readonly implicitNewline?:boolean };
}

const operators = new Set([
  "**=", "//=", "<<=", ">>=", "...", "+=", "-=", "*=", "/=", "%=", "@=", "&=", "|=", "^=",
  "**", "//", "<<", ">>", "<=", ">=", "==", "!=", "<>", ":=", "->",
  "+", "-", "*", "/", "%", "@", "&", "|", "^", "~", "<", ">", "=", ":", ".", ",", ";", "!",
  "(", ")", "[", "]", "{", "}"
]);
const closingDelimiters: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };
const ordinaryPrefixes = new Set(["r", "u", "b", "br", "rb"]);
const interpolatedPrefixes = new Set(["f", "fr", "rf", "t", "tr", "rt"]);

/** Lazily emits significant tokens; comments and non-logical newlines are omitted. */
export function* lex(text: string, options: LexerOptions = {}): Generator<Token, void> {
  let interpolation: Interpolation | undefined;
  try {
  options.meter?.checkpoint(1,128);
  const source = new PythonSource(text, options.filename,options.meter);
  const indentation = new Indentation(options.meter);
  interpolation = new Interpolation(options.meter,options.tokenization!==undefined,options.tokenization?.implicitNewline??true);
  const delimiters: Array<{ text: string; start: SourcePosition }> = [];
  let lineStart = true;
  let lineHasCode = false;
  let pendingIndent: { text: string; start: SourcePosition; end: SourcePosition } | undefined;
  while (!source.done) {
    if (interpolation.inText) {
      const token = interpolation.readText(source, delimiters.length, options.onWarning, !options.tokenization?.syntaxOnly);
      if (token !== undefined) yield token;
      continue;
    }
    if (lineStart) {
      const start = source.position;
      while (isSpace(source.peek())) source.advance();
      if(delimiters.length||interpolation.active)pendingIndent=undefined;
      else{
        const end=source.position;
        options.meter?.checkpoint(1+end.offset-start.offset,96+2*(end.offset-start.offset));
        pendingIndent={text:text.slice(start.offset,end.offset),start,end};
      }
      lineStart = false;
      if (source.done) break;
    }
    const character = source.peek();
    if (isSpace(character)) { source.advance(); continue; }
    if (character === "#") {
      const start = source.position;
      while (!source.done && source.peek() !== "\n") source.advance();
      options.meter?.checkpoint(0,48);
      options.onComment?.({ start, end: source.position });
      continue;
    }
    if (character === "\n") {
      const start = source.position;
      source.advance();
      if (!delimiters.length && !interpolation.active && lineHasCode) {
        options.meter?.checkpoint(0,64);
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
      for (const kind of indentation.accept(pendingIndent.text, source,pendingIndent.start)) {
        options.meter?.checkpoint(1,64);
        yield kind === "INDENT"
          ? { kind: "indent", ...pendingIndent }
          : { kind: "dedent", text: "", start: source.position, end: source.position };
      }
      pendingIndent = undefined;
    }
    lineHasCode = true;
    const boundary = interpolation.boundary(source, delimiters.length);
    if (boundary) { yield boundary; continue; }
    const prefix = stringPrefix(source);
    if (prefix === "interpolated") {
      yield interpolation.begin(source);
      continue;
    }
    if (prefix === "ordinary") {
      const token = readString(source, options.onWarning, !options.tokenization?.syntaxOnly);
      if (token !== undefined) yield token;
      continue;
    }
    if (isIdentifierStart(character.codePointAt(0)!)) {
      const identifier = readIdentifier(source);
      // CPython validates the entire potential identifier before publishing a
      // NAME token. A non-ASCII invalid suffix must not become a second token.
      if ((source.peek().codePointAt(0) ?? 0) >= 128) throwInvalidSourceCharacter(source);
      yield identifier;
      continue;
    }
    if ((character >= "0" && character <= "9") ||
        (character === "." && source.peek(1) >= "0" && source.peek(1) <= "9")) {
      yield readNumber(source, options.onWarning);
      continue;
    }
    options.meter?.checkpoint(0,96);
    let operator = source.peek() + source.peek(1) + source.peek(2);
    while (operator && !operators.has(operator)) {options.meter?.checkpoint(1,32+2*operator.length);operator = operator.slice(0, -1);}
    if (!operator) {
      const point = character.codePointAt(0)!;
      if (point >= 128 || !isUnicodeCharacter(point, "isprintable", source.meter)) throwInvalidSourceCharacter(source);
      options.meter?.checkpoint(0,128);throw source.error(`invalid character ${JSON.stringify(character)}`);
    }
    const start = source.position;
    if (operator === "(" || operator === "[" || operator === "{") {
      if(delimiters.length+interpolation.replacementDepth>=maximumDelimiterDepth)throw source.error("too many nested parentheses",start);
      options.meter?.checkpoint(0,56);
      delimiters.push({ text: operator, start });
    }
    const opening = closingDelimiters[operator];
    if (opening) {
      if (interpolation.fieldDepth !== undefined && delimiters.length <= interpolation.fieldDepth) {
        options.meter?.checkpoint(0,128);
        throw source.error(`unmatched '${operator}' in replacement field`, start);
      }
      const expected = delimiters.pop();
      if (!expected) {options.meter?.checkpoint(0,96);throw source.error(`unmatched '${operator}'`, start);}
      if (expected.text !== opening) {
        options.meter?.checkpoint(0,256);
        throw source.error(`closing parenthesis '${operator}' does not match opening parenthesis '${expected.text}'`, start);
      }
    }
    for (let index = 0; index < operator.length; index++) source.advance();
    options.meter?.checkpoint(0,64);
    yield { kind: "operator", text: operator, start, end: source.position };
  }
  interpolation.assertClosed(source);
  const unclosed = delimiters[delimiters.length - 1];
  if (unclosed) {
    options.meter?.checkpoint(0,192);
    const error = new PythonSyntaxError(`'${unclosed.text}' was never closed`, source.filename,
      unclosed.start, {...unclosed.start, column: -1});
    error.tokenizerPriority = "earlier-line";
    error.unclosedDelimiter = true;
    throw error;
  }
  const end = source.position;
  if (lineHasCode) {options.meter?.checkpoint(0,64);yield { kind: "newline", text: "", start: end, end };}
  const dedents = indentation.finish(options.meter).length;
  for (let index = 0; index < dedents; index++) {options.meter?.checkpoint(1,64);yield { kind: "dedent", text: "", start: end, end };}
  options.meter?.checkpoint(0,64);
  yield { kind: "end", text: "", start: end, end };
  } catch (error) {
    if (error instanceof PythonSyntaxError) error.tokenizerPriority ??= interpolation?.active ? "parser" : "always";
    throw error;
  } finally {options.meter?.checkpoint();}
}

/** Tokenizer diagnostics use the first invalid point, an inclusive end column,
 * and the physical line without its newline. Classification is Unicode 16. */
function throwInvalidSourceCharacter(source: PythonSource): never {
  const position = source.position, character = source.peek(), point = character.codePointAt(0)!;
  const code = point.toString(16).toUpperCase().padStart(4, "0");
  const message = isUnicodeCharacter(point, "isprintable", source.meter)
    ? `invalid character '${character}' (U+${code})` : `invalid non-printable character U+${code}`;
  let start = position.offset, end = position.offset;
  while (start > 0 && source.text[start - 1] !== "\n" && source.text[start - 1] !== "\r") {source.meter?.checkpoint(); start--;}
  while (end < source.text.length && source.text[end] !== "\n" && source.text[end] !== "\r") {source.meter?.checkpoint(); end++;}
  if (start === 0 && source.text[0] === "\ufeff") start++;
  source.meter?.checkpoint(1, 320 + 2 * (message.length + end - start));
  throw new PythonSyntaxError(message, source.filename, position, position)
    .withSourceLine(source.text.slice(start, end), source.meter);
}

function isSpace(character: string): boolean {
  return character === " " || character === "\t" || character === "\f";
}

function stringPrefix(source: PythonSource): "ordinary" | "interpolated" | undefined {
  if (source.peek() === "'" || source.peek() === '"') return "ordinary";
  let prefix = "";
  for (let length = 1; length <= 2; length++) {
    source.meter?.checkpoint(0,80);
    prefix += source.peek(length - 1).toLowerCase();
    const next = source.peek(length);
    if (next === "'" || next === '"') {
      if (ordinaryPrefixes.has(prefix)) return "ordinary";
      if (interpolatedPrefixes.has(prefix)) return "interpolated";
    }
  }
  return undefined;
}
