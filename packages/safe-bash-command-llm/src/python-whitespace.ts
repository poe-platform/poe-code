/** Python str.isspace differs from JavaScript trim for these control points. */
export function isPythonWhitespace(char: string): boolean {
  return char !== "\ufeff" && (!char.trim() || char >= "\u001c" && char <= "\u001f" || char === "\u0085");
}

export function stripPythonWhitespace(value: string): string {
  let start = 0, end = value.length;
  while (start < end && isPythonWhitespace(value[start]!)) start++;
  while (end > start && isPythonWhitespace(value[end - 1]!)) end--;
  return value.slice(start, end);
}
