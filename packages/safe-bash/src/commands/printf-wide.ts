import { yieldTurn } from "../contracts/yield.js";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export async function widePrintf(bytes: Uint8Array, character: boolean, precision: number | undefined, signal: AbortSignal): Promise<{ bytes: Uint8Array; characters: number }> {
  signal.throwIfAborted();
  const take = character ? Math.min(1, precision ?? 1) : precision ?? Infinity;
  if (character && !bytes.length) return { bytes: take ? Uint8Array.of(0) : new Uint8Array(), characters: take };
  let count = 0, end = 0, emitted = 0, firstHigh = -1;
  // Bash's signed-byte fallback cannot re-encode negative wide characters.
  const fallback = () => {
    const characters = Math.min(bytes.length, take);
    return { bytes: firstHigh >= characters ? bytes.subarray(0, characters) : new Uint8Array(), characters };
  };
  for (let offset = 0; offset < bytes.length && (!character || count < 1); count++) {
    if (count && count % 1024 === 0) await yieldTurn(signal);
    const first = bytes[offset]!;
    if (first >= 128 && firstHigh < 0) firstHigh = offset;
    const size = first < 128 ? 1 : first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
    if (!size || offset + size > bytes.length) return fallback();
    if (size > 1) {
      try { decoder.decode(bytes.subarray(offset, offset + size)); }
      catch (error) { if (error instanceof TypeError) return fallback(); throw error; }
    }
    if (count < take) { end = offset + size; emitted++; }
    offset += size;
  }
  return { bytes: bytes.subarray(0, end), characters: emitted };
}
