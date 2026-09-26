import { PandocError } from "./errors.js";
import type { AdapterContext, DiagnosticCode } from "./types.js";

export type RtfToken =
  | {kind: "group"; children: RtfToken[]; offset: number}
  | {kind: "word"; name: string; parameter: number | undefined; offset: number}
  | {kind: "symbol"; name: string; offset: number}
  | {kind: "hex"; byte: number; offset: number}
  | {kind: "text" | "binary"; bytes: Uint8Array; offset: number};
export type RtfGroup = Extract<RtfToken, {kind: "group"}>;

export function rtfError(context: AdapterContext, message: string, code: DiagnosticCode = "E_PARSE", offset = 0): never {
  throw new PandocError(code, context.operation ?? "read", message, "rtf", `byte:${offset + 1}`);
}
export function hexDigit(byte: number): number {
  return byte >= 48 && byte <= 57 ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;
}
const letter = (byte: number) => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122;
const digit = (byte: number) => byte >= 48 && byte <= 57;

/** Parse structure before any code-page decoding. Binary data is opaque even in
 * ignored destinations. An explicit stack bounds malformed and valid groups. */
export async function parseRtf(bytes: Uint8Array, context: AdapterContext): Promise<RtfGroup> {
  const roots: RtfToken[] = [];
  const stack: RtfGroup[] = [];
  const add = (token: RtfToken) => {
    context.charge("references", 1);
    context.charge("retainedBytes", 64);
    (stack.at(-1)?.children ?? roots).push(token);
  };
  let cursor = 0;
  while (cursor < bytes.length) {
    await context.cooperate();
    const offset = cursor;
    const byte = bytes[cursor++]!;
    if (byte === 13 || byte === 10) continue;
    if (byte === 123) {
      context.bound("depth", stack.length + 1);
      const group: RtfGroup = {kind: "group", children: [], offset};
      add(group); stack.push(group); continue;
    }
    if (byte === 125) {
      if (!stack.length) rtfError(context, "Unmatched RTF closing brace", "E_PARSE", offset);
      stack.pop(); continue;
    }
    if (byte !== 92) {
      while (cursor < bytes.length && ![10, 13, 92, 123, 125].includes(bytes[cursor]!)) {
        context.checkpoint();
        cursor++;
        if (cursor % 256 === 0) await context.cooperate(0);
      }
      add({kind: "text", bytes: bytes.subarray(offset, cursor), offset}); continue;
    }
    if (cursor === bytes.length) rtfError(context, "Truncated RTF control", "E_PARSE", offset);
    const control = bytes[cursor++]!;
    if (control === 39) {
      const high = hexDigit(bytes[cursor++] ?? -1);
      const low = hexDigit(bytes[cursor++] ?? -1);
      if (high < 0 || low < 0) rtfError(context, "Malformed RTF hex escape", "E_PARSE", offset);
      add({kind: "hex", byte: high * 16 + low, offset}); continue;
    }
    if (!letter(control)) {
      add({kind: "symbol", name: String.fromCharCode(control), offset}); continue;
    }
    let name = String.fromCharCode(control);
    while (letter(bytes[cursor] ?? -1)) {
      context.checkpoint();
      if (name.length >= 32) rtfError(context, "RTF control word exceeds 32 letters", "E_PARSE", offset);
      name += String.fromCharCode(bytes[cursor++]!);
    }
    let parameter: number | undefined;
    const negative = bytes[cursor] === 45;
    if (negative) cursor++;
    if (digit(bytes[cursor] ?? -1)) {
      let value = 0;
      while (digit(bytes[cursor] ?? -1)) {
        context.checkpoint();
        value = value * 10 + bytes[cursor++]! - 48;
        if (value > (negative ? 2147483648 : 2147483647)) rtfError(context, "RTF parameter out of range", "E_PARSE", offset);
      }
      parameter = negative ? -value : value;
    } else if (negative) rtfError(context, "Missing signed RTF parameter", "E_PARSE", offset);
    if (bytes[cursor] === 32) cursor++;
    if (name === "bin") {
      if (parameter === undefined || parameter < 0 || parameter > bytes.length - cursor)
        rtfError(context, "Invalid or truncated RTF binary count", "E_PARSE", offset);
      context.charge("binaryBytes", parameter);
      context.checkpoint(Math.max(1, Math.ceil(parameter / 256)));
      add({kind: "binary", bytes: bytes.subarray(cursor, cursor + parameter), offset});
      cursor += parameter;
    } else add({kind: "word", name, parameter, offset});
  }
  if (stack.length) rtfError(context, "Unclosed RTF group", "E_PARSE", stack.at(-1)!.offset);
  if (roots.length !== 1 || roots[0]?.kind !== "group") rtfError(context, "RTF requires one root group");
  const root = roots[0];
  const header = root.children[0];
  if (header?.kind !== "word" || header.name !== "rtf") rtfError(context, "Missing RTF document header");
  if (header.parameter !== 1) rtfError(context, "Only the declared RTF 1.9.1 subset is supported", "E_CAPABILITY");
  return root;
}

export function destination(group: RtfGroup): {name: string; ignorable: boolean} {
  const first = group.children[0];
  const ignorable = first?.kind === "symbol" && first.name === "*";
  const word = group.children[ignorable ? 1 : 0];
  return {name: word?.kind === "word" ? word.name : "", ignorable};
}
