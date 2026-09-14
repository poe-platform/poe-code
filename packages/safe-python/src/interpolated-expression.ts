import type { CollectionItem, Expression, InterpolatedPart } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { readYield } from "./yield-expression.js";
import type {InterpolatedToken} from "./interpolation.js";
import type {SourcePosition} from "./source.js";

type ReadExpression = (cursor: TokenCursor, minimum?: number) => Expression;
type TextToken=Extract<InterpolatedToken,{kind:"fstring-middle"|"tstring-middle"}>;
type PendingPart=Exclude<InterpolatedPart,{kind:"text"}>|TextToken;

export function readInterpolatedString(cursor: TokenCursor, read: ReadExpression): Extract<Expression, { kind: "interpolated-string" }> {
  try {
  cursor.meter?.checkpoint(1,80);
  const opening = cursor.take();
  const flavor = opening.kind === "fstring-start" ? "formatted" : "template";
  const endKind = flavor === "formatted" ? "fstring-end" : "tstring-end";
  const parts = readParts(cursor, read);
  if (cursor.peek().kind !== endKind) throw cursor.error("expected end of interpolated string");
  const closing=cursor.take();
  return { kind: "interpolated-string", flavor, parts:decodeParts(parts,closing,cursor), start: opening.start, end: closing.end };
  } finally {cursor.meter?.checkpoint();}
}

function decodeParts(parts:PendingPart[],span:{readonly start:SourcePosition;readonly end:SourcePosition},cursor:TokenCursor):InterpolatedPart[]{
  cursor.meter?.checkpoint(parts.length,32+8*parts.length);
  return parts.map(part=>{
    if(part.kind==="field")return part;
    cursor.meter?.checkpoint(0,72);
    return {kind:"text",value:part.decodeAt?.(span)??part.value,start:part.start,end:part.end};
  });
}

function readParts(cursor: TokenCursor, read: ReadExpression,format=false): PendingPart[] {
  cursor.meter?.checkpoint(1,32);
  const parts: PendingPart[] = [];
  while (true) {
    const token = cursor.peek();
    if (token.kind === "fstring-middle" || token.kind === "tstring-middle") {
      cursor.take();
      cursor.meter?.checkpoint(0,72);
      // Format specifications decode while their grammar production is read;
      // outer literal segments wait until the closing quote has been consumed.
      if(format&&token.decodeAt){
        const value=token.decodeAt(token);
        parts.push({kind:token.kind,text:token.text,content:token.content,value,start:token.start,end:token.end});
      }else parts.push(token);
    } else if (token.text === "{") {cursor.meter?.checkpoint(0,8);parts.push(readField(cursor, read));}
    else return parts;
  }
}

function readField(cursor: TokenCursor, read: ReadExpression): Exclude<InterpolatedPart,{kind:"text"}> {
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
  if (cursor.peek().text === ":") { cursor.take(); format = decodeParts(readParts(cursor, read,true),cursor.peek(),cursor); }
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
