import type { CallArgument, Expression, SourceSpan, SubscriptItem } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { reservedWords } from "./keywords.js";
import { readComprehensionClauses } from "./comprehensions.js";
import { readNamedExpression } from "./named-expression.js";
import { normalizeNfkc } from "./normalization.js";

type ReadExpression = (cursor: TokenCursor, minimum?: number) => Expression;

/** Trailers bind more tightly than all unary and binary operators. */
export function readTrailers(cursor: TokenCursor, value: Expression, read: ReadExpression): Expression {
  while (true) {
    if (cursor.peek().text === ".") {
      cursor.take();
      const name = cursor.peek();
      if (name.kind !== "name" || reservedWords.has(name.text)) throw cursor.error("expected attribute name");
      cursor.take();
      value = { kind: "attribute", object: value, spelling: name.text, name: normalizeNfkc(name.text), start: value.start, end: name.end };
    } else if (cursor.peek().text === "(") {
      const opening = cursor.take();
      const args = readArguments(cursor, read, opening);
      const close = cursor.expect(")");
      value = { kind: "call", callee: value, arguments: args, start: value.start, end: close.end };
    } else if (cursor.peek().text === "[") {
      cursor.take();
      const items: SubscriptItem[] = [];
      let tuple = false;
      do {
        const item = readSubscriptItem(cursor, read);
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
}

function readArguments(cursor: TokenCursor, read: ReadExpression, opening: SourceSpan): CallArgument[] {
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
      args.push({ kind: first.text === "*" ? "starred" : "mapping", value, start: first.start, end: value.end });
    } else {
      let value = readNamedExpression(cursor, read);
      if (cursor.peek().text === "for" || cursor.peek().text === "async") {
        if (args.length > 0) throw cursor.error("generator expression must be parenthesized");
        const clauses = readComprehensionClauses(cursor, read);
        if (cursor.peek().text !== ")") throw cursor.error("generator expression must be parenthesized");
        value = { kind: "comprehension", collection: "generator", element: value, clauses, start: opening.start, end: cursor.peek().end };
      }
      if (cursor.peek().text === "=") {
        if (first.kind !== "name" || value.kind !== "name" || value.end.offset !== first.end.offset) {
          throw cursor.error("keyword argument must be an unparenthesized name");
        }
        cursor.take();
        if (value.name === "__debug__") throw cursor.error("cannot assign to __debug__");
        if (keywords.has(value.name)) throw cursor.error(`keyword argument repeated: ${value.name}`);
        keywords.add(value.name);
        keywordSeen = true;
        const argument = read(cursor);
        args.push({ kind: "keyword", spelling: value.spelling, name: value.name, value: argument, start: first.start, end: argument.end });
      } else {
        if (keywordSeen) throw cursor.error("positional argument follows keyword argument");
        args.push({ kind: "positional", value, start: first.start, end: value.end });
      }
    }
    if (cursor.peek().text !== ",") break;
    cursor.take();
  }
  return args;
}

function readSubscriptItem(cursor: TokenCursor, read: ReadExpression): SubscriptItem {
  const first = cursor.peek();
  if (first.text === "*") {
    cursor.take();
    const value = read(cursor);
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
  if (![":", ",", "]"].includes(cursor.peek().text)) { upper = read(cursor); end = upper.end; }
  if (cursor.peek().text === ":") {
    end = cursor.take().end;
    if (![",", "]"].includes(cursor.peek().text)) { step = read(cursor); end = step.end; }
  }
  return { kind: "slice", lower, upper, step, start: first.start, end };
}
