// Gnumeric1.12.61 TRIM semantics with owned byte cursors and output admission.
// GPL-2.0-or-later; see the package LICENSE.
import { SsconvertError } from "../../contracts.js";
import { readByteTextCharacter } from "../../encoding/byte-text.js";

export function trimByteText(input: Uint8Array, maximum: number, tick: () => void): Uint8Array {
  let end = 0;
  while (end < input.length && input[end] !== 0) { tick(); end++; }
  const source = input.subarray(0, end);
  const traverse = (emit: (point: number) => void) => {
    let position = 0, content = false, pendingSpace = false, terminated = false;
    while (position < end) {
      tick();
      // Native TRIM recognizes literal space bytes, including after an invalid
      // lead chunk. Historical encodings of space are ordinary point output.
      if (source[position] === 32) { pendingSpace = content; position++; continue; }
      const character = readByteTextCharacter(source, position, tick);
      position = character.next;
      if (!terminated) {
        if (pendingSpace) emit(32);
        if (character.point === 0) terminated = true;
        else emit(character.point);
      }
      content = true; pendingSpace = false;
    }
  };
  const width = (point: number) => point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : point < 2097152 ? 4 : point < 67108864 ? 5 : 6;
  let size = 0;
  traverse(point => {
    for (let count = width(point); count > 0; count--) {
      tick();
      if (++size > maximum) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
    }
  });
  tick();
  const result = new Uint8Array(size); let offset = 0;
  traverse(point => {
    const count = width(point); let remaining = point;
    for (let index = count - 1; index > 0; index--) {
      tick(); result[offset + index] = 128 | (remaining & 63); remaining = Math.floor(remaining / 64);
    }
    tick(); result[offset] = count === 1 ? point : [0, 0, 192, 224, 240, 248, 252][count]! | remaining;
    offset += count;
  });
  return result;
}
