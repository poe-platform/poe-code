import type { CollectionItem, DictionaryEntry, Expression, SourceSpan } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readComprehensionClauses } from "./comprehensions.js";
import { readNamedExpression } from "./named-expression.js";
import { readYield } from "./yield-expression.js";

type ReadExpression = (cursor: TokenCursor, minimum?: number) => Expression;

/** Display parsing owns its commas; argument and subscription commas remain separate. */
export function readDisplay(cursor: TokenCursor, read: ReadExpression): Expression {
  try {
  cursor.meter?.checkpoint();
  const opening = cursor.take();
  if (opening.text === "{") return readBraces(cursor, read, opening);
  const close = opening.text === "(" ? ")" : "]";
  const kind = opening.text === "(" ? "tuple" : "list";
  if (opening.text === "(" && cursor.peek().text === "yield") {
    const value = readYield(cursor, read);
    cursor.meter?.checkpoint(0,160);
    return { ...value, contentSpan:value.contentSpan??{start:value.start,end:value.end}, start: opening.start, end: cursor.expect(")").end };
  }
  if (cursor.peek().text === close) {
    cursor.meter?.checkpoint(0,96);
    return { kind, items: [], start: opening.start, end: cursor.take().end };
  }
  const first = readItem(cursor, read);
  if (cursor.peek().text === "for" || cursor.peek().text === "async") {
    if (first.kind === "unpack") throw cursor.error("iterable unpacking cannot be used in comprehension");
    const clauses = readComprehensionClauses(cursor, read);
    cursor.meter?.checkpoint(0,96);
    return { kind: "comprehension", collection: kind === "tuple" ? "generator" : "list", element: first, clauses, start: opening.start, end: cursor.expect(close).end };
  }
  if (kind === "tuple" && cursor.peek().text !== ",") {
    if (first.kind === "unpack") throw cursor.error("cannot use starred expression here");
    cursor.meter?.checkpoint(0,160);
    return { ...first, contentSpan:first.contentSpan??{start:first.start,end:first.end}, start: opening.start, end: cursor.expect(close).end };
  }
  cursor.meter?.checkpoint(0,104);
  const items = [first];
  while (cursor.peek().text === ",") {
    cursor.take();
    if (cursor.peek().text === close) break;
    cursor.meter?.checkpoint(0,8);
    items.push(readItem(cursor, read));
  }
  return { kind, items, start: opening.start, end: cursor.expect(close).end };
  } finally {cursor.meter?.checkpoint();}
}

function readItem(cursor: TokenCursor, read: ReadExpression): CollectionItem {
  if (cursor.peek().text !== "*") return readNamedExpression(cursor, read);
  const start = cursor.take().start;
  const value = read(cursor, 6);
  cursor.meter?.checkpoint(0,64);
  return { kind: "unpack", value, start, end: value.end };
}

function readEntry(cursor: TokenCursor, read: ReadExpression, firstKey?: Expression): DictionaryEntry {
  if (!firstKey && cursor.peek().text === "**") {
    const start = cursor.take().start;
    const value = read(cursor, 6);
    cursor.meter?.checkpoint(0,64);
    return { kind: "mapping", value, start, end: value.end };
  }
  const key = firstKey ?? read(cursor);
  if (key.kind === "assignment-expression" && key.start.offset === key.target.start.offset) {
    throw cursor.error("assignment expression in dictionary key must be parenthesized");
  }
  cursor.expect(":");
  const value = read(cursor);
  cursor.meter?.checkpoint(0,80);
  return { kind: "entry", key, value, start: key.start, end: value.end };
}

function readBraces(cursor: TokenCursor, read: ReadExpression, opening: SourceSpan): Expression {
  if (cursor.peek().text === "}") {
    cursor.meter?.checkpoint(0,96);
    return { kind: "dictionary", entries: [], start: opening.start, end: cursor.take().end };
  }
  cursor.meter?.checkpoint(0,72);
  const entries: DictionaryEntry[] = [];
  const items: CollectionItem[] = [];
  if (cursor.peek().text === "**") entries.push(readEntry(cursor, read));
  else {
    const first = readItem(cursor, read);
    if (first.kind !== "unpack" && cursor.peek().text === ":") entries.push(readEntry(cursor, read, first));
    else items.push(first);
  }
  const dictionary = entries.length > 0;
  if (cursor.peek().text === "for" || cursor.peek().text === "async") {
    const first = dictionary ? entries[0] : items[0];
    if (first.kind === "mapping" || first.kind === "unpack") throw cursor.error("unpacking cannot be used in comprehension");
    const clauses = readComprehensionClauses(cursor, read);
    const end = cursor.expect("}").end;
    cursor.meter?.checkpoint(0,96);
    return first.kind === "entry"
      ? { kind: "dictionary-comprehension", key: first.key, value: first.value, clauses, start: opening.start, end }
      : { kind: "comprehension", collection: "set", element: first, clauses, start: opening.start, end };
  }
  while (cursor.peek().text === ",") {
    cursor.take();
    if (cursor.peek().text === "}") break;
    cursor.meter?.checkpoint(0,8);
    if (dictionary) entries.push(readEntry(cursor, read));
    else items.push(readItem(cursor, read));
  }
  const end = cursor.expect("}").end;
  cursor.meter?.checkpoint(0,64);
  return dictionary
    ? { kind: "dictionary", entries, start: opening.start, end }
    : { kind: "set", items, start: opening.start, end };
}
