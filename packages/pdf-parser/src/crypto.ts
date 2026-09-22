/** Original RC4 KSA/PRGA; specification controls are RFC 6229.
 * RC4 is admitted only for legacy PDF interoperability, never new encryption.
 * Digest/AES remain explicit platform capabilities; no ambient fallback. */
import { admittedByteLength } from "./syntax.js";
import type { PdfCrypto } from "./security.js";

/** The maximum admitted message size is capped at 32 MiB. The PDF security
 * factory additionally charges cumulative work, allocations and expansion. */
export function createPdfCrypto(
  platform: Pick<PdfCrypto, "digest" | "aes">,
  options: { inputBytes?: number } = {}
): Pick<PdfCrypto, "digest" | "aes"> & {
  rc4(key: Uint8Array, bytes: Uint8Array, signal?: AbortSignal): Uint8Array;
} {
  const limit = options.inputBytes ?? 32 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 32 * 1024 * 1024)
    throw new RangeError("invalid RC4 input byte limit");
  return Object.freeze({
    digest: platform.digest.bind(platform),
    aes: platform.aes.bind(platform),
    rc4(key: Uint8Array, bytes: Uint8Array, signal?: AbortSignal): Uint8Array {
      signal?.throwIfAborted();
      const keyLength = admittedByteLength(key);
      const length = admittedByteLength(bytes);
      if (keyLength === undefined || length === undefined)
        throw new TypeError("RC4 requires Uint8Array bytes");
      if (keyLength < 1 || keyLength > 256) throw new RangeError("invalid RC4 key length");
      if (length > limit) throw new RangeError("RC4 input byte limit");
      // Snapshot before processing: own length properties and foreign realms
      // cannot change admission. No state survives a call or aliases caller data.
      const ownedKey = new Uint8Array(keyLength);
      const result = new Uint8Array(length);
      Uint8Array.prototype.set.call(ownedKey, key);
      Uint8Array.prototype.set.call(result, bytes);
      const state = new Uint8Array(256);
      try {
        for (let i = 0; i < 256; i++) state[i] = i;
        let j = 0;
        for (let i = 0; i < 256; i++) {
          j = (j + state[i]! + ownedKey[i % keyLength]!) & 255;
          const old = state[i]!;
          state[i] = state[j]!;
          state[j] = old;
        }
        let i = 0;
        j = 0;
        for (let offset = 0; offset < length; offset++) {
          if (offset % 4096 === 0) signal?.throwIfAborted();
          i = (i + 1) & 255;
          j = (j + state[i]!) & 255;
          const old = state[i]!;
          state[i] = state[j]!;
          state[j] = old;
          result[offset] = result[offset]! ^ state[(state[i]! + state[j]!) & 255]!;
        }
        signal?.throwIfAborted();
        return result;
      } catch (error) {
        result.fill(0);
        throw error;
      } finally {
        ownedKey.fill(0);
        state.fill(0);
      }
    }
  });
}
