import type { Expression } from "./ast.js";
import type { LexerOptions } from "./lexer.js";
import type { Pattern } from "./pattern-ast.js";
import type { DeclaredName } from "./statement-ast.js";
import { createTokenCursor, type TokenCursor } from "./token-cursor.js";
import { reservedWords } from "./keywords.js";
import { normalizeNfkc } from "./normalization.js";
import { readPatternLiteral } from "./pattern-literals.js";

/** Parse pattern grammar; cross-pattern binding validation is a separate phase. */
export function parsePattern(text: string, options: LexerOptions = {}): Pattern {
  const cursor = createTokenCursor(text, options);
  const pattern = readPatterns(cursor);
  while (cursor.peek().kind === "newline") cursor.take();
  if (cursor.peek().kind !== "end") throw cursor.error("unexpected token after pattern");
  return pattern;
}

export function readPatterns(cursor: TokenCursor): Pattern {
  const { items, comma, end } = readPatternItems(cursor);
  const first = items[0]!;
  if (!comma) {
    if (first.kind === "star") throw cursor.error("star pattern requires a sequence");
    return first;
  }
  return { kind: "sequence", items, start: first.start, end };
}

function readPatternItems(cursor: TokenCursor): { items: Pattern[]; comma: boolean; end: Pattern["end"] } {
  const first = readMaybeStar(cursor);
  const comma = cursor.peek().text === ",";
  const items = [first];
  let end = first.end;
  while (cursor.peek().text === ",") {
    end = cursor.take().end;
    if ([":", "if", ")", "]"].includes(cursor.peek().text) || cursor.peek().kind === "newline" || cursor.peek().kind === "end") break;
    items.push(readMaybeStar(cursor));
    end = items[items.length - 1]!.end;
  }
  return { items, comma, end };
}

function readPattern(cursor: TokenCursor): Pattern {
  const first = readClosed(cursor);
  const patterns = [first];
  while (cursor.peek().text === "|") { cursor.take(); patterns.push(readClosed(cursor)); }
  let pattern: Pattern = patterns.length === 1 ? first : { kind: "or", patterns, start: first.start, end: patterns[patterns.length - 1]!.end };
  if (cursor.peek().text === "as") {
    cursor.take();
    const name = readBinding(cursor, false)!;
    pattern = { kind: "as", pattern, name, start: pattern.start, end: name.end };
  }
  return pattern;
}

function readMaybeStar(cursor: TokenCursor): Pattern {
  if (cursor.peek().text !== "*") return readPattern(cursor);
  const start = cursor.take().start;
  const end = cursor.peek().end;
  const name = readBinding(cursor, true);
  return { kind: "star", name, start, end };
}

function readClosed(cursor: TokenCursor): Pattern {
  const first = cursor.peek();
  if (first.text === "[" || first.text === "(") {
    cursor.take();
    const close = first.text === "[" ? "]" : ")";
    if (cursor.peek().text === close) return { kind: "sequence", items: [], start: first.start, end: cursor.take().end };
    const { items, comma } = readPatternItems(cursor);
    const end = cursor.expect(close).end;
    if (first.text === "(" && !comma) {
      if (items[0]!.kind === "star") throw cursor.error("star pattern requires a sequence");
      return { ...items[0]!, start: first.start, end };
    }
    return { kind: "sequence", items, start: first.start, end };
  }
  if (first.text === "{") return readMapping(cursor);
  if (first.text === "_") {
    cursor.take();
    return { kind: "capture", name: null, start: first.start, end: first.end };
  }
  if (first.kind !== "name" || ["True", "False", "None"].includes(first.text)) {
    const value = readPatternLiteral(cursor);
    return { kind: ["True", "False", "None"].includes(first.text) ? "singleton" : "value", value, start: value.start, end: value.end };
  }
  const value = readNamePath(cursor);
  if (cursor.peek().text === "(") return readClassPattern(cursor, value);
  if (value.kind === "attribute") return { kind: "value", value, start: value.start, end: value.end };
  if (value.kind !== "name") throw cursor.error("expected capture pattern");
  if (value.name === "__debug__") throw cursor.error("cannot assign to __debug__");
  return { kind: "capture", name: value.spelling === "_" ? null : value, start: value.start, end: value.end };
}

function readName(cursor: TokenCursor): DeclaredName {
  const token = cursor.peek();
  if (token.kind !== "name" || reservedWords.has(token.text)) throw cursor.error("expected pattern name");
  cursor.take();
  return { name: normalizeNfkc(token.text,cursor.meter), spelling: token.text, start: token.start, end: token.end };
}

function readBinding(cursor: TokenCursor, wildcard: boolean): DeclaredName | null {
  const name = readName(cursor);
  if (name.name === "__debug__" || (!wildcard && name.spelling === "_")) throw cursor.error("invalid pattern binding");
  return name.spelling === "_" ? null : name;
}

function readNamePath(cursor: TokenCursor): Expression {
  const name = readName(cursor);
  let value: Expression = { kind: "name", ...name };
  while (cursor.peek().text === ".") {
    cursor.take();
    const attribute = readName(cursor);
    value = { kind: "attribute", object: value, ...attribute, nameSpan:{start:attribute.start,end:attribute.end}, start: value.start };
  }
  return value;
}

function readMapping(cursor: TokenCursor): Pattern {
  const start = cursor.expect("{").start;
  const entries: { key: Expression; pattern: Pattern }[] = [];
  let rest: DeclaredName | null = null;
  while (cursor.peek().text !== "}") {
    if (cursor.peek().text === "**") {
      cursor.take();
      rest = readBinding(cursor, false);
      if (cursor.peek().text === ",") cursor.take();
      break;
    }
    const first = cursor.peek();
    const key = first.kind === "name" && !["True", "False", "None"].includes(first.text) ? readNamePath(cursor) : readPatternLiteral(cursor);
    if (key.kind === "name") throw cursor.error("mapping keys must be literals or dotted values");
    cursor.expect(":");
    entries.push({ key, pattern: readPattern(cursor) });
    if (cursor.peek().text !== ",") break;
    cursor.take();
  }
  return { kind: "mapping", entries, rest, start, end: cursor.expect("}").end };
}

function readClassPattern(cursor: TokenCursor, cls: Expression): Pattern {
  cursor.expect("(");
  const positional: Pattern[] = [];
  const keywords: { name: DeclaredName; pattern: Pattern }[] = [];
  const names = new Set<string>();
  while (cursor.peek().text !== ")") {
    const name = cursor.attempt(() => { const name = readName(cursor); cursor.expect("="); return name; });
    const pattern = readPattern(cursor);
    if (name) {
      if (names.has(name.name)) throw cursor.error("attribute name repeated in class pattern");
      names.add(name.name);
      keywords.push({ name, pattern });
    } else {
      if (keywords.length) throw cursor.error("positional patterns follow keyword patterns");
      positional.push(pattern);
    }
    if (cursor.peek().text !== ",") break;
    cursor.take();
  }
  return { kind: "class", class: cls, positional, keywords, start: cls.start, end: cursor.expect(")").end };
}
