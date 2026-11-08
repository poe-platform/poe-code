/** Locale-independent ASCII folding; other byte/scalar values remain exact. */
export function foldAscii(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

/** C-locale word characters, shared by byte and scalar search paths. */
export function isAsciiWord(code: number): boolean {
  return code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 95;
}
