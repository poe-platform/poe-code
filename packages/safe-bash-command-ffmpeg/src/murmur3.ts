import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

function rotate(value: bigint, bits: bigint): bigint {
  return BigInt.asUintN(64, value << bits) | (value >> (64n - bits));
}

function mixFirst(value: bigint): bigint {
  return BigInt.asUintN(64, rotate(BigInt.asUintN(64, value * 0x87c37b91114253d5n), 31n) * 0x4cf5ad432745937fn);
}

function mixSecond(value: bigint): bigint {
  return BigInt.asUintN(64, rotate(BigInt.asUintN(64, value * 0x4cf5ad432745937fn), 33n) * 0x87c37b91114253d5n);
}

function avalanche(value: bigint): bigint {
  value = BigInt.asUintN(64, (value ^ (value >> 33n)) * 0xff51afd7ed558ccdn);
  value = BigInt.asUintN(64, (value ^ (value >> 33n)) * 0xc4ceb9fe1a85ec53n);
  return value ^ (value >> 33n);
}

export function murmur3(chunks: Iterable<Uint8Array>, budget: MediaBudgetTracker): Uint8Array {
  // FFmpeg uses MurmurHash3 x64/128 with this seed and little-endian digest words.
  let first = 0x725acc55daddca55n, second = first;
  const block = new Uint8Array(16);
  const view = new DataView(block.buffer);
  let buffered = 0, length = 0, blocks = 0;
  for (const bytes of chunks) {
    budget.checkCpu();
    length += bytes.length;
    for (let offset = 0; offset < bytes.length;) {
      const size = Math.min(16 - buffered, bytes.length - offset);
      block.set(bytes.subarray(offset, offset + size), buffered);
      buffered += size;
      offset += size;
      if (buffered !== 16) continue;
      if (blocks++ % 256 === 0) budget.checkCpu();
      first ^= mixFirst(view.getBigUint64(0, true));
      first = BigInt.asUintN(64, (rotate(first, 27n) + second) * 5n + 0x52dce729n);
      second ^= mixSecond(view.getBigUint64(8, true));
      second = BigInt.asUintN(64, (rotate(second, 31n) + first) * 5n + 0x38495ab5n);
      buffered = 0;
    }
  }
  block.fill(0, buffered);
  first ^= mixFirst(view.getBigUint64(0, true)) ^ BigInt(length);
  second ^= mixSecond(view.getBigUint64(8, true)) ^ BigInt(length);
  first = BigInt.asUintN(64, first + second);
  second = BigInt.asUintN(64, second + first);
  first = avalanche(first);
  second = avalanche(second);
  first = BigInt.asUintN(64, first + second);
  second = BigInt.asUintN(64, second + first);
  view.setBigUint64(0, first, true);
  view.setBigUint64(8, second, true);
  return block;
}
