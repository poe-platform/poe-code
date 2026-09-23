// GLib2.84.4 Unicode16 C-locale casing adapted to owned, bounded cursors.
// LGPL-2.1-or-later; see byte-case-NOTICE.md and ../../encoding/LGPL-2.1.txt.
import { SsconvertError } from "../../contracts.js";
import { readByteTextCharacter } from "../../encoding/byte-text.js";
import { isUnicodeAlpha } from "../../workbook/unicode-sheet-name.js";
import { simpleUnicodeCase } from "./unicode.js";
import { caseProperties, lowerFullCases, upperFullCases } from "./byte-case-properties.js";

function hasProperty(point: number, flag: number): boolean {
  let left = 0, right = caseProperties.length - 1;
  while (left <= right) {
    const middle = (left + right) >>> 1, [from, to, properties] = caseProperties[middle]!;
    if (point < from) right = middle - 1;
    else if (point > to) left = middle + 1;
    else return (properties & flag) !== 0;
  }
  return false;
}

/** Count the complete admitted result before allocating it. Preserve inactive
 * source spans exactly; active letter categories reencode even unmapped letters.
 * Native context rules differ from host JavaScript and later GLib profiles. */
export function caseByteText(input: Uint8Array, uppercase: boolean, maximum: number, tick: () => void): Uint8Array {
  tick();
  let end = 0;
  while (end < input.length && input[end] !== 0) { tick(); end++; }
  const source = input.subarray(0, end), encoder = new TextEncoder();
  const fullCases = uppercase ? upperFullCases : lowerFullCases;
  const traverse = (emit: (bytes: Uint8Array, from: number, to: number) => void) => {
    let position = 0;
    while (position < end) {
      const start = position, { point, next } = readByteTextCharacter(source, position, tick);
      position = next;
      let text: string;
      if (!uppercase && point === 0x3a3) {
        // GLib checks only the immediate next character's letter category.
        text = isUnicodeAlpha(readByteTextCharacter(source, position, tick).point) ? "σ" : "ς";
      } else if (uppercase && point === 0x345) {
        // Unicode16 GLib retains all following marks, including U0307, and
        // moves the capital iota after that run without recasing its marks.
        while (position < end) {
          const mark = readByteTextCharacter(source, position, tick);
          if (!hasProperty(mark.point, 4)) break;
          const bytes = encoder.encode(String.fromCodePoint(mark.point));
          emit(bytes, 0, bytes.length); position = mark.next;
        }
        text = "Ι";
      } else if (hasProperty(point, uppercase ? 2 : 1)) {
        text = fullCases.get(point) ?? simpleUnicodeCase(point, uppercase);
      } else {
        emit(source, start, next); continue;
      }
      const bytes = encoder.encode(text);
      emit(bytes, 0, bytes.length);
    }
  };
  let size = 0;
  traverse((_bytes, from, to) => {
    for (let index = from; index < to; index++) {
      tick();
      if (++size > maximum) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
    }
  });
  tick();
  const result = new Uint8Array(size); let offset = 0;
  traverse((bytes, from, to) => {
    for (let index = from; index < to; index++) { tick(); result[offset++] = bytes[index]!; }
  });
  return result;
}
