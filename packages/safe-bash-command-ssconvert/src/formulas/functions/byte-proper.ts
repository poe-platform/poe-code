// Gnumeric1.12.61 PROPER semantics with owned byte cursors and output admission.
// GPL-2.0-or-later; see the package LICENSE.
import { readByteTextCharacter } from "../../encoding/byte-text.js";
import { encodeByteTextPoints } from "../../encoding/byte-points.js";
import { isUnicodeAlpha } from "../../workbook/unicode-sheet-name.js";
import { simpleUnicodeCase } from "./unicode.js";

export function properByteText(input: Uint8Array, maximum: number, tick: () => void): Uint8Array {
  let end = 0;
  while (end < input.length && input[end] !== 0) { tick(); end++; }
  const source = input.subarray(0, end);
  return encodeByteTextPoints(emit => {
    let inword = false, terminated = false;
    for (let position = 0; position < end;) {
      tick();
      const { point, next } = readByteTextCharacter(source, position, tick);
      position = next;
      const letter = isUnicodeAlpha(point);
      const output = letter ? simpleUnicodeCase(point, !inword).codePointAt(0)! : point;
      inword = letter;
      if (output === 0) terminated = true;
      if (!terminated) emit(output);
    }
  }, maximum, tick);
}
