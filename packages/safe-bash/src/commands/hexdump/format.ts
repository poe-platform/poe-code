export function formatBlock(block: Uint8Array, used: number, address: number, canonical: boolean): string {
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
  for (let index = 0; index < 16; index += 2) {
    result += index < used ? (block[index]! + (index + 1 < used ? block[index + 1]! * 256 : 0)).toString(16).padStart(4, "0") : "    ";
    if (index !== 14) result += " ";
  }
  return result + "\n";
}
