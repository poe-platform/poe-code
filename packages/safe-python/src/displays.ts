import type { CollectionItem, DictionaryEntry, Expression, SourceSpan } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";

type ReadExpression = (cursor: TokenCursor, minimum?: number) => Expression;

/** Display parsing owns its commas; argument and subscription commas remain separate. */
export function readDisplay(cursor: TokenCursor, read: ReadExpression): Expression {
  const opening = cursor.take();
  if (opening.text === "{") return readBraces(cursor, read, opening);
  const close = opening.text === "(" ? ")" : "]";
  const kind = opening.text === "(" ? "tuple" : "list";
  if (cursor.peek().text === close) {
    return { kind, items: [], start: opening.start, end: cursor.take().end };
  }
  const first = readItem(cursor, read);
  if (kind === "tuple" && cursor.peek().text !== ",") {
    if (first.kind === "unpack") throw cursor.error("cannot use starred expression here");
    return { ...first, start: opening.start, end: cursor.expect(close).end };
  }
  const items = [first];
  while (cursor.peek().text === ",") {
    cursor.take();
    if (cursor.peek().text === close) break;
    items.push(readItem(cursor, read));
  }
  return { kind, items, start: opening.start, end: cursor.expect(close).end };
}

function readItem(cursor: TokenCursor, read: ReadExpression): CollectionItem {
  if (cursor.peek().text !== "*") return read(cursor);
  const start = cursor.take().start;
  const value = read(cursor, 6);
  return { kind: "unpack", value, start, end: value.end };
}

function readEntry(cursor: TokenCursor, read: ReadExpression, firstKey?: Expression): DictionaryEntry {
  if (!firstKey && cursor.peek().text === "**") {
    const start = cursor.take().start;
    const value = read(cursor, 6);
    return { kind: "mapping", value, start, end: value.end };
  }
  const key = firstKey ?? read(cursor);
  cursor.expect(":");
  const value = read(cursor);
  return { kind: "entry", key, value, start: key.start, end: value.end };
}

function readBraces(cursor: TokenCursor, read: ReadExpression, opening: SourceSpan): Expression {
  if (cursor.peek().text === "}") {
    return { kind: "dictionary", entries: [], start: opening.start, end: cursor.take().end };
  }
  const entries: DictionaryEntry[] = [];
  const items: CollectionItem[] = [];
  if (cursor.peek().text === "**") entries.push(readEntry(cursor, read));
  else {
    const first = readItem(cursor, read);
    if (first.kind !== "unpack" && cursor.peek().text === ":") entries.push(readEntry(cursor, read, first));
    else items.push(first);
  }
  const dictionary = entries.length > 0;
  while (cursor.peek().text === ",") {
    cursor.take();
    if (cursor.peek().text === "}") break;
    if (dictionary) entries.push(readEntry(cursor, read));
    else items.push(readItem(cursor, read));
  }
  const end = cursor.expect("}").end;
  return dictionary
    ? { kind: "dictionary", entries, start: opening.start, end }
    : { kind: "set", items, start: opening.start, end };
}
