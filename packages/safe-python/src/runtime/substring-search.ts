import type { ExecutionMeter } from "./execution-budget.js";

export type SearchMode = "find" | "rfind" | "count";

/** KMP search over a validated nonempty pattern and a bounded code-unit window.
 * Prefix fallback keeps repetitive inputs linear; count resets after each match
 * while rfind retains overlapping candidates. Works for bytes or code points.
 */
export function searchSubstring(haystack: Uint8Array | Uint32Array, needle: Uint8Array | Uint32Array, start: number, stop: number, mode: SearchMode, meter?: ExecutionMeter): number {
  const prefix = substringPrefix(needle, false, meter);
  let matched = 0;
  let result = mode === "count" ? 0 : -1;
  for (let index = start; index < stop; index++) {
    meter?.checkpoint();
    while (matched > 0 && haystack[index] !== needle[matched]) {
      meter?.checkpoint();
      matched = prefix[matched - 1]!;
    }
    if (haystack[index] === needle[matched]) matched++;
    if (matched === needle.length) {
      if (mode === "find") return index - needle.length + 1;
      if (mode === "count") {
        result++;
        matched = 0;
      } else {
        result = index - needle.length + 1;
        matched = prefix[matched - 1]!;
      }
    }
  }
  return result;
}

/** Nonoverlapping matches in traversal order, with one prefix table per scan.
 * Reverse matching uses reversed indexing, not a copied/reversed input. */
export function* substringMatches(haystack: Uint8Array | Uint32Array, needle: Uint8Array | Uint32Array, reverse: boolean, meter: ExecutionMeter): IterableIterator<number> {
  meter.checkpoint(1, 64);
  if (needle.length === 0) throw new RangeError("substring matches requires a nonempty pattern");
  if (needle.length > haystack.length) return;
  const prefix = substringPrefix(needle, reverse, meter);
  let matched = 0;
  for (let offset = 0; offset < haystack.length; offset++) {
    meter.checkpoint();
    const index = reverse ? haystack.length - 1 - offset : offset, point = haystack[index];
    while (matched > 0 && point !== needle[reverse ? needle.length - 1 - matched : matched]) {
      meter.checkpoint(); matched = prefix[matched - 1];
    }
    if (point === needle[reverse ? needle.length - 1 - matched : matched]) matched++;
    if (matched === needle.length) { yield reverse ? index : index - needle.length + 1; matched = 0; }
  }
}

function substringPrefix(needle: Uint8Array | Uint32Array, reverse: boolean, meter?: ExecutionMeter): Uint32Array {
  meter?.checkpoint(0, needle.length * Uint32Array.BYTES_PER_ELEMENT);
  const prefix = new Uint32Array(needle.length);
  for (let index = 1, matched = 0; index < needle.length; index++) {
    meter?.checkpoint();
    const point = needle[reverse ? needle.length - 1 - index : index];
    while (matched > 0 && point !== needle[reverse ? needle.length - 1 - matched : matched]) {
      meter?.checkpoint(); matched = prefix[matched - 1];
    }
    if (point === needle[reverse ? needle.length - 1 - matched : matched]) matched++;
    prefix[index] = matched;
  }
  return prefix;
}
