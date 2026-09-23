// Gnumeric1.12.61 REPLACEB semantics with bounded GLib validation and owned output.
// GPL-2.0-or-later; see the package LICENSE.
import { joinByteText } from "../../encoding/byte-value.js";
import type { CellValue } from "../../workbook.js";

/** Native boundary validation distinguishes an incomplete trailing sequence
 * from a malformed one. Only malformed boundaries are rejected by REPLACEB. */
function validatedCharacter(source: Uint8Array, position: number, end: number, tick: () => void): number | "partial" | undefined {
  tick();
  const lead = source[position];
  if (lead === undefined) return position;
  if (lead < 128) return position + 1;
  if (lead < 192 || lead >= 254) return undefined;
  const width = lead < 224 ? 2 : lead < 240 ? 3 : lead < 248 ? 4 : lead < 252 ? 5 : 6;
  let point = lead & (127 >> width);
  for (let offset = 1; offset < width; offset++) {
    tick();
    if (position + offset >= end) return "partial";
    const byte = source[position + offset]!;
    if ((byte & 192) !== 128) return undefined;
    point = point * 64 + (byte & 63);
  }
  const minimum = width === 2 ? 128 : width === 3 ? 2048 : 65536;
  if (width > 4 || point < minimum || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) return undefined;
  return position + width;
}

export function replaceByteText(source: Uint8Array, replacement: Uint8Array, start: number, count: number, maximum: number, tick: () => void): CellValue {
  if (Number.isNaN(start) || Number.isNaN(count)) return { kind: "error", value: "#VALUE!" };
  const from = Math.trunc(Math.min(source.length, start - 1));
  const to = from + Math.trunc(Math.min(source.length - from, count));
  if (validatedCharacter(source, from, source.length, tick) === undefined || validatedCharacter(source, to, source.length, tick) === undefined)
    return { kind: "error", value: "#VALUE!" };
  let position = from;
  while (position < to) {
    const next = validatedCharacter(source, position, to, tick);
    if (typeof next !== "number") return { kind: "error", value: "#VALUE!" };
    position = next;
  }
  return joinByteText([source.subarray(0, from), replacement, source.subarray(to)], new Uint8Array(), maximum, tick);
}
