/** Python whitespace: Unicode bidi classes WS/B/S or category Zs.
 * Unlike ECMAScript trim, includes U+001C..001F and excludes U+FEFF. */
export function isUnicodeWhitespace(point: number): boolean {
  return (point >= 0x09 && point <= 0x0d) || (point >= 0x1c && point <= 0x20)
    || point === 0x85 || point === 0xa0 || point === 0x1680
    || (point >= 0x2000 && point <= 0x200a) || point === 0x2028
    || point === 0x2029 || point === 0x202f || point === 0x205f || point === 0x3000;
}
