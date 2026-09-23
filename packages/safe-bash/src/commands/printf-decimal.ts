// Expand the exact IEEE-754 value before decimal rounding. Using a shortest
// decimal representation first would lose halfway and adjacent-value information.
export function printfDecimal(number: number, specifier: string, precision: number | undefined, alternate: boolean): string {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, Math.abs(number));
  const word = bits.getBigUint64(0);
  const binaryExponent = Number(word >> 52n);
  let coefficient = word & ((1n << 52n) - 1n);
  if (binaryExponent !== 0) coefficient += 1n << 52n;
  const power = (binaryExponent === 0 ? 1 : binaryExponent) - 1023 - 52;
  const scale = Math.max(0, -power);
  coefficient = power < 0 ? coefficient * 5n ** BigInt(scale) : coefficient << BigInt(power);
  const round = (places: number): string => {
    const discarded = scale - places;
    if (discarded <= 0) return (coefficient * 10n ** BigInt(-discarded)).toString();
    const divisor = 10n ** BigInt(discarded);
    let quotient = coefficient / divisor;
    const remainder = coefficient % divisor;
    if (remainder * 2n > divisor || remainder * 2n === divisor && quotient % 2n !== 0n) quotient++;
    return quotient.toString();
  };
  const fixed = (digits: string, places: number): string => {
    if (places === 0) return digits + (alternate ? "." : "");
    const padded = digits.padStart(places + 1, "0");
    return padded.slice(0, -places) + "." + padded.slice(-places);
  };
  const mode = specifier.toLowerCase();
  const requested = mode === "g" ? Math.max(1, precision ?? 6) : precision ?? 6;
  let text: string;
  if (mode === "f") text = fixed(round(requested), requested);
  else {
    let exponent = coefficient === 0n ? 0 : coefficient.toString().length - scale - 1;
    const significant = mode === "e" ? requested + 1 : requested;
    let digits = round(significant - 1 - exponent).padStart(significant, "0");
    if (digits.length > significant) { exponent++; digits = digits.slice(0, significant); }
    if (mode === "e" || exponent < -4 || exponent >= significant) {
      let fraction = digits.slice(1);
      if (mode === "g" && !alternate) while (fraction.endsWith("0")) fraction = fraction.slice(0, -1);
      text = digits[0]! + (fraction || alternate ? "." + fraction : "")
        + "e" + (exponent < 0 ? "-" : "+") + Math.abs(exponent).toString().padStart(2, "0");
    } else {
      const places = significant - 1 - exponent;
      text = fixed(digits, places);
      if (!alternate && text.includes(".")) {
        while (text.endsWith("0")) text = text.slice(0, -1);
        if (text.endsWith(".")) text = text.slice(0, -1);
      }
    }
  }
  return (number < 0 ? "-" : "") + text;
}
