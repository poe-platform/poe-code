import { SsconvertError } from "../contracts.js";

/** Admit host Unicode before TextEncoder can silently replace an unpaired
 * surrogate. Native text ends at the first NUL; trailing host text is invisible. */
export function encodeByteText(source: string, tick: () => void): Uint8Array {
  let end = 0;
  for (const character of source) {
    tick();
    const point = character.codePointAt(0)!;
    if (point === 0) break;
    if (point >= 0xd800 && point <= 0xdfff)
      throw new SsconvertError("unsupported-feature", "Malformed host UTF-16 has no lossless text byte representation");
    end += character.length;
  }
  return new TextEncoder().encode(source.slice(0, end));
}

/** Gnumeric's C-string text cursors use GLib's leading-byte skip table even
 * when a Perl scalar is not valid UTF-8. Keep byte ownership and cursor bounds
 * explicit; never reproduce a native read before or after the source. */
function visibleLength(source: Uint8Array, tick: () => void): number {
  for (let index = 0; index < source.length; index++) {
    tick();
    if (source[index] === 0) return index;
  }
  return source.length;
}
function advance(source: Uint8Array, position: number, end: number): number {
  const byte = source[position]!;
  const width = byte < 192 || byte >= 254 ? 1 : byte < 224 ? 2 : byte < 240 ? 3 : byte < 248 ? 4 : byte < 252 ? 5 : 6;
  return Math.min(end, position + width);
}

export function byteTextLength(source: Uint8Array, tick: () => void): number {
  const end = visibleLength(source, tick);
  let position = 0, length = 0;
  while (position < end) { tick(); position = advance(source, position, end); length++; }
  return length;
}

export function sliceByteText(source: Uint8Array, operation: "left" | "right" | "mid",
  start: number, count: number, tick: () => void): Uint8Array | undefined {
  tick();
  if (Number.isNaN(count) || count < 0 || operation === "mid" && (Number.isNaN(start) || start < 1)) return undefined;
  const end = visibleLength(source, tick);
  let remaining = Math.trunc(Math.min(2147483647, count)), from = 0, to = 0;
  if (operation === "right") {
    from = end;
    while (remaining > 0 && from > 0) {
      tick(); from--;
      while (from > 0 && source[from]! >= 128 && source[from]! < 192) { tick(); from--; }
      remaining--;
    }
    to = end;
  } else {
    let skip = operation === "mid" ? Math.trunc(Math.min(2147483647, start - 1)) : 0;
    while (skip > 0 && from < end) { tick(); from = advance(source, from, end); skip--; }
    to = from;
    while (remaining > 0 && to < end) { tick(); to = advance(source, to, end); remaining--; }
  }
  // Account for the owned copy, including byte ranges skipped by a UTF-8 cursor.
  const result = new Uint8Array(to - from);
  for (let index = 0; index < result.length; index++) { tick(); result[index] = source[from + index]!; }
  return result;
}
