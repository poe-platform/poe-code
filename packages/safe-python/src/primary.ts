import type { CallArgument, Expression, SourceSpan, SubscriptItem } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { reservedWords } from "./keywords.js";
import { readComprehensionClauses } from "./comprehensions.js";
import { readNamedExpression } from "./named-expression.js";
import { normalizeNfkc } from "./normalization.js";

type ReadExpression = (cursor: TokenCursor, minimum?: number) => Expression;

/** Trailers bind more tightly than all unary and binary operators. */
export function readTrailers(cursor: TokenCursor, value: Expression, read: ReadExpression): Expression {
  try {
  cursor.meter?.checkpoint();
  while (true) {
    if (cursor.peek().text === ".") {
      cursor.take();
      const name = cursor.peek();
      if (name.kind !== "name" || reservedWords.has(name.text)) throw cursor.error("expected attribute name");
      cursor.take();
      cursor.meter?.checkpoint(0,144);
      value = { kind: "attribute", object: value, spelling: name.text, name: normalizeNfkc(name.text,cursor.meter), nameSpan:{start:name.start,end:name.end}, start: value.start, end: name.end };
    } else if (cursor.peek().text === "(") {
      const opening = cursor.take();
      const args = readArguments(cursor, read, opening);
      const close = cursor.expect(")");
      cursor.meter?.checkpoint(0,80);
      value = { kind: "call", callee: value, arguments: args, start: value.start, end: close.end };
    } else if (cursor.peek().text === "[") {
      cursor.take();
      cursor.meter?.checkpoint(0,112);
      const items: SubscriptItem[] = [];
      let tuple = false;
      do {
        const item = readSubscriptItem(cursor, read);
        cursor.meter?.checkpoint(0,8);
        items.push(item);
        if (item.kind === "unpack") tuple = true;
        if (cursor.peek().text !== ",") break;
        tuple = true;
        cursor.take();
      } while (cursor.peek().text !== "]");
      const close = cursor.expect("]");
      value = { kind: "subscript", object: value, items, tuple, start: value.start, end: close.end };
    } else return value;
  }
  } finally {cursor.meter?.checkpoint();}
}

export function readArguments(cursor: TokenCursor, read: ReadExpression, opening: SourceSpan, allowBareGenerator = true): CallArgument[] {
  try {
  cursor.meter?.checkpoint(1,96);
  const args: CallArgument[] = [];
  const keywords = new Set<string>();
  let keywordSeen = false;
  let mappingSeen = false;
  while (cursor.peek().text !== ")") {
    const first = cursor.peek();
    if (first.text === "*" || first.text === "**") {
      cursor.take();
      if (first.text === "*" && mappingSeen) throw cursor.error("iterable argument unpacking follows keyword argument unpacking");
      const value = read(cursor);
      if (first.text === "**") { mappingSeen = true; keywordSeen = true; }
      cursor.meter?.checkpoint(0,72);
      args.push({ kind: first.text === "*" ? "starred" : "mapping", value, start: first.start, end: value.end });
    } else {
      let value = readNamedExpression(cursor, read);
      if (cursor.peek().text === "for" || cursor.peek().text === "async") {
        if (!allowBareGenerator || args.length > 0) throw cursor.error("generator expression must be parenthesized");
        const clauses = readComprehensionClauses(cursor, read);
        if (cursor.peek().text !== ")") throw cursor.error("generator expression must be parenthesized");
        cursor.meter?.checkpoint(0,96);
        value = { kind: "comprehension", collection: "generator", element: value, clauses, start: opening.start, end: cursor.peek().end };
      }
      if (cursor.peek().text === "=") {
        if (first.kind !== "name" || value.kind !== "name" || value.end.offset !== first.end.offset) {
          throw cursor.error("keyword argument must be an unparenthesized name");
        }
        cursor.take();
        if (value.name === "__debug__") throw cursor.error("cannot assign to __debug__");
        cursor.meter?.checkpoint(1+value.name.length);
        if (keywords.has(value.name)) {
          cursor.meter?.checkpoint(0,64+2*value.name.length);
          throw cursor.error(`keyword argument repeated: ${value.name}`);
        }
        cursor.meter?.checkpoint(0,32);
        keywords.add(value.name);
        keywordSeen = true;
        const argument = read(cursor);
        cursor.meter?.checkpoint(0,96);
        args.push({ kind: "keyword", spelling: value.spelling, name: value.name, value: argument, start: first.start, end: argument.end });
      } else {
        if (keywordSeen) throw cursor.error("positional argument follows keyword argument");
        cursor.meter?.checkpoint(0,72);
        args.push({ kind: "positional", value, start: first.start, end: value.end });
      }
    }
    if (cursor.peek().text !== ",") break;
    cursor.take();
  }
  return args;
  } finally {cursor.meter?.checkpoint();}
}

function readSubscriptItem(cursor: TokenCursor, read: ReadExpression): SubscriptItem {
  const first = cursor.peek();
  if (first.text === "*") {
    cursor.take();
    const value = read(cursor);
    cursor.meter?.checkpoint(0,64);
    return { kind: "unpack", value, start: first.start, end: value.end };
  }
  const lower = first.text === ":" ? null : readNamedExpression(cursor, read);
  if (cursor.peek().text !== ":") {
    if (!lower) throw cursor.error("expected subscript");
    return lower;
  }
  if (lower?.kind === "assignment-expression" && lower.start.offset === lower.target.start.offset) {
    throw cursor.error("assignment expression in slice must be parenthesized");
  }
  let end = cursor.take().end;
  let upper: Expression | null = null;
  let step: Expression | null = null;
  const upperToken=cursor.peek().text;
  if (upperToken!==":"&&upperToken!==","&&upperToken!=="]") { upper = read(cursor); end = upper.end; }
  if (cursor.peek().text === ":") {
    end = cursor.take().end;
    const stepToken=cursor.peek().text;
    if (stepToken!==","&&stepToken!=="]") { step = read(cursor); end = step.end; }
  }
  cursor.meter?.checkpoint(0,80);
  return { kind: "slice", lower, upper, step, start: first.start, end };
}
