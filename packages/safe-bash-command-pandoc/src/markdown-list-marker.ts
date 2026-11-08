/** Format the bounded numbering styles supported by Pandoc Markdown. */
export function markdownListMarker(number: number, style: string, delimiter: string): string {
  let label = String(number);
  if (Number.isSafeInteger(number) && number > 0) {
    if (style === "LowerAlpha" || style === "UpperAlpha") {
      label = "";
      while (number > 0) {
        number--;
        label = String.fromCharCode(97 + number % 26) + label;
        number = Math.floor(number / 26);
      }
    } else if ((style === "LowerRoman" || style === "UpperRoman") && number < 4000) {
      label = "";
      for (const [value, numeral] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) {
        while (number >= value) {label += numeral; number -= value;}
      }
    }
    if (style === "UpperAlpha" || style === "UpperRoman") label = label.toUpperCase();
  }
  return delimiter === "TwoParens" ? `(${label})` : `${label}${delimiter === "OneParen" ? ")" : "."}`;
}
