import { shellValueBytes, shellValueFromBytes, type ByteShellValue, type ShellValue, type ValueAllocation } from "../contracts/value.js";
import type { ParseBudget } from "./parse-budget.js";

export interface OwnedShellSource {
  text: string;
  values: ReadonlyMap<number, ByteShellValue>;
}

export function ownedShellSource(value: ShellValue, budget: ParseBudget, allocation: ValueAllocation): OwnedShellSource {
  const bytes = shellValueBytes(value, allocation);
  allocation.reserve(64 + bytes.length * 2, 0);
  const values = new Map<number, ByteShellValue>();
  let text = "";
  let scanned = 0;
  for (let position = 0; position < bytes.length;) {
    if (scanned++ % 128 === 0) budget.admit();
    const first = bytes[position]!;
    let width = first < 128 ? 1 : first >= 194 && first <= 223 ? 2 : first >= 224 && first <= 239 ? 3 : first >= 240 && first <= 244 ? 4 : 0;
    let point = width === 1 ? first : first & (127 >> width);
    if (position + width > bytes.length) width = 0;
    for (let index = 1; index < width; index++) {
      const next = bytes[position + index]!;
      if (next < 128 || next > 191) { width = 0; break; }
      point = point * 64 + (next & 63);
    }
    if (width > 1 && (point < (width === 2 ? 128 : width === 3 ? 2048 : 65536) || point > 1114111 || point >= 55296 && point <= 57343)) width = 0;
    if (width) text += String.fromCodePoint(point);
    else {
      budget.admit();
      allocation.reserve(64, 1);
      values.set(text.length, shellValueFromBytes(bytes.subarray(position, position + 1), allocation));
      text += "\ufffd";
      width = 1;
    }
    position += width;
  }
  budget.admit(0);
  return { text, values };
}
