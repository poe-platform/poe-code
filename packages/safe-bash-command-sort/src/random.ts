import type { SortWork } from "./work.js";

// One seed per invocation gives equal keys the same ordering across spill runs.
// Hash collisions are resolved by byte comparison, preserving distinct keys.
export async function randomSortHash(chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>, seed: number, work: SortWork): Promise<number> {
  let hash = seed;
  for await (const bytes of chunks) {
    for (let offset = 0; offset < bytes.length; offset += 1024) {
      const end = Math.min(offset + 1024, bytes.length);
      await work.charge(end - offset);
      for (let index = offset; index < end; index++) hash = Math.imul(hash ^ bytes[index]!, 0x01000193);
    }
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}
