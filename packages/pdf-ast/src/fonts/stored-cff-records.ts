import { FontDecimal } from "./font-decimal.js";
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
    const decimal = new FontDecimal(source.length * 2 + 2048);
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
