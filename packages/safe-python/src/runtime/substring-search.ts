export type SearchMode = "find" | "rfind" | "count";

/** KMP search over a validated nonempty pattern and a bounded code-unit window.
 * Prefix fallback keeps repetitive inputs linear; count resets after each match
 * while rfind retains overlapping candidates. Works for bytes or code points.
 */
export function searchSubstring(haystack: Uint8Array | Uint32Array, needle: Uint8Array | Uint32Array, start: number, stop: number, mode: SearchMode): number {
  const prefix = new Uint32Array(needle.length);
  for (let index = 1, matched = 0; index < needle.length; index++) {
    while (matched > 0 && needle[index] !== needle[matched]) matched = prefix[matched - 1]!;
    if (needle[index] === needle[matched]) matched++;
    prefix[index] = matched;
  }
  let matched = 0;
  let result = mode === "count" ? 0 : -1;
  for (let index = start; index < stop; index++) {
    while (matched > 0 && haystack[index] !== needle[matched]) matched = prefix[matched - 1]!;
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
