export function isDecimalIntegerLiteral(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (const character of value) {
    const codePoint = character.charCodeAt(0);
    if (codePoint < 48 || codePoint > 57) {
      return false;
    }
  }

  return true;
}
