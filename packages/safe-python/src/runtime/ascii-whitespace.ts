/** Python bytes whitespace is independent of Unicode categories and locale. */
export function isAsciiWhitespace(byte: number): boolean {
  return byte === 32 || byte >= 9 && byte <= 13;
}
