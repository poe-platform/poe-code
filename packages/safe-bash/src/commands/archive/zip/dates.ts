import { ZipFailure } from "./options.js";

function integer(input: string, start: number, width: number): { value: number; end: number } | undefined {
  let offset = start;
  while (" \t\r\n\v\f".includes(input[offset] ?? "\0")) offset++;
  const end = offset + width;
  let sign = 1;
  if (input[offset] === "+" || input[offset] === "-") { sign = input[offset] === "-" ? -1 : 1; offset++; }
  let digits = 0;
  let value = 0;
  while (offset < end && input[offset] !== undefined && input[offset]! >= "0" && input[offset]! <= "9") {
    value = value * 10 + Number(input[offset++]);
    digits++;
  }
  return digits ? { value: value * sign, end: offset } : undefined;
}

function fields(input: string, iso: boolean): readonly [number, number, number] | undefined {
  const first = integer(input, 0, iso ? 4 : 2);
  if (!first || iso && input[first.end] !== "-") return;
  const second = integer(input, first.end + (iso ? 1 : 0), 2);
  if (!second || iso && input[second.end] !== "-") return;
  const third = integer(input, second.end + (iso ? 1 : 0), iso ? 2 : 4);
  if (!third) return;
  return iso ? [first.value, second.value, third.value] : [third.value, first.value, second.value];
}

export function parseZipDate(input: string, option: "t" | "tt"): number {
  const result = fields(input, true) ?? fields(input, false);
  if (!result || result[1] < 1 || result[1] > 12 || result[2] < 1 || result[2] > 31) {
    throw new ZipFailure(16, "Invalid command arguments", `invalid date entered for -${option} option - use mmddyyyy or yyyy-mm-dd`);
  }
  const [year, month, day] = result;
  return year < 1980 ? 2162688 : (year - 1980) * 33554432 + month * 2097152 + day * 65536;
}

export function zipDateMatches(modified: Date, from: number | undefined, until: number | undefined): boolean {
  if (from === undefined && until === undefined) return true;
  const rounded = new Date(Math.ceil(Math.floor(modified.getTime() / 1000) / 2) * 2000);
  const key = rounded.getFullYear() < 1980 ? 2162688 : (rounded.getFullYear() - 1980) * 33554432
    + (rounded.getMonth() + 1) * 2097152 + rounded.getDate() * 65536
    + rounded.getHours() * 2048 + rounded.getMinutes() * 32 + rounded.getSeconds() / 2;
  return (from === undefined || key >= from) && (until === undefined || key < until);
}
