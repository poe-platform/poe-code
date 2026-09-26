// Gnumeric1.12.61 byte slicing with owned bounds and GLib boundary rules.
// GPL-2.0-or-later; see the package LICENSE.
import { validatedByteTextCharacter } from "../../encoding/byte-text.js";
import { byteStringValue } from "../../encoding/byte-value.js";
import type { CellValue } from "../../workbook.js";
import { SsconvertError } from "../../contracts.js";

export function sliceBytes(source: Uint8Array, operation: "left" | "right" | "mid", start: number, count: number,
  maximum: number, tick: () => void): CellValue {
  tick();
  if (Number.isNaN(count) || count < 0 || operation === "mid" && (Number.isNaN(start) || start < 1))
    return { kind: "error", value: "#VALUE!" };
  const size = Math.trunc(Math.min(operation === "mid" ? 2147483647 / 2 : 2147483647, count));
  let from = 0, to = source.length;
  if (operation === "mid") {
    from = Math.trunc(Math.min(2147483647 / 2, start)) - 1;
    if (from >= source.length || validatedByteTextCharacter(source, from, source.length, tick) === undefined)
      return { kind: "error", value: "#VALUE!" };
  }
  if (operation === "right" && size < source.length) {
    from = source.length - size;
    while (from < source.length && (source[from]! & 192) === 128) { tick(); from++; }
  } else if (operation !== "right" && from + size < source.length) {
    to = from + size;
    while (to >= from && (source[to]! & 192) === 128) { tick(); to--; }
    // Native LEFTB subtracts NULL when no previous lead byte exists. Its observed
    // full-source output is represented by a bounded owned copy, never pointer
    // subtraction or a scan outside the admitted source.
    if (to < from) to = source.length;
  }
  if (to - from > maximum) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
  const result = new Uint8Array(to - from);
  for (let index = 0; index < result.length; index++) { tick(); result[index] = source[from + index]!; }
  return byteStringValue(result, tick, maximum);
}
