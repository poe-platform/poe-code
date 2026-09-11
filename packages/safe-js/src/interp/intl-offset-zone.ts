// ECMA-402 CreateDateTimeFormat accepts only minute-precision UTCOffset
// identifiers. Named zones are deliberately left to the host's IANA data.
export function canonicalizeIntlOffsetZone(input: string): string | undefined {
  if (input[0] !== "+" && input[0] !== "-" && input[0] !== "−") return undefined;
  if (input[0] === "−" || ![3, 5, 6].includes(input.length) || input.length === 6 && input[3] !== ":")
    throw new RangeError("Invalid time zone offset.");
  const hours = input.slice(1, 3);
  const minutes = input.length === 3 ? "00" : input.slice(-2);
  for (const digit of hours + minutes) {
    if (digit < "0" || digit > "9") throw new RangeError("Invalid time zone offset.");
  }
  if (Number(hours) > 23 || Number(minutes) > 59) throw new RangeError("Invalid time zone offset.");
  const sign = hours === "00" && minutes === "00" ? "+" : input[0];
  return `${sign}${hours}:${minutes}`;
}
