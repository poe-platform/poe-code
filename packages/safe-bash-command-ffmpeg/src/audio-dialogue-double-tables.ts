import tables from "./audio-dialogue-double-tables.json" with { type: "json" };

// The original little-endian binary64 constants, encoded as five successive
// modulo-2^64 differences followed by signed ZigZag/base-128 varints.
// Integer reconstruction preserves every bit without runtime sin/cos rounding.
export function decodeDialogueTable(size: 2048 | 4096 | 8192 | "cosine"): DataView {
  const encoded = atob(tables[size]);
  const output = new DataView(new ArrayBuffer((size === "cosine" ? 2049 : size) * 8));
  const sums = [0n, 0n, 0n, 0n, 0n];
  let offset = 0;
  for (let index = 0; index < output.byteLength; index += 8) {
    let value = 0n, shift = 0n, byte: number;
    do {
      byte = encoded.charCodeAt(offset++);
      value |= BigInt(byte & 127) << shift;
      shift += 7n;
    } while (byte & 128);
    value = (value >> 1n) ^ -(value & 1n);
    for (let order = 0; order < sums.length; order++) {
      value = sums[order] = BigInt.asUintN(64, sums[order]! + value);
    }
    output.setBigUint64(index, value, true);
  }
  return output;
}
