import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha224, sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { MediaProbeSource, MediaProbeText } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

const hashes = { md5, sha160: sha1, sha224, sha256, sha384, sha512 };
export function packetHashAlgorithm(value: string): keyof typeof hashes {
  const name = value.toLowerCase();
  if (!Object.hasOwn(hashes, name)) throw new Error(`Unknown hash algorithm '${value}'`);
  return name as keyof typeof hashes;
}

export function packetHash(bytes: Uint8Array, algorithm: keyof typeof hashes): string {
  return `${algorithm.toUpperCase()}:${bytesToHex(hashes[algorithm](bytes))}`;
}

export function packetSourceHash(source: MediaProbeSource, offset: number, size: number, algorithm: keyof typeof hashes): MediaProbeText {
  return { kind: "text", async *chunks() {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0 || offset + size > source.size)
      throw new Error("Invalid packet data span");
    const hash = hashes[algorithm].create();
    for (let start = 0; start < size; start += 65536) {
      const length = Math.min(65536, size - start);
      const bytes = await source.read(offset + start, length);
      if (bytes.length !== length) throw new Error("Truncated packet data");
      hash.update(bytes);
      await yieldTurn();
    }
    yield `${algorithm.toUpperCase()}:${bytesToHex(hash.digest())}`;
  } };
}
