import type { Expression, InterpolatedPart } from "./ast.js";
import { readInterpolatedString } from "./interpolated-expression.js";
import type { TokenCursor } from "./token-cursor.js";
import type {SourceMeter} from "./source.js";

/** Adjacent literal segments form one primary, before attributes/calls/subscripts. */
export function readStringExpression(cursor: TokenCursor, read: (cursor: TokenCursor, minimum?: number) => Expression): Expression {
  try {
  cursor.meter?.checkpoint(1,144);
  const start = cursor.peek().start;
  let end = cursor.peek().end;
  let mode: "string" | "bytes" | "formatted" | "template" | undefined;
  const parts: InterpolatedPart[] = [];
  const bytes: Uint8Array[] = [];
  while (true) {
    const token = cursor.peek();
    if (token.kind !== "string" && token.kind !== "bytes" && token.kind !== "fstring-start" && token.kind !== "tstring-start") break;
    const incoming = token.kind === "fstring-start" ? "formatted" : token.kind === "tstring-start" ? "template" : token.kind;
    if (mode !== undefined && mode !== incoming) {
      if (mode === "bytes" || incoming === "bytes") throw cursor.error("cannot mix bytes and nonbytes literals");
      if (mode === "template" || incoming === "template") throw cursor.error("cannot mix template strings with other string literals");
      mode = "formatted";
    } else mode = incoming;
    if (token.kind === "string" || token.kind === "bytes") {
      cursor.take();
      if (token.kind === "bytes") {cursor.meter?.checkpoint(0,8);bytes.push(token.value);}
      else {cursor.meter?.checkpoint(0,72);parts.push({ kind: "text", value: token.value, start: token.start, end: token.end });}
      end = token.end;
    } else {
      const segment = readInterpolatedString(cursor, read);
      for (const part of segment.parts) {cursor.meter?.checkpoint(1,8);parts.push(part);}
      end = segment.end;
    }
  }
  if (mode === undefined) throw cursor.error("expected string literal");
  if (mode === "bytes") return { kind: "literal", literalKind: "bytes", value: joinBuffers(bytes, Uint8Array,cursor.meter), start, end };
  if (mode === "string") {
    cursor.meter?.checkpoint(0,32);
    const values: Uint32Array[] = [];
    for (const part of parts) {cursor.meter?.checkpoint();if (part.kind === "text") {cursor.meter?.checkpoint(0,8);values.push(part.value);}}
    return { kind: "literal", literalKind: "string", value: joinBuffers(values, Uint32Array,cursor.meter), start, end };
  }
  cursor.meter?.checkpoint(0,32);
  const merged: InterpolatedPart[] = [];
  for (let index = 0; index < parts.length;) {
    cursor.meter?.checkpoint();
    const first = parts[index++];
    if (first.kind === "field") { cursor.meter?.checkpoint(0,8);merged.push(first); continue; }
    cursor.meter?.checkpoint(0,40);
    const values = [first.value];
    let textEnd = first.end;
    while (index < parts.length) {
      cursor.meter?.checkpoint();
      const next = parts[index];
      if (next.kind !== "text") break;
      cursor.meter?.checkpoint(0,8);values.push(next.value);
      textEnd = next.end;
      index++;
    }
    const value = joinBuffers(values, Uint32Array,cursor.meter);
    if (value.length) {cursor.meter?.checkpoint(0,72);merged.push({ kind: "text", value, start: first.start, end: textEnd });}
  }
  return { kind: "interpolated-string", flavor: mode, parts: merged, start, end };
  } finally {cursor.meter?.checkpoint();}
}

function joinBuffers<T extends Uint8Array | Uint32Array>(parts: readonly T[], ArrayType: new (length: number) => T,meter?:SourceMeter): T {
  meter?.checkpoint();
  if (parts.length === 1) return parts[0];
  let length = 0;
  meter?.checkpoint(0,64);
  for (const part of parts) {meter?.checkpoint(1,part.byteLength);length += part.length;}
  const value = new ArrayType(length);
  let offset = 0;
  for (const part of parts) {meter?.checkpoint(1+part.length);value.set(part, offset); offset += part.length;}
  return value;
}
