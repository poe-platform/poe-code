import { FsError } from "../../contracts/index.js";
import type { ColumnBudget } from "./internal.js";

export interface Cell { readonly text: string; readonly width: number }

export function whitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\r" || character === "\v" || character === "\f";
}

function widthOf(point: number): number {
  if ((point >= 0x0300 && point <= 0x036f) || (point >= 0x1ab0 && point <= 0x1aff)
    || (point >= 0x1dc0 && point <= 0x1dff) || (point >= 0x20d0 && point <= 0x20ff)
    || (point >= 0xfe00 && point <= 0xfe0f) || (point >= 0xfe20 && point <= 0xfe2f)
    || (point >= 0xe0100 && point <= 0xe01ef)) return 0;
  if ((point >= 0x1100 && point <= 0x115f) || point === 0x2329 || point === 0x232a
    || (point >= 0x2e80 && point <= 0xa4cf) || (point >= 0xac00 && point <= 0xd7a3)
    || (point >= 0xf900 && point <= 0xfaff) || (point >= 0xfe10 && point <= 0xfe19)
    || (point >= 0xfe30 && point <= 0xfe6f) || (point >= 0xff01 && point <= 0xff60)
    || (point >= 0xffe0 && point <= 0xffe6) || (point >= 0x1f300 && point <= 0x1faff)
    || (point >= 0x20000 && point <= 0x3fffd)) return 2;
  return 1;
}

export function validateScalar(character: string, allowTab = false): void {
  const point = character.codePointAt(0)!;
  if ((point < 0x20 && !(allowTab && point === 9)) || (point >= 0x7f && point <= 0x9f)
    || (point >= 0xd800 && point <= 0xdfff) || (point >= 0x200b && point <= 0x200f)
    || (point >= 0x2028 && point <= 0x202e) || (point >= 0x2060 && point <= 0x206f) || point === 0xfeff) {
    throw new FsError("EINVAL", { message: `unsupported control or non-scalar U+${point.toString(16).toUpperCase().padStart(4, "0")}` });
  }
}

export async function cell(text: string, budget: ColumnBudget): Promise<Cell> {
  let width = 0, start = 0, offset = 0;
  const parts: string[] = [];
  for (const character of text) {
    await budget.step();
    validateScalar(character, true);
    const size = character === "\t" ? 8 - width % 8 : widthOf(character.codePointAt(0)!);
    budget.check(size, budget.columnLimits.maxWidth - width, "display width");
    width += size;
    if (character === "\t") {
      parts.push(text.slice(start, offset), " ".repeat(size));
      start = offset + 1;
    }
    offset += character.length;
  }
  return { text: parts.length ? [...parts, text.slice(start)].join("") : text, width };
}

export function decode(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new FsError("EINVAL", { message: "invalid UTF-8 input" }); }
}

export async function fields(text: string, separator: Set<string> | undefined, budget: ColumnBudget, remainingCells: number): Promise<string[]> {
  const result: string[] = [];
  let start = 0, offset = 0;
  const append = (end: number): void => {
    budget.check(result.length + 1, budget.columnLimits.maxFields, "fields per row");
    budget.check(result.length + 1, remainingCells, "cells");
    result.push(text.slice(start, end));
  };
  for (const character of text) {
    await budget.step();
    if (separator ? separator.has(character) : whitespace(character)) {
      if (separator || offset > start) append(offset);
      start = offset + character.length;
    }
    offset += character.length;
  }
  if (separator || offset > start) append(offset);
  return result;
}
