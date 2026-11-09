/** FFmpeg stream ordinals use C base-zero integers, including leading-zero octal. */
export function parseStreamOrdinal(value: string): number | undefined {
  const hex = value.startsWith("0x") || value.startsWith("0X");
  const radix = hex ? 16 : value.startsWith("0") ? 8 : 10;
  const digits = hex ? value.slice(2).toLowerCase() : value;
  if (!digits || [...digits].some(c => !"0123456789abcdef".slice(0, radix).includes(c))) return undefined;
  return parseInt(digits, radix);
}
