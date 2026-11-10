import { sha256 } from "@noble/hashes/sha2.js";

/** ImageMagick SHA-256 seed initialization and xoshiro256+ random sequence. */
export function createMagickRandom(seed?: bigint): () => number {
    const key = new DataView(new ArrayBuffer(8));
    if (seed === undefined || BigInt.asUintN(64, seed) === 0xffffffffffffffffn) crypto.getRandomValues(new Uint8Array(key.buffer));
    else key.setBigUint64(0, seed, true);
    const digest = sha256(new Uint8Array(key.buffer)), view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
    let a = view.getBigUint64(0, true), b = view.getBigUint64(8, true), c = view.getBigUint64(16, true), d = view.getBigUint64(24, true);
    return () => {
        const value = Number(BigInt.asUintN(64, a + d) >> 11n) / 9007199254740991;
        const shifted = BigInt.asUintN(64, b << 17n);
        c ^= a; d ^= b; b ^= c; a ^= d; c ^= shifted;
        d = BigInt.asUintN(64, d << 45n) | (d >> 19n);
        return value;
    };
}
