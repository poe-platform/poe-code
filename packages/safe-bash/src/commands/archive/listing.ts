import type { TarOptions } from "./options.js";

export function quoteName(name: string, style: TarOptions["quotingStyle"]): string {
  if (style === "literal") return name;
  const escapes: Record<string, string> = { "\x07": "\\a", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\v": "\\v", "\f": "\\f", "\r": "\\r" };
  let result = style === "c" ? '"' : "";
  for (const character of name) {
    const escape = escapes[character];
    if (escape !== undefined) result += escape;
    else if ((style === "c" && character === '"') || character === "\\") result += `\\${character}`;
    else if (character.charCodeAt(0) < 32 || (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159) || character === "\u2028" || character === "\u2029") {
      for (const byte of Buffer.from(character)) result += `\\${byte.toString(8).padStart(3, "0")}`;
    }
    else result += character;
  }
  return style === "c" ? result + '"' : result;
}
