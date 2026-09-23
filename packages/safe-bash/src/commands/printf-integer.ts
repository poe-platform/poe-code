// C-style base-zero conversion with a bounded 64-bit accumulator.
export function printfInteger(token: string, unsigned: boolean): { value: bigint; error?: string } {
  if (token.startsWith("'") || token.startsWith('"')) return { value: BigInt(token.codePointAt(1) ?? 0) };
  let offset = 0;
  while (offset < token.length && " \t\n\r\v\f".includes(token[offset]!)) offset++;
  const negative = token[offset] === "-";
  if (negative || token[offset] === "+") offset++;
  let radix = 10;
  const digit = (character: string | undefined): number => character === undefined ? -1 : "0123456789abcdef".indexOf(character.toLowerCase());
  if (token[offset] === "0") {
    radix = 8;
    if ((token[offset + 1] === "x" || token[offset + 1] === "X") && digit(token[offset + 2]) >= 0) {
      radix = 16;
      offset += 2;
    }
  }
  const start = offset;
  const limit = unsigned ? (1n << 64n) - 1n : negative ? 1n << 63n : (1n << 63n) - 1n;
  let magnitude = 0n;
  let overflow = false;
  for (; offset < token.length; offset++) {
    const next = digit(token[offset]);
    if (next < 0 || next >= radix) break;
    if (!overflow) {
      const candidate = magnitude * BigInt(radix) + BigInt(next);
      overflow = candidate > limit;
      magnitude = overflow ? limit : candidate;
    }
  }
  const value = unsigned ? overflow ? limit : BigInt.asUintN(64, negative ? -magnitude : magnitude) : negative ? -magnitude : magnitude;
  if (overflow) return { value, error: "Numerical result out of range" };
  if (offset === start) return { value, error: "invalid number" };
  if (offset < token.length) return { value, error: "value not completely converted" };
  return { value };
}
