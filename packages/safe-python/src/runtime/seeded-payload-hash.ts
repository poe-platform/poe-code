import type { CodePointString } from "./code-point-string.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import type { ExecutionMeter } from "./execution-budget.js";

function rotate(value: bigint, bits: bigint): bigint {
  return BigInt.asUintN(64, (value << bits) | (value >> (64n - bits)));
}

/** Emit CPython-style compact Unicode storage in our fixed little-endian model.
 * Width applies to the entire string, including its ASCII members. Surrogate
 * code points remain independent; no host string conversion or byte copy occurs.
 */
function* compactBytes(value: CodePointString, width: number): IterableIterator<number> {
  for (const point of value) for (let byte = 0; byte < width; byte++) yield (point >>> (byte * 8)) & 255;
}

/** SipHash-1-3 payload policy. The host must supply an unpredictable 128-bit key
 * once per runtime (or an explicit deterministic test key); no fixed default is
 * provided. This is container hashing, not a message authentication API.
 * Traversal/rounds and 32 bytes of logical working state are charged. Full host
 * bigint/iterator temporary allocation accounting remains unfinished.
 */
export class SeededPayloadHash {
  readonly #key0: bigint;
  readonly #key1: bigint;

  constructor(key0: bigint, key1: bigint) {
    if (BigInt.asUintN(64, key0) !== key0 || BigInt.asUintN(64, key1) !== key1) throw new RangeError("hash key words must be unsigned 64-bit integers");
    this.#key0 = key0;
    this.#key1 = key1;
    Object.freeze(this);
  }

  bytes(value: ImmutableBytes, meter: ExecutionMeter): bigint {
    meter.checkpoint();
    return value.length === 0 ? 0n : this.#hash(value, meter);
  }

  string(value: CodePointString, meter: ExecutionMeter): bigint {
    meter.checkpoint();
    if (value.length === 0) return 0n;
    let maximum = 0;
    for (const point of value) { meter.checkpoint(); if (point > maximum) maximum = point; }
    const width = maximum <= 255 ? 1 : maximum <= 65535 ? 2 : 4;
    return this.#hash(compactBytes(value, width), meter);
  }

  #hash(bytes: Iterable<number>, meter: ExecutionMeter): bigint {
    meter.checkpoint(0, 32);
    let a = this.#key0 ^ 0x736f6d6570736575n;
    let b = this.#key1 ^ 0x646f72616e646f6dn;
    let c = this.#key0 ^ 0x6c7967656e657261n;
    let d = this.#key1 ^ 0x7465646279746573n;
    const round = () => {
      meter.checkpoint();
      a = BigInt.asUintN(64, a + b); b = rotate(b, 13n) ^ a; a = rotate(a, 32n);
      c = BigInt.asUintN(64, c + d); d = rotate(d, 16n) ^ c;
      a = BigInt.asUintN(64, a + d); d = rotate(d, 21n) ^ a;
      c = BigInt.asUintN(64, c + b); b = rotate(b, 17n) ^ c; c = rotate(c, 32n);
    };
    let message = 0n, offset = 0, lengthByte = 0;
    for (const byte of bytes) {
      meter.checkpoint();
      message |= BigInt(byte) << BigInt(offset * 8);
      offset++;
      lengthByte = (lengthByte + 1) & 255;
      if (offset === 8) {
        d ^= message; round(); a ^= message;
        offset = 0; message = 0n;
      }
    }
    message |= BigInt(lengthByte) << 56n;
    d ^= message; round(); a ^= message;
    c ^= 255n;
    round(); round(); round();
    const hash = BigInt.asIntN(64, a ^ b ^ c ^ d);
    return hash === -1n ? -2n : hash;
  }
}
