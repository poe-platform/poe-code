import { shellValueByteLength, shellValueBytes, shellValueFromBytes } from "../contracts/value.js";
import type { ShellValue, ValueAllocation } from "../contracts/value.js";
import { diagnosticPrintableRanges } from "./diagnostic-name-ranges.js";

const escapes = new Map([
  [7, 97], [8, 98], [9, 116], [10, 110], [11, 118], [12, 102], [13, 114],
  [27, 69], [39, 39], [92, 92],
]);

function printableWidth(bytes: Uint8Array, offset: number, byteLocale: boolean): number {
  const first = bytes[offset]!;
  if (first < 128) return first >= 32 && first <= 126 ? 1 : 0;
  if (byteLocale || first < 0xc2 || first > 0xf4) return 0;
  const width = first <= 0xdf ? 2 : first <= 0xef ? 3 : 4;
  if (offset + width > bytes.length) return 0;
  let scalar = first & (0x7f >> width);
  for (let index = 1; index < width; index++) {
    const continuation = bytes[offset + index]!;
    if (continuation < 0x80 || continuation > 0xbf) return 0;
    scalar = (scalar << 6) | (continuation & 0x3f);
  }
  if ((width === 3 && scalar < 0x800) || (width === 4 && scalar < 0x10000)
    || (scalar >= 0xd800 && scalar <= 0xdfff) || scalar > 0x10ffff) return 0;
  let lower = 0;
  let upper = diagnosticPrintableRanges.length - 1;
  while (lower <= upper) {
    const middle = (lower + upper) >>> 1;
    const [start, end] = diagnosticPrintableRanges[middle]!;
    if (scalar < start) upper = middle - 1;
    else if (scalar > end) lower = middle + 1;
    else return width;
  }
  return 0;
}

export function diagnosticCommandName(value: ShellValue, byteLocale: boolean, allocation: ValueAllocation): ShellValue {
  const maximum = shellValueByteLength(value) * 4 + 3;
  if (!Number.isSafeInteger(maximum)) throw new RangeError("Command diagnostic is too large");
  const bytes = shellValueBytes(value, allocation);
  let quote = false;
  let length = 3;
  for (let index = 0; index < bytes.length;) {
    const width = printableWidth(bytes, index, byteLocale);
    quote ||= width === 0;
    length += escapes.has(bytes[index]!) ? 2 : width || 4;
    index += width || 1;
  }
  if (!quote) return value;
  const reservation = allocation.reserve(length, 1);
  try {
    const result = new Uint8Array(length);
    result[0] = 36;
    result[1] = 39;
    let offset = 2;
    for (let index = 0; index < bytes.length;) {
      const byte = bytes[index]!;
      const width = printableWidth(bytes, index, byteLocale);
      const escaped = escapes.get(byte);
      if (escaped !== undefined) {
        result[offset++] = 92;
        result[offset++] = escaped;
      } else if (width) {
        for (let part = 0; part < width; part++) result[offset++] = bytes[index + part]!;
      }
      else {
        result[offset++] = 92;
        result[offset++] = 48 + (byte >> 6);
        result[offset++] = 48 + ((byte >> 3) & 7);
        result[offset++] = 48 + (byte & 7);
      }
      index += width || 1;
    }
    result[offset] = 39;
    reservation.commit(result);
    return shellValueFromBytes(result, allocation);
  } finally { reservation.release(); }
}
