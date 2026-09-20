/** Numeric shift grammar differs from conservative JSON token admission. */
export function isNumericShift(value: string): boolean {
  const end = value.endsWith("\n") ? value.length - 1 : value.length;
  let index = value[0] === "+" || value[0] === "-" ? 1 : 0;
  const digit = (): boolean => index < end && value.charCodeAt(index) >= 48 && value.charCodeAt(index) <= 57;
  const start = index;
  while (digit()) index++;
  let digits = index - start;
  if (value[index] === "." || value[index] === ",") {
    const start = ++index;
    while (digit()) index++;
    digits += index - start;
  }
  if (!digits) return false;
  if (value[index] === "e" || value[index] === "E") {
    index++;
    if (value[index] === "+" || value[index] === "-") index++;
    const start = index;
    while (digit()) index++;
    if (index === start) return false;
  }
  return index === end;
}
