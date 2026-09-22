/// <reference types="node" />
/** Explicit Node platform adapter. Never imported by the portable engine. */
import { createHash, createCipheriv, createDecipheriv } from "node:crypto";
import { createPdfCrypto } from "./crypto.js";
import { admittedByteLength } from "./syntax.js";
import type { PdfCrypto } from "./security.js";

export function createNodePdfCrypto(options: { inputBytes?: number } = {}): PdfCrypto {
  const limit = options.inputBytes ?? 32 * 1024 * 1024;
  const algorithms = { MD5: "md5", "SHA-256": "sha256", "SHA-384": "sha384", "SHA-512": "sha512" };
  const admit = (bytes: Uint8Array): number => {
    const length = admittedByteLength(bytes);
    if (length === undefined) throw new TypeError("crypto requires Uint8Array bytes");
    if (length > limit) throw new RangeError("crypto input byte limit");
    return length;
  };
  return createPdfCrypto({
    digest(algorithm, bytes, signal) {
      signal?.throwIfAborted();
      admit(bytes);
      if (!Object.hasOwn(algorithms, algorithm)) throw new TypeError("unsupported digest algorithm");
      const result = createHash(algorithms[algorithm]).update(bytes).digest();
      signal?.throwIfAborted();
      return new Uint8Array(result);
    },
    aes(operation, mode, key, iv, bytes, signal) {
      signal?.throwIfAborted();
      const length = admit(bytes);
      const keyLength = admittedByteLength(key);
      const ivLength = admittedByteLength(iv);
      if (operation !== "encrypt" && operation !== "decrypt") throw new TypeError("invalid AES operation");
      if (mode !== "CBC" && mode !== "ECB") throw new TypeError("invalid AES mode");
      if (keyLength !== 16 && keyLength !== 32) throw new RangeError("invalid PDF AES key length");
      if (ivLength !== (mode === "CBC" ? 16 : 0)) throw new RangeError("invalid AES IV length");
      if (length % 16 !== 0) throw new RangeError("invalid AES block length");
      const algorithm = `aes-${keyLength * 8}-${mode.toLowerCase()}`;
      const cipher = operation === "encrypt"
        ? createCipheriv(algorithm, key, mode === "CBC" ? iv : null)
        : createDecipheriv(algorithm, key, mode === "CBC" ? iv : null);
      cipher.setAutoPadding(false);
      const first = cipher.update(bytes);
      const last = cipher.final();
      signal?.throwIfAborted();
      const result = new Uint8Array(first.byteLength + last.byteLength);
      result.set(first);
      result.set(last, first.byteLength);
      return result;
    }
  }, options);
}
