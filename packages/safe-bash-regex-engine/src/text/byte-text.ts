import { ProgramError } from "./budget.js";

export interface DecodedByteText {
  readonly text: string;
  readonly offsets?: Uint32Array;
}

export function decodeByteText(input: string, budget?: { step(count: number): void; readonly maxBufferBytes: number }): DecodedByteText {
  budget?.step(input.length);
  let ascii = true;
  for (let i = 0; i < input.length; i++) if (input.charCodeAt(i) >= 128) { ascii = false; break; }
  if (ascii) return { text: input };
  if (budget && (input.length + 1) * 6 > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
  const offsets = new Uint32Array(input.length + 1);
  let text = "";
  for (let index = 0; index < input.length;) {
    const first = input.charCodeAt(index);
    let width = first < 128 ? 1 : first >= 0xc2 && first <= 0xdf ? 2
      : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
    if (index + width > input.length) width = 0;
    for (let next = 1; next < width; next++) {
      const byte = input.charCodeAt(index + next);
      if (byte < 0x80 || byte > 0xbf || next === 1 && (
        first === 0xe0 && byte < 0xa0 || first === 0xed && byte > 0x9f ||
        first === 0xf0 && byte < 0x90 || first === 0xf4 && byte > 0x8f
      )) { width = 0; break; }
    }
    // Surrogate escapes retain malformed bytes without conflating them with U+FFFD.
    let code = width === 0 ? 0xdc00 + first : width === 1 ? first : first & (0x7f >> width);
    for (let next = 1; next < width; next++) code = code * 64 + (input.charCodeAt(index + next) & 63);
    const character = String.fromCodePoint(code);
    if (character.length === 2) offsets[text.length + 1] = index;
    index += width || 1;
    text += character;
    offsets[text.length] = index;
  }
  return { text, offsets: offsets.subarray(0, text.length + 1) };
}

export function byteTextPosition(decoded: DecodedByteText, byteOffset: number): number {
  if (!decoded.offsets) return byteOffset;
  let low = 0, high = decoded.offsets.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (decoded.offsets[mid]! < byteOffset) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function encodeByteText(text: string): string {
  let bytes = "";
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code < 128) bytes += character;
    else if (code >= 0xdc80 && code <= 0xdcff) bytes += String.fromCharCode(code - 0xdc00);
    else if (code < 0x800) bytes += String.fromCharCode(0xc0 | code >> 6, 0x80 | code & 63);
    else if (code < 0x10000) bytes += String.fromCharCode(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63);
    else bytes += String.fromCharCode(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63);
  }
  return bytes;
}
