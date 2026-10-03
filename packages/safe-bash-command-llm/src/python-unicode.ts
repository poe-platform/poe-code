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
