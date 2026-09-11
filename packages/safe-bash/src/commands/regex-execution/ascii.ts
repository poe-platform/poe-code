/** Locale-independent ASCII folding; other byte/scalar values remain exact. */
export function foldAscii(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}
