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
  try {
  const cursor = createTokenCursor(text, options);
  const pattern = readPatterns(cursor);
  while (cursor.peek().kind === "newline") cursor.take();
  if (cursor.peek().kind !== "end") throw cursor.error("unexpected token after pattern");
  return pattern;
  } finally {options.meter?.checkpoint();}
}

export function readPatterns(cursor: TokenCursor): Pattern {
  try {
  cursor.meter?.checkpoint();
  const { items, comma, end } = readPatternItems(cursor);
  const first = items[0]!;
  if (!comma) {
    if (first.kind === "star") throw cursor.error("star pattern requires a sequence");
    return first;
  }
  cursor.meter?.checkpoint(0,64);
  return { kind: "sequence", items, start: first.start, end };
  } finally {cursor.meter?.checkpoint();}
}

function readPatternItems(cursor: TokenCursor): { items: Pattern[]; comma: boolean; end: Pattern["end"] } {
  cursor.meter?.checkpoint(1,104);
  const first = readMaybeStar(cursor);
  const comma = cursor.peek().text === ",";
  const items = [first];
  let end = first.end;
  while (cursor.peek().text === ",") {
    end = cursor.take().end;
    const next=cursor.peek();
    if (next.text===":"||next.text==="if"||next.text===")"||next.text==="]"||next.kind==="newline"||next.kind==="end") break;
    cursor.meter?.checkpoint(0,8);
    items.push(readMaybeStar(cursor));
    end = items[items.length - 1]!.end;
  }
  return { items, comma, end };
}

function readPattern(cursor: TokenCursor): Pattern {
  let restore:(()=>void)|undefined;
  try {
  cursor.meter?.checkpoint(1,40);
  restore=cursor.enterRecursiveCall?.();
  const first = readClosed(cursor);
  const patterns = [first];
  while (cursor.peek().text === "|") { cursor.take(); cursor.meter?.checkpoint(0,8);patterns.push(readClosed(cursor)); }
  if(patterns.length!==1)cursor.meter?.checkpoint(0,64);
  let pattern: Pattern = patterns.length === 1 ? first : { kind: "or", patterns, start: first.start, end: patterns[patterns.length - 1]!.end };
  if (cursor.peek().text === "as") {
    cursor.take();
    const name = readBinding(cursor, false)!;
    cursor.meter?.checkpoint(0,80);
    pattern = { kind: "as", pattern, name, start: pattern.start, end: name.end };
  }
  return pattern;
  } finally {try{restore?.();}finally{cursor.meter?.checkpoint();}}
}

function readMaybeStar(cursor: TokenCursor): Pattern {
  if (cursor.peek().text !== "*") return readPattern(cursor);
  const start = cursor.take().start;
  const end = cursor.peek().end;
  const name = readBinding(cursor, true);
  cursor.meter?.checkpoint(0,64);
  return { kind: "star", name, start, end };
}

function readClosed(cursor: TokenCursor): Pattern {
  const first = cursor.peek();
  if (first.text === "[" || first.text === "(") {
    cursor.take();
    const close = first.text === "[" ? "]" : ")";
    if (cursor.peek().text === close) {cursor.meter?.checkpoint(0,96);return { kind: "sequence", items: [], start: first.start, end: cursor.take().end };}
    const { items, comma } = readPatternItems(cursor);
    const end = cursor.expect(close).end;
    if (first.text === "(" && !comma) {
      if (items[0]!.kind === "star") throw cursor.error("star pattern requires a sequence");
      cursor.meter?.checkpoint(0,128);
      return { ...items[0]!, start: first.start, end };
    }
    cursor.meter?.checkpoint(0,64);
    return { kind: "sequence", items, start: first.start, end };
  }
  if (first.text === "{") return readMapping(cursor);
  if (first.text === "_") {
    cursor.take();
    cursor.meter?.checkpoint(0,64);
    return { kind: "capture", name: null, start: first.start, end: first.end };
  }
  const singleton=first.text==="True"||first.text==="False"||first.text==="None";
  if (first.kind !== "name" || singleton) {
    const value = readPatternLiteral(cursor);
    cursor.meter?.checkpoint(0,64);
    return { kind: singleton ? "singleton" : "value", value, start: value.start, end: value.end };
  }
  const value = readNamePath(cursor);
  if (cursor.peek().text === "(") return readClassPattern(cursor, value);
  cursor.meter?.checkpoint(0,64);
  if (value.kind === "attribute") return { kind: "value", value, start: value.start, end: value.end };
  if (value.kind !== "name") throw cursor.error("expected capture pattern");
  if (value.name === "__debug__") throw cursor.error("cannot assign to __debug__");
  return { kind: "capture", name: value.spelling === "_" ? null : value, start: value.start, end: value.end };
}

function readName(cursor: TokenCursor): DeclaredName {
  cursor.meter?.checkpoint(1,64);
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
  cursor.meter?.checkpoint(1,80);
  const name = readName(cursor);
  let value: Expression = { kind: "name", ...name };
  while (cursor.peek().text === ".") {
    cursor.take();
    const attribute = readName(cursor);
    cursor.meter?.checkpoint(0,144);
    value = { kind: "attribute", object: value, ...attribute, nameSpan:{start:attribute.start,end:attribute.end}, start: value.start };
  }
  return value;
}

function readMapping(cursor: TokenCursor): Pattern {
  cursor.meter?.checkpoint(1,112);
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
    const key = first.kind === "name" && first.text!=="True"&&first.text!=="False"&&first.text!=="None" ? readNamePath(cursor) : readPatternLiteral(cursor);
    if (key.kind === "name") throw cursor.error("mapping keys must be literals or dotted values");
    cursor.expect(":");
    cursor.meter?.checkpoint(0,56);
    entries.push({ key, pattern: readPattern(cursor) });
    if (cursor.peek().text !== ",") break;
    cursor.take();
  }
  return { kind: "mapping", entries, rest, start, end: cursor.expect("}").end };
}

function readClassPattern(cursor: TokenCursor, cls: Expression): Pattern {
  cursor.meter?.checkpoint(1,224);
  cursor.expect("(");
  const positional: Pattern[] = [];
  const keywords: { name: DeclaredName; pattern: Pattern }[] = [];
  const names = new Set<string>();
  while (cursor.peek().text !== ")") {
    cursor.meter?.checkpoint(0,64);
    const name = cursor.attempt(() => { const name = readName(cursor); cursor.expect("="); return name; });
    const pattern = readPattern(cursor);
    if (name) {
      cursor.meter?.checkpoint(1+name.name.length);
      if (names.has(name.name)) throw cursor.error("attribute name repeated in class pattern");
      cursor.meter?.checkpoint(0,88);
      names.add(name.name);
      keywords.push({ name, pattern });
    } else {
      if (keywords.length) throw cursor.error("positional patterns follow keyword patterns");
      cursor.meter?.checkpoint(0,8);
      positional.push(pattern);
    }
    if (cursor.peek().text !== ",") break;
    cursor.take();
  }
  return { kind: "class", class: cls, positional, keywords, start: cls.start, end: cursor.expect(")").end };
}
