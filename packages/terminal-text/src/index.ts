/** Makes untrusted text safe to embed in a human-readable terminal field. */
export function escapeTerminalText(text: string): string {
  let result = "";
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      result += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      result += character;
    }
  }
  return result;
}
