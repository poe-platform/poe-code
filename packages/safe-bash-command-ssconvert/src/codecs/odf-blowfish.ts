import { blowfishWords } from "./odf-blowfish-profile.js";

/** Blowfish CFB for ODF, including LibreOffice's eight-byte feedback variant.
 * The pinned MIT primitive is adapted for owned
 * schedule cleanup and cooperative cancellation, without temporary key copies.
 * Work and input sizes must be admitted by the package reader/writer first. */
export async function transformOdfBlowfish(key: Uint8Array, iv: Uint8Array, input: Uint8Array,
  signal: AbortSignal, direction: "encrypt" | "decrypt", feedbackBytes: 1 | 8 = 1): Promise<Uint8Array> {
  signal.throwIfAborted();
  if (key.length < 4 || key.length > 56 || iv.length !== 8) throw new TypeError("Invalid ODF Blowfish profile");
  const words = new Uint32Array(1042), output = new Uint8Array(input.length);
  for (let i = 0; i < words.length; i++) words[i] = Number.parseInt(blowfishWords.slice(i * 8, i * 8 + 8), 16);
  const p = words.subarray(0, 18), s = words.subarray(18);
  function encrypt(left: number, right: number): readonly [number, number] {
    for (let round = 0; round < 16; round++) {
      left = (left ^ p[round]!) >>> 0;
      const f = ((((s[left >>> 24]! + s[256 + (left >>> 16 & 255)]!) | 0) ^ s[512 + (left >>> 8 & 255)]!)
        + s[768 + (left & 255)]!) >>> 0;
      const next = (right ^ f) >>> 0; right = left; left = next;
    }
    return [(right ^ p[17]!) >>> 0, (left ^ p[16]!) >>> 0];
  }
  try {
    for (let i = 0, at = 0; i < p.length; i++) {
      let word = 0;
      for (let byte = 0; byte < 4; byte++, at++) word = (word << 8) | key[at % key.length]!;
      p[i] = p[i]! ^ word;
    }
    let left = 0, right = 0;
    for (let i = 0; i < words.length; i += 2) {
      signal.throwIfAborted();
      [left, right] = encrypt(left, right); words[i] = left; words[i + 1] = right;
    }
    const view = new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
    left = view.getUint32(0); right = view.getUint32(4);
    let streamLeft = 0, streamRight = 0;
    for (let i = 0; i < input.length; i++) {
      signal.throwIfAborted();
      if (i % feedbackBytes === 0) [streamLeft, streamRight] = encrypt(left, right);
      const byte = input[i]!;
      output[i] = byte ^ (streamLeft >>> 24);
      streamLeft = ((streamLeft << 8) | (streamRight >>> 24)) >>> 0; streamRight = (streamRight << 8) >>> 0;
      const feedback = direction === "encrypt" ? output[i]! : byte;
      left = ((left << 8) | (right >>> 24)) >>> 0; right = ((right << 8) | feedback) >>> 0;
      if ((i & 4095) === 4095) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted(); return output;
  } catch (error) { output.fill(0); throw error; }
  finally { words.fill(0); }
}
