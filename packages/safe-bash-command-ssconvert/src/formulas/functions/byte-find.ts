// Gnumeric1.12.61 literal FIND/FINDB with owned C-string bytes and bounded GLib cursors.
// GPL-2.0-or-later; see the package LICENSE.
import { byteTextLength, readByteTextCharacter } from "../../encoding/byte-text.js";

export function findByteText(needle: Uint8Array, source: Uint8Array, start: number, bytes: boolean, tick: () => void): number | undefined {
  tick();
  const length = bytes ? source.length : byteTextLength(source, tick);
  if (Number.isNaN(start) || start < 1 || start >= length + 1) return undefined;
  const initial = Math.trunc(start);
  let from = 0;
  if (bytes) {
    from = initial - 1;
    // g_utf8_find_next_char advances past every continuation byte at the start.
    if (initial !== 1) while (from < source.length && (source[from]! & 192) === 128) { tick(); from++; }
  } else {
    for (let index = 1; index < initial; index++) { tick(); from = readByteTextCharacter(source, from, tick).next; }
  }
  for (let position = from; position <= source.length - needle.length; position++) {
    tick();
    let matches = true;
    for (let index = 0; index < needle.length; index++) {
      tick();
      if (source[position + index] !== needle[index]) { matches = false; break; }
    }
    if (!matches) continue;
    if (bytes) return position + 1;
    let count = initial;
    for (let cursor = from; cursor < position; count++) { tick(); cursor = readByteTextCharacter(source, cursor, tick).next; }
    return count;
  }
  return undefined;
}
