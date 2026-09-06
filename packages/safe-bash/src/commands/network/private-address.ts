function privateIPv4(first: number, second: number): boolean {
  return first === 10 || first === 127 || first === 0 ||
    first === 169 && second === 254 || first === 192 && second === 168 ||
    first === 172 && second >= 16 && second <= 31;
}

export function privateHostname(input: string): boolean {
  const hostname = input.toLowerCase().replace(/\.$/u, "").replace(/^\[|\]$/gu, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1") return true;
  if (hostname.includes(":")) {
    const [prefix, suffix] = hostname.split("::");
    const leading = prefix ? prefix.split(":") : [];
    const trailing = suffix ? suffix.split(":") : [];
    const hextets = new Array<number>(8).fill(0);
    for (let index = 0; index < leading.length; index++) hextets[index] = Number.parseInt(leading[index]!, 16);
    for (let index = 0; index < trailing.length; index++) hextets[8 - trailing.length + index] = Number.parseInt(trailing[index]!, 16);
    if (hextets.every(value => value === 0)) return true;
    const mappedIPv4 = hextets.slice(0, 5).every(value => value === 0) && hextets[5] === 0xffff;
    const translatedIPv4 = hextets.slice(0, 4).every(value => value === 0) && hextets[4] === 0xffff && hextets[5] === 0;
    const nat64IPv4 = hextets[0] === 0x64 && hextets[1] === 0xff9b && hextets.slice(2, 6).every(value => value === 0);
    if (mappedIPv4 || translatedIPv4 || nat64IPv4) {
      return privateIPv4(hextets[6]! >>> 8, hextets[6]! & 255);
    }
    return (hextets[0]! & 0xfe00) === 0xfc00 || (hextets[0]! & 0xffc0) === 0xfe80;
  }
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !part || Array.from(part).some(character => character < "0" || character > "9"))) return false;
  const octets = parts.map(Number);
  if (octets.some(value => value < 0 || value > 255)) return false;
  const [first, second] = octets as [number, number, number, number];
  return privateIPv4(first, second);
}
