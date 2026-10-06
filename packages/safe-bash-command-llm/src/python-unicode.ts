/** JavaScript strings can retain lone surrogates; Python's UTF8 encoder cannot. */
export function hasUnpairedSurrogate(value: string): boolean {
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return true;
  }
  return false;
}

/** Internal provenance for Python IDs that cannot be represented by a JS string. */
export const pythonSurrogateId: unique symbol = Symbol("pythonSurrogateId");

/** Python sorts strings by Unicode code points, including supplementary planes. */
export function unicodeOrder(left: string, right: string): number {
  let a = 0, b = 0;
  while (a < left.length && b < right.length) {
    const x = left.codePointAt(a)!, y = right.codePointAt(b)!;
    if (x !== y) return x - y;
    a += x > 65535 ? 2 : 1;
    b += y > 65535 ? 2 : 1;
  }
  return (a < left.length ? 1 : 0) - (b < right.length ? 1 : 0);
}
