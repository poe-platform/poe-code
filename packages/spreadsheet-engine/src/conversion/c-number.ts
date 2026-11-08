/** C-locale atof prefix parsing. Only finite results can satisfy image bounds. */
export function cNumber(text: string): number {
  let offset = 0;
  while (offset < text.length && " \t\n\r\v\f".includes(text[offset]!)) offset++;
  const start = offset;
  let sign = 1;
  if (text[offset] === "-" || text[offset] === "+") {
    if (text[offset] === "-") sign = -1;
    offset++;
  }
  const digit = (character: string | undefined) => character === undefined ? -1 : "0123456789abcdef".indexOf(character.toLowerCase());
  if (text[offset] === "0" && text[offset + 1]?.toLowerCase() === "x") {
    offset += 2;
    let mantissa = 0n;
    let retained = 0;
    let sticky = false;
    let fraction = false;
    let digits = 0;
    let exponent = 0;
    while (offset < text.length) {
      const value = digit(text[offset]);
      if (value >= 0) {
        if (mantissa !== 0n || value !== 0) {
          // Fifteen hex digits keep at least four rounding bits past binary64.
          if (retained < 15) {
            mantissa = mantissa * 16n + BigInt(value);
            retained++;
          } else {
            exponent += 4;
            sticky ||= value !== 0;
          }
        }
        digits++;
        if (fraction) exponent -= 4;
        offset++;
      } else if (text[offset] === "." && !fraction) {
        fraction = true;
        offset++;
      } else break;
    }
    if (digits) {
      if (text[offset]?.toLowerCase() === "p") {
        const power = Number.parseInt(text.slice(offset + 1), 10);
        // strtod ignores an exponent marker without decimal exponent digits.
        let powerStart = offset + 1;
        if (text[powerStart] === "+" || text[powerStart] === "-") powerStart++;
        const first = digit(text[powerStart]);
        if (first >= 0 && first < 10) exponent += power;
      }
      if (mantissa === 0n) return sign * 0;
      const bits = mantissa.toString(2).length;
      const magnitude = bits - 1 + exponent;
      if (magnitude > 1023) return sign * Infinity;
      if (magnitude < -1075) return sign * 0;
      // Round the integer significand once, including subnormal ties-to-even.
      const shift = Math.max(bits - 53, -1074 - exponent);
      let rounded = mantissa;
      if (shift > 0) {
        const distance = BigInt(shift);
        rounded = mantissa >> distance;
        const remainder = mantissa - (rounded << distance);
        const half = 1n << (distance - 1n);
        if (remainder > half || (remainder === half && (sticky || (rounded & 1n) !== 0n))) rounded++;
      } else if (shift < 0) rounded <<= BigInt(-shift);
      const scale = exponent + shift;
      // Split scaling so a finite normal result never needs an infinite factor.
      return sign * (Number(rounded) * 2 ** Math.min(scale, 0)) * 2 ** Math.max(scale, 0);
    }
    return 0;
  }
  const first = text[offset];
  if (first !== "." && !(first !== undefined && first >= "0" && first <= "9")) return 0;
  return Number.parseFloat(text.slice(start));
}
