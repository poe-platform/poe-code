import type { ServiceDescriptor } from "./types.js";

/** Native strcmp ordering, independent of locale and UTF-16 surrogate order. */
export function compareServiceIds(a: ServiceDescriptor, b: ServiceDescriptor): number {
  const encoder = new TextEncoder();
  const left = encoder.encode(a.id), right = encoder.encode(b.id);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference = left[index]! - right[index]!;
    if (difference) return difference;
  }
  return left.length - right.length;
}
