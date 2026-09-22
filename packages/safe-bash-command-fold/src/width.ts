import { zeroWidthRanges, wideRanges } from './width-data.js';
function contains(ranges: readonly (readonly [number, number])[], cp: number): boolean {
  let lo = 0, hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1, range = ranges[mid]!;
    if (cp < range[0]) hi = mid;
    else if (cp > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}
/** Deterministic gnulib-compatible UTF-8 width table, independent of libc/Intl. */
export function portableWidth(cp: number): number {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return -1;
  if (contains(zeroWidthRanges, cp)) return cp > 0 && cp < 0xa0 ? -1 : 0;
  return contains(wideRanges, cp) ? 2 : 1;
}
