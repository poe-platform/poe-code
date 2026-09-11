import type { CollectionItem, Expression, InterpolatedPart } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readYield } from "./yield-expression.js";

type ReadExpression = (cursor: TokenCursor, minimum?: number) => Expression;

export function readInterpolatedString(cursor: TokenCursor, read: ReadExpression): Extract<Expression, { kind: "interpolated-string" }> {
  try {
  cursor.meter?.checkpoint(1,80);
  const opening = cursor.take();
  const flavor = opening.kind === "fstring-start" ? "formatted" : "template";
  const endKind = flavor === "formatted" ? "fstring-end" : "tstring-end";
  const parts = readParts(cursor, read);
  if (cursor.peek().kind !== endKind) throw cursor.error("expected end of interpolated string");
  return { kind: "interpolated-string", flavor, parts, start: opening.start, end: cursor.take().end };
  } finally {cursor.meter?.checkpoint();}
}

function readParts(cursor: TokenCursor, read: ReadExpression): InterpolatedPart[] {
  cursor.meter?.checkpoint(1,32);
  const parts: InterpolatedPart[] = [];
  while (true) {
    const token = cursor.peek();
    if (token.kind === "fstring-middle" || token.kind === "tstring-middle") {
      cursor.take();
      cursor.meter?.checkpoint(0,72);
      parts.push({ kind: "text", value: token.value, start: token.start, end: token.end });
    } else if (token.text === "{") {cursor.meter?.checkpoint(0,8);parts.push(readField(cursor, read));}
    else return parts;
  }
}

function readField(cursor: TokenCursor, read: ReadExpression): InterpolatedPart {
  cursor.meter?.checkpoint(1,96);
  const opening = cursor.expect("{");
  const expression = readFieldExpression(cursor, read);
  const rawExpressionText = cursor.sourceBetween(opening.end.offset, cursor.peek().start.offset);
  cursor.meter?.checkpoint(1+rawExpressionText.length,32+2*rawExpressionText.length);
  const expressionText = rawExpressionText.trimEnd();
  let debugText: string | null = null;
  if (cursor.peek().text === "=") {
    cursor.take();
    debugText = cursor.sourceBetween(opening.end.offset, cursor.peek().start.offset);
  }
  let conversion: "s" | "r" | "a" | null = null;
  if (cursor.peek().text === "!") {
    const bang = cursor.take();
    const token = cursor.peek();
    if (token.start.offset !== bang.end.offset || (token.text !== "s" && token.text !== "r" && token.text !== "a")) {
      throw cursor.error("expected conversion s, r, or a immediately after '!'");
    }
    conversion = token.text;
    cursor.take();
  }
  let format: InterpolatedPart[] | null = null;
  if (cursor.peek().text === ":") { cursor.take(); format = readParts(cursor, read); }
  if (debugText !== null && conversion === null && format === null) conversion = "r";
  return { kind: "field", expression, expressionText, debugText, conversion, format, start: opening.start, end: cursor.expect("}").end };
}

function readFieldExpression(cursor: TokenCursor, read: ReadExpression): Expression {
  if (cursor.peek().text === "yield") return readYield(cursor, read);
  cursor.meter?.checkpoint(0,32);
  const items: CollectionItem[] = [];
  let comma = false;
  let end = cursor.peek().end;
  let next = "";
  do {
    if (cursor.peek().text === "*") {
      const start = cursor.take().start;
      const value = read(cursor, 6);
      cursor.meter?.checkpoint(0,72);
      items.push({ kind: "unpack", value, start, end: value.end });
    } else {
      if (cursor.peek().text === "lambda") throw cursor.error("lambda in a replacement field must be parenthesized");
      cursor.meter?.checkpoint(0,8);
      items.push(read(cursor));
    }
    end = items[items.length - 1].end;
    if (cursor.peek().text !== ",") break;
    comma = true;
    end = cursor.take().end;
    next=cursor.peek().text;
  } while (next!=="="&&next!=="!"&&next!==":"&&next!=="}");
  const first = items[0];
  if (comma) {cursor.meter?.checkpoint(0,64);return { kind: "tuple", items, start: first.start, end };}
  if (first.kind === "unpack") throw cursor.error("starred expression must be in a tuple");
  return first;
}
