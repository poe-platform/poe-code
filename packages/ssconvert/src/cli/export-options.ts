import { SsconvertError } from "../contracts.js";
import { isUnicodeAlphanumeric } from "./unicode-alphanumeric.js";

// GLib 2.84.4 g_unichar_isspace excludes both vertical tab and U+FEFF.
const isWhitespace = (character: string) => character !== "\u000b" && character !== "\ufeff" && character.trim() === "";

/** GOffice go_parse_key_value/go_strunescape: whitespace separates pairs. */
export function* exportOptionPairs(text: string): Generator<readonly [string, string]> {
  const terminator = text.indexOf("\0");
  if (terminator !== -1) text = text.slice(0, terminator);
  let offset = 0;
  const whitespace = () => {
    while (offset < text.length && isWhitespace(text[offset]!)) offset++;
  };
  const quoted = () => {
    const quote = text[offset++]!;
    let value = "";
    while (offset < text.length) {
      const character = text[offset++]!;
      if (character === quote) return value;
      if (character === "\\") {
        if (offset === text.length) break;
        value += text[offset++]!;
      } else value += character;
    }
    throw new SsconvertError("invalid-request", "ssconvert: Quoted string not terminated");
  };
  while (true) {
    whitespace();
    if (offset === text.length) return;
    let key = "";
    if (text[offset] === "\"" || text[offset] === "'") key = quoted();
    else {
      while (offset < text.length) {
        const code = text.codePointAt(offset)!;
        const character = String.fromCodePoint(code);
        const alphanumeric = isUnicodeAlphanumeric(code);
        if (!alphanumeric && !"-!_.,:;|/$%#@~".includes(character)) break;
        key += character;
        offset += character.length;
      }
      if (!key) throw new SsconvertError("invalid-request", "ssconvert: Syntax error");
    }
    whitespace();
    if (text[offset++] !== "=") throw new SsconvertError("invalid-request", "ssconvert: Syntax error");
    whitespace();
    let value = "";
    if (text[offset] === "\"" || text[offset] === "'") value = quoted();
    else while (offset < text.length && !isWhitespace(text[offset]!)) value += text[offset++]!;
    yield [key, value];
  }
}
