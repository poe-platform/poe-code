export class RtfFontSizeError extends RangeError {}

/** Match Number(value.slice(0, -2)) * 2 for the RTF half-point range, without
 * retaining an arbitrarily long attribute. 1100 significant digits plus a sticky
 * digit distinguish every finite binary64 rounding boundary. */
export async function readRtfFontSize(source: Iterable<string> | AsyncIterable<string>): Promise<number> {
  let suffix = "", phase = "start", negative = false, signed = false, leadingZero = false;
  let radix = 0, radixValue = 0, radixDigits = 0, invalid = false;
  let fraction = false, fractionDigits = 0, digits = 0, significant = 0, prefix = "", sticky = false;
  let exponent = 0, exponentNegative = false;
  const digit = (char: string) => {
    digits++; if (fraction) fractionDigits++;
    if (char !== "0" || significant) {significant++; if (prefix.length < 1100) prefix += char; else if (char !== "0") sticky = true;}
  };
  const accept = (char: string) => {
    if (invalid) return;
    if (!char.trim()) {
      if (phase === "start") return;
      if (phase === "int" || phase === "fraction" && digits || phase === "exponentDigits" || phase === "radix" && radixDigits) phase = "trailing";
      else if (phase !== "trailing") invalid = true;
      return;
    }
    if (phase === "trailing") {invalid = true; return;}
    if (phase === "start") {
      if (char === "+" || char === "-") {signed = true; negative = char === "-"; phase = "sign"; return;}
      phase = "sign";
    }
    if (phase === "sign") {
      if (char === ".") {fraction = true; phase = "fraction"; return;}
      if (char >= "0" && char <= "9") {leadingZero = char === "0"; digit(char); phase = "int"; return;}
      invalid = true; return;
    }
    if (phase === "int" && leadingZero && !signed) {
      const selected = ({x: 16, X: 16, o: 8, O: 8, b: 2, B: 2} as Record<string, number>)[char];
      if (selected) {radix = selected; phase = "radix"; return;}
    }
    leadingZero = false;
    if (phase === "radix") {
      const value = char >= "0" && char <= "9" ? char.charCodeAt(0) - 48 : char.toLowerCase() >= "a" && char.toLowerCase() <= "f" ? char.toLowerCase().charCodeAt(0) - 87 : -1;
      if (value < 0 || value >= radix) invalid = true;
      else {radixDigits++; radixValue = Math.min(65536, radixValue * radix + value);}
      return;
    }
    if (phase === "int" || phase === "fraction") {
      if (char >= "0" && char <= "9") {digit(char); return;}
      if (char === "." && phase === "int") {fraction = true; phase = "fraction"; return;}
      if ((char === "e" || char === "E") && digits) {phase = "exponent"; return;}
      invalid = true; return;
    }
    if (phase === "exponent" && (char === "+" || char === "-")) {exponentNegative = char === "-"; phase = "exponentSign"; return;}
    if (char >= "0" && char <= "9") {
      exponent = Math.min(Number.MAX_SAFE_INTEGER, exponent * 10 + char.charCodeAt(0) - 48); phase = "exponentDigits";
    } else invalid = true;
  };
  for await (const chunk of source) {
    const window = suffix + chunk, end = Math.max(0, window.length - 2);
    for (let i = 0; i < end; i++) accept(window[i]!);
    suffix = window.slice(end);
  }
  if (suffix !== "pt") throw new RtfFontSizeError("RTF font-size requires points");
  if (invalid || phase === "sign" || phase === "exponent" || phase === "exponentSign" || !radix && !digits || radix && !radixDigits) throw new RtfFontSizeError("Invalid RTF font-size");
  const significand = prefix + (sticky ? "1" : "");
  const scale = (exponentNegative ? -exponent : exponent) - fractionDigits + significant - significand.length;
  const value = radix ? radixValue : prefix ? Number((negative ? "-" : "") + significand + "e" + scale) : 0;
  const halfPoints = value * 2;
  if (!Number.isSafeInteger(halfPoints) || halfPoints < 1 || halfPoints > 32767) throw new RtfFontSizeError("Invalid RTF font-size");
  return halfPoints;
}
