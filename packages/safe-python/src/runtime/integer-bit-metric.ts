import type { ExecutionMeter } from "./execution-budget.js";

/** Hex conversion avoids a quadratic sequence of whole-BigInt shifts. The
 * current host BigInt representation lacks size metadata, so temporary string
 * storage is charged immediately after conversion; preallocation accounting
 * and interruption within host conversion remain representation-level work. */
export function integerBitMetric(value: bigint, name: "bit_length" | "bit_count", meter: ExecutionMeter): number {
  meter.checkpoint();
  if (value === 0n) return 0;
  const digits = value.toString(16);
  meter.checkpoint(1, 32 + digits.length * 2);
  const start = value < 0n ? 1 : 0;
  if (name === "bit_length") {
    const code = digits.charCodeAt(start), first = code >= 97 ? code - 87 : code - 48;
    return (digits.length - start - 1) * 4 + 32 - Math.clz32(first);
  }
  let count = 0;
  for (let index = start; index < digits.length; index++) {
    meter.checkpoint();
    const code = digits.charCodeAt(index), nibble = code >= 97 ? code - 87 : code - 48;
    const pairs = nibble - ((nibble >>> 1) & 5);
    count += (pairs & 3) + ((pairs >>> 2) & 3);
  }
  return count;
}
