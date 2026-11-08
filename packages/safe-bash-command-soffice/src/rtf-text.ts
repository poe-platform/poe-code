/** The RTF compatibility grammar requests bytes and group state from its caller. */
export type RtfTextStep =
  | { readonly kind: "read"; readonly position: number }
  | { readonly kind: "group-read"; readonly index: number }
  | { readonly kind: "group-write"; readonly index: number; readonly value: number }
  | { readonly kind: "text"; readonly value: string };
const latin1 = new TextDecoder("windows-1252").decode(Uint8Array.from({ length: 256 }, (_, index) => index));
const letter = (byte: number | undefined): boolean => byte !== undefined && (byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122);
const digit = (byte: number | undefined): boolean => byte !== undefined && byte >= 48 && byte <= 57;
const hex = (byte: number | undefined): number => byte === undefined ? -1 : "0123456789abcdef".indexOf(String.fromCharCode(byte).toLowerCase());

export function* rtfTextSteps(size: number): Generator<RtfTextStep, void, number | undefined> {
  let position = 0, depth = 0, hidden = false;
  while (position < size) {
    const byte = yield { kind: "read", position: position++ };
    if (byte === 123) yield { kind: "group-write", index: depth++, value: hidden ? 1 : 0 };
    else if (byte === 125) hidden = depth ? Boolean(yield { kind: "group-read", index: --depth }) : false;
    else if (byte === 92) {
      const symbol = yield { kind: "read", position: position++ };
      if (symbol === 42) hidden = true;
      else if (symbol === 92 || symbol === 123 || symbol === 125) { if (!hidden) yield { kind: "text", value: latin1[symbol]! }; }
      else if (symbol === 39) {
        const first = hex(yield { kind: "read", position: position++ });
        const second = hex(yield { kind: "read", position: position++ });
        if (!hidden && first >= 0 && second >= 0) yield { kind: "text", value: latin1[first * 16 + second]! };
      } else if (letter(symbol)) {
        let word = String.fromCharCode(symbol!), next = yield { kind: "read", position };
        while (letter(next)) {
          // No recognized control word exceeds ten characters.
          if (word.length <= 10) word += String.fromCharCode(next!);
          position++; next = yield { kind: "read", position };
        }
        let negative = false, parameter = 0;
        if (next === 45) { negative = true; position++; next = yield { kind: "read", position }; }
        while (digit(next)) {
          parameter = parameter * 10 + next! - 48;
          position++; next = yield { kind: "read", position };
        }
        if (negative) parameter = -parameter;
        if (next === 32) position++;
        if (["fonttbl", "colortbl", "stylesheet", "info", "pict", "object"].includes(word)) hidden = true;
        if (word === "bin" && Number.isSafeInteger(parameter) && parameter > 0) position += parameter;
        else if (!hidden) {
          if (word === "par" || word === "line") yield { kind: "text", value: "\n" };
          else if (word === "tab") yield { kind: "text", value: "\t" };
        }
      } else if (!hidden && symbol === 126) yield { kind: "text", value: "\u00a0" };
    } else if (!hidden && byte !== undefined && byte !== 13 && byte !== 10) yield { kind: "text", value: latin1[byte]! };
  }
}
