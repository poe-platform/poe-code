// Gnumeric1.12.61 REPLACEB semantics with bounded GLib validation and owned output.
// GPL-2.0-or-later; see the package LICENSE.
import { validatedByteTextCharacter } from "../../encoding/byte-text.js";
import { joinByteText } from "../../encoding/byte-value.js";
import type { CellValue } from "../../workbook.js";

export function replaceByteText(source: Uint8Array, replacement: Uint8Array, start: number, count: number, maximum: number, tick: () => void): CellValue {
  if (Number.isNaN(start) || Number.isNaN(count)) return { kind: "error", value: "#VALUE!" };
  const from = Math.trunc(Math.min(source.length, start - 1));
  const to = from + Math.trunc(Math.min(source.length - from, count));
  if (validatedByteTextCharacter(source, from, source.length, tick) === undefined || validatedByteTextCharacter(source, to, source.length, tick) === undefined)
    return { kind: "error", value: "#VALUE!" };
  let position = from;
  while (position < to) {
    const next = validatedByteTextCharacter(source, position, to, tick);
    if (typeof next !== "number") return { kind: "error", value: "#VALUE!" };
    position = next;
  }
  return joinByteText([source.subarray(0, from), replacement, source.subarray(to)], new Uint8Array(), maximum, tick);
}
