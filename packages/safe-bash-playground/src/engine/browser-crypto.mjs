import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha224, sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { Buffer } from "./browser-builtins.mjs";

const checksums = Object.freeze({ md5, sha1, sha224, sha256, sha384, sha512 });

export function createHash(algorithm) {
  const name = algorithm.toLowerCase();
  if (!Object.hasOwn(checksums, name)) throw new Error(`Unsupported checksum algorithm: ${algorithm}`);
  const hash = checksums[name].create();
  return {
    update(data, encoding) {
      if (typeof data !== "string" && !ArrayBuffer.isView(data)) {
        throw new TypeError("Hash input must be a string or byte view");
      }
      const bytes = typeof data === "string"
        ? Buffer.from(data, encoding)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      hash.update(bytes);
      return this;
    },
    digest(encoding) {
      const bytes = Buffer.from(hash.digest());
      return encoding === undefined ? bytes : bytes.toString(encoding);
    }
  };
}

export function randomBytes(size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > 0x7fffffff) {
    throw new RangeError("Invalid random byte count");
  }
  const bytes = Buffer.alloc(size);
  for (let offset = 0; offset < size; offset += 65536) {
    globalThis.crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, size)));
  }
  return bytes;
}

export function randomUUID() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomInt(minimum, maximum) {
  if (maximum === undefined) {
    maximum = minimum;
    minimum = 0;
  }
  const range = maximum - minimum;
  if (
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    range < 1 ||
    range > 2 ** 32
  )
    throw new RangeError("Unsupported random integer range");
  const ceiling = Math.floor(2 ** 32 / range) * range;
  const bytes = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(bytes);
  } while (bytes[0] >= ceiling);
  return minimum + (bytes[0] % range);
}
