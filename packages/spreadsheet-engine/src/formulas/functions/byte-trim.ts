// Gnumeric1.12.61 TRIM semantics with owned byte cursors and output admission.
// GPL-2.0-or-later; see the package LICENSE.
import { encodeByteTextPoints } from "../../encoding/byte-points.js";
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
  return encodeByteTextPoints(traverse, maximum, tick);
}
