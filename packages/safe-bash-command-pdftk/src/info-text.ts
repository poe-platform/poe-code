export function decodePdftkEntities(str: string): string {
  let out = "";
  let i = 0;
  while (i < str.length) {
    if (str[i] === "&" && str[i + 1] === "#") {
      const semi = str.indexOf(";", i + 2);
      if (semi !== -1) {
        const body = str.slice(i + 2, semi);
        const cp =
          body.startsWith("x") || body.startsWith("X")
            ? Number.parseInt(body.slice(1), 16)
            : Number.parseInt(body, 10);
        if (Number.isFinite(cp) && cp >= 0) {
          out += String.fromCodePoint(cp);
          i = semi + 1;
          continue;
        }
      }
    }
    out += str[i]!;
    i++;
  }
  return out;
}


export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const byteVal = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    out[i] = Number.isNaN(byteVal) ? 0 : byteVal;
  }
  return out;
}

