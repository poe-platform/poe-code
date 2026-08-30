import { ShellSyntaxError } from "../types.js";
import type { Word, WordPart } from "../parser.js";

export interface LiteralIndex {
  readonly decimal: string;
}

export type ArraySelector =
  | { readonly kind: "element"; readonly index: LiteralIndex }
  | { readonly kind: "members"; readonly separator: "@" | "*" };

export interface ArrayEntry {
  readonly index?: LiteralIndex;
  readonly value: Word;
}

export type ArrayAssignment =
  | { readonly kind: "element"; readonly name: string; readonly index: LiteralIndex; readonly append: boolean; readonly value: Word }
  | { readonly kind: "compound"; readonly name: string; readonly append: boolean; readonly entries: readonly ArrayEntry[] };

const assignments = new WeakMap<Word, ArrayAssignment>();
const selectors = new WeakMap<WordPart, ArraySelector>();
const quoteMarkers = new WeakSet<WordPart>();

export function setQuoteMarker(part: WordPart, synthetic: boolean): void {
  if (synthetic) quoteMarkers.add(part);
  else quoteMarkers.delete(part);
}

export function isQuoteMarker(part: WordPart): boolean {
  return quoteMarkers.has(part);
}

export function literalIndex(source: string, offset: number): LiteralIndex {
  let decimal = source;
  if (source[0] === "'" || source[0] === '"') {
    if (source.length < 2 || source.at(-1) !== source[0]) throw new ShellSyntaxError("Unsupported indexed-array subscript", offset);
    decimal = source.slice(1, -1);
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(decimal)) throw new ShellSyntaxError("Unsupported indexed-array subscript", offset);
  return { decimal };
}

export function numericIndex(index: LiteralIndex): number | undefined {
  if (index.decimal.length > 10 || index.decimal.length === 10 && index.decimal > "2147483647") return undefined;
  return Number(index.decimal);
}

export function arraySelector(source: string, offset: number): ArraySelector {
  return source === "@" || source === "*"
    ? { kind: "members", separator: source }
    : { kind: "element", index: literalIndex(source, offset) };
}

export function setArraySelector(part: WordPart, selector: ArraySelector): void {
  selectors.set(part, selector);
}

export function getArraySelector(part: WordPart): ArraySelector | undefined {
  return selectors.get(part);
}

export function copyArraySelector(original: WordPart, copy: WordPart): WordPart {
  const selector = selectors.get(original);
  if (selector) selectors.set(copy, selector);
  setQuoteMarker(copy, isQuoteMarker(original));
  return copy;
}

export function setArrayAssignment(word: Word, assignment: ArrayAssignment): void {
  assignments.set(word, assignment);
}

export function getArrayAssignment(word: Word): ArrayAssignment | undefined {
  return assignments.get(word);
}

function removePrefix(word: Word, length: number): Word {
  const parts: WordPart[] = [];
  for (const part of word.parts) {
    if (length === 0) parts.push(part);
    else {
      if (part.kind !== "text") throw new ShellSyntaxError("Unsupported indexed-array subscript", word.offset);
      if (part.value.length <= length) length -= part.value.length;
      else {
        parts.push({ ...part, value: part.value.slice(length) });
        length = 0;
      }
    }
  }
  if (length !== 0) throw new ShellSyntaxError("Invalid indexed-array assignment", word.offset);
  return { offset: word.offset, parts };
}

export function elementAssignment(word: Word): Extract<ArrayAssignment, { kind: "element" }> | undefined {
  const source = word.spelling;
  const first = word.parts[0];
  if (source === undefined || first?.kind !== "text" || first.quoted) return undefined;
  const name = /^([a-zA-Z_][a-zA-Z_0-9]*)\[/u.exec(source)?.[1];
  if (!name) return undefined;
  const end = source.indexOf("]", name.length + 1);
  if (end < 0 || !/^(?:\+?=)/u.test(source.slice(end + 1))) {
    if (source.includes("=")) throw new ShellSyntaxError("Invalid indexed-array assignment", word.offset);
    return undefined;
  }
  const index = literalIndex(source.slice(name.length + 1, end), word.offset + name.length + 1);
  const append = source[end + 1] === "+";
  const value = removePrefix(word, name.length + index.decimal.length + (append ? 4 : 3));
  return { kind: "element", name, index, append, value };
}

export function compoundHead(word: Word): { readonly name: string; readonly append: boolean } | undefined {
  if (word.parts.length !== 1) return undefined;
  const first = word.parts[0];
  if (first?.kind !== "text" || first.quoted) return undefined;
  const match = /^([a-zA-Z_][a-zA-Z_0-9]*)(\+?)=$/u.exec(first.value);
  return match ? { name: match[1]!, append: match[2] === "+" } : undefined;
}

export function compoundEntry(word: Word): ArrayEntry {
  const source = word.spelling;
  const first = word.parts[0];
  if (source === undefined || source[0] !== "[" || first?.kind !== "text" || first.quoted) return { value: word };
  const end = source.indexOf("]", 1);
  if (end < 0 || source[end + 1] !== "=") {
    if (source.includes("=")) throw new ShellSyntaxError("Invalid indexed-array entry", word.offset);
    return { value: word };
  }
  const index = literalIndex(source.slice(1, end), word.offset + 1);
  return { index, value: removePrefix(word, index.decimal.length + 3) };
}

export function scalarAssignmentName(word: Word): string | undefined {
  const first = word.parts[0];
  return first?.kind === "text" && !first.quoted
    ? /^([a-zA-Z_][a-zA-Z_0-9]*)\+?=/u.exec(first.value)?.[1]
    : undefined;
}
