import type { Format } from "./options.js";

export function formatBlock(block: Uint8Array, used: number, address: number, format: Format): string {
  const canonical = format === "C";
  let result = address.toString(16).padStart(canonical ? 8 : 7, "0") + (canonical ? "  " : " ");
  if (canonical) {
    for (let index = 0; index < 16; index++) {
      if (index === 8) result += " ";
      result += index < used ? block[index]!.toString(16).padStart(2, "0") : "  ";
      if (index !== 15) result += " ";
    }
    result += "  |";
    for (let index = 0; index < used; index++) {
      const byte = block[index]!;
      result += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".";
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
          field = word.toString(format === "d" ? 10 : 16).padStart(format === "d" ? 5 : 4, "0");
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
