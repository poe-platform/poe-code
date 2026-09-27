const HEX_BYTE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const ASCII_CHAR = Array.from({ length: 256 }, (_, i) => (i >= 32 && i <= 126 ? String.fromCharCode(i) : "."));
import type { Format } from "./options.js";

export function formatBlock(block: Uint8Array, used: number, address: number, format: Format): string {
  const canonical = format === "C";
  if (canonical && used === 16) {
    const b0 = block[0]!, b1 = block[1]!, b2 = block[2]!, b3 = block[3]!;
    const b4 = block[4]!, b5 = block[5]!, b6 = block[6]!, b7 = block[7]!;
    const b8 = block[8]!, b9 = block[9]!, b10 = block[10]!, b11 = block[11]!;
    const b12 = block[12]!, b13 = block[13]!, b14 = block[14]!, b15 = block[15]!;
    return `${address.toString(16).padStart(8, "0")}  ${HEX_BYTE[b0]} ${HEX_BYTE[b1]} ${HEX_BYTE[b2]} ${HEX_BYTE[b3]} ${HEX_BYTE[b4]} ${HEX_BYTE[b5]} ${HEX_BYTE[b6]} ${HEX_BYTE[b7]}  ${HEX_BYTE[b8]} ${HEX_BYTE[b9]} ${HEX_BYTE[b10]} ${HEX_BYTE[b11]} ${HEX_BYTE[b12]} ${HEX_BYTE[b13]} ${HEX_BYTE[b14]} ${HEX_BYTE[b15]}  |${ASCII_CHAR[b0]}${ASCII_CHAR[b1]}${ASCII_CHAR[b2]}${ASCII_CHAR[b3]}${ASCII_CHAR[b4]}${ASCII_CHAR[b5]}${ASCII_CHAR[b6]}${ASCII_CHAR[b7]}${ASCII_CHAR[b8]}${ASCII_CHAR[b9]}${ASCII_CHAR[b10]}${ASCII_CHAR[b11]}${ASCII_CHAR[b12]}${ASCII_CHAR[b13]}${ASCII_CHAR[b14]}${ASCII_CHAR[b15]}|\n`;
  }
  let result = address.toString(16).padStart(canonical ? 8 : 7, "0") + (canonical ? "  " : " ");
  if (canonical) {
    for (let index = 0; index < 16; index++) {
      if (index === 8) result += " ";
      result += index < used ? HEX_BYTE[block[index]!]! : "  ";
      if (index !== 15) result += " ";
    }
    result += "  |";
    for (let index = 0; index < used; index++) {
      result += ASCII_CHAR[block[index]!]!;
    }
    return result + "|\n";
  }
  if (format !== "default") {
    const byteFormat = format === "b" || format === "c";
    const stride = byteFormat ? 1 : 2;
    const width = byteFormat ? 3 : 7;
    const escapes: Record<number, string> = { 0: "\\0", 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r" };
    for (let index = 0; index < 16; index += stride) {
      let field = "";
      if (index < used) {
        const byte = block[index]!;
        if (format === "c") field = escapes[byte] ?? (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : byte.toString(8).padStart(3, "0"));
        else if (format === "b") field = byte.toString(8).padStart(3, "0");
        else {
          const word = byte + (index + 1 < used ? block[index + 1]! * 256 : 0);
          field = word.toString(format === "d" ? 10 : format === "o" ? 8 : 16).padStart(format === "d" ? 5 : format === "o" ? 6 : 4, "0");
        }
      }
      result += field.padStart(width, " ") + (index + stride < 16 ? " " : "");
    }
    return result + "\n";
  }
  for (let index = 0; index < 16; index += 2) {
    result += index < used ? (block[index]! + (index + 1 < used ? block[index + 1]! * 256 : 0)).toString(16).padStart(4, "0") : "    ";
    if (index !== 14) result += " ";
  }
  return result + "\n";
}
