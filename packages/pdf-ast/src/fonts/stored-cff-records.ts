import type { FontProgramRange } from "./stored-program.js";

/** INDEX entries stay as views into caller storage, including shifted CFF data. */
export async function readCffIndex(source: FontProgramRange, position: number, entries = source) {
  const count = ((await source.byte(position))! << 8) | (await source.byte(position + 1))!;
  const size = count ? (await source.byte(position + 2))! : 0;
  const table = position + 3,
    base = table + (count + 1) * size - 1;
  async function offset(entry: number) {
    let value = 0;
    for (let i = 0; i < size; i++)
      value = (value << 8) + (await source.byte(table + entry * size + i))!;
    return base + value;
  }
  return {
    count,
    length: count,
    end: count ? await offset(count) : position + 2,
    async get(entry: number): Promise<FontProgramRange | undefined> {
      if (!Number.isInteger(entry) || entry < 0 || entry >= count) return undefined;
      return entries.subarray(await offset(entry), await offset(entry + 1));
    }
  };
}

/** parseFloat's prefix grammar, without retaining an arbitrarily long decimal.
 * Binary64 rounding boundaries terminate within 800 significant decimal digits;
 * a sticky tail preserves the side of a boundary after that exact prefix. */
class Decimal {
  private phase: "start" | "integer" | "fraction" | "exponent" | "exponentDigits" | "done" =
    "start";
  private negative = false;
  private exponentNegative = false;
  private exponent = 0;
  private exponentDigits = 0;
  private digits = 0;
  private significant = 0;
  private fraction = 0;
  private prefix = "";
  private sticky = false;
  constructor(private readonly exponentLimit: number) {}
  accept(char: string): void {
    if (this.phase === "done") return;
    if (this.phase === "start") {
      this.phase = "integer";
      if (char === "-") {
        this.negative = true;
        return;
      }
    }
    if (this.phase === "exponent") {
      this.phase = "exponentDigits";
      if (char === "-") {
        this.exponentNegative = true;
        return;
      }
    }
    const digit = char.charCodeAt(0) - 48;
    if (digit >= 0 && digit <= 9) {
      if (this.phase === "exponentDigits") {
        this.exponentDigits++;
        this.exponent = Math.min(this.exponentLimit, this.exponent * 10 + digit);
      } else {
        this.digits++;
        if (this.phase === "fraction") this.fraction++;
        if (this.significant || digit !== 0) {
          this.significant++;
          if (this.prefix.length < 800) this.prefix += char;
          else if (digit !== 0) this.sticky = true;
        }
      }
    } else if (char === "." && this.phase === "integer") this.phase = "fraction";
    else if (char === "E" && this.digits && (this.phase === "integer" || this.phase === "fraction"))
      this.phase = "exponent";
    else this.phase = "done";
  }
  value(): number {
    if (!this.digits) return NaN;
    if (!this.significant) return this.negative ? -0 : 0;
    const prefix = this.prefix + (this.sticky ? "1" : "");
    const exponent =
      (this.exponentDigits ? this.exponent * (this.exponentNegative ? -1 : 1) : 0) -
      this.fraction +
      this.significant -
      prefix.length;
    return Number(`${this.negative ? "-" : ""}${prefix}e${exponent}`);
  }
}

export async function readCffDictionary(
  source: FontProgramRange,
  selected: ReadonlySet<number>
): Promise<Map<number, { count: number; values: number[] }>> {
  const records = new Map<number, { count: number; values: number[] }>();
  let position = 0,
    count = 0,
    values: number[] = [],
    invalid = false;
  async function real() {
    const decimal = new Decimal(source.length * 2 + 2048);
    let done = false;
    while (position < source.length && !done) {
      const byte = (await source.byte(position++))!;
      for (const nibble of [byte >> 4, byte & 15]) {
        if (nibble === 15) {
          done = true;
          break;
        }
        if (nibble < 10) decimal.accept(String(nibble));
        else if (nibble === 10) decimal.accept(".");
        else if (nibble === 11 || nibble === 12) {
          decimal.accept("E");
          if (nibble === 12) decimal.accept("-");
        } else decimal.accept(nibble === 14 ? "-" : "n");
      }
    }
    return decimal.value();
  }
  while (position < source.length) {
    let byte = (await source.byte(position++))!;
    if (byte <= 21) {
      if (byte === 12) byte = (byte << 8) | (await source.byte(position++))!;
      if (selected.has(byte) && count && !invalid) records.set(byte, { count, values });
      count = 0;
      values = [];
      invalid = false;
      continue;
    }
    let value: number;
    if (byte === 30) value = await real();
    else if (byte === 28 || byte === 29) {
      const size = byte === 28 ? 2 : 4;
      value = await source.parserInt(position, size);
      position += size;
    } else if (byte >= 32 && byte <= 246) value = byte - 139;
    else if (byte >= 247 && byte <= 250)
      value = (byte - 247) * 256 + (await source.byte(position++))! + 108;
    else if (byte >= 251 && byte <= 254)
      value = -(byte - 251) * 256 - (await source.byte(position++))! - 108;
    else value = NaN;
    count++;
    if (Number.isNaN(value)) invalid = true;
    if (values.length < 6) values.push(value);
  }
  return records;
}
