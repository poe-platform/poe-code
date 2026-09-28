import { FsError } from "safe-bash-contracts";
import type { ColumnBudget } from "./internal.js";

export interface Cell { readonly text: string; readonly width: number }

export function whitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\r" || character === "\v" || character === "\f";
}

export function widthOf(point: number): number {
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

export function cell(text: string, budget: ColumnBudget): Cell | Promise<Cell> {
  let fastAscii = true;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || c >= 0x7f) { fastAscii = false; break; }
  }
  if (fastAscii) {
    if (text.length > 0) {
      const w = budget.work(text.length);
      if (w) {
        return w.then(() => {
          budget.check(text.length, budget.columnLimits.maxWidth, "display width");
          return { text, width: text.length };
        });
      }
      budget.check(text.length, budget.columnLimits.maxWidth, "display width");
    }
    return { text, width: text.length };
  }
  return cellSlow(text, budget);
}

async function cellSlow(text: string, budget: ColumnBudget): Promise<Cell> {
  let width = 0, start = 0, offset = 0;
  const parts: string[] = [];
  for (const character of text) {
    { const s = budget.step(); if (s) await s; }
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

const utf8FatalDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function decode(bytes: Uint8Array): string {
  try { return utf8FatalDecoder.decode(bytes); }
  catch { throw new FsError("EINVAL", { message: "invalid UTF-8 input" }); }
}

export function fields(text: string, separator: Set<string> | undefined, budget: ColumnBudget, remainingCells: number, columnLimit = 0, outputSeparatorBytes?: number): string[] | Promise<string[]> {
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) >= 128) { ascii = false; break; }
  }
  let singleSepCode = -1;
  if (ascii && separator) {
    for (const ch of separator) {
      if (ch.length !== 1 || ch.charCodeAt(0) >= 128) { ascii = false; break; }
      singleSepCode = ch.charCodeAt(0);
    }
    if (separator.size !== 1) singleSepCode = -1;
  }
  if (ascii) {
    const parseAscii = (): string[] => {
      const result: string[] = [];
      let start = 0;
      const append = (end: number): void => {
        if (outputSeparatorBytes !== undefined) budget.project(result.length ? outputSeparatorBytes : 1);
        budget.check(result.length + 1, budget.columnLimits.maxFields, "fields per row");
        budget.check(result.length + 1, remainingCells, "cells");
        budget.retain(end - start);
        result.push(text.slice(start, end));
      };
      for (let offset = 0; offset < text.length; offset++) {
        const code = text.charCodeAt(offset);
        const isWs = code === 32 || (code >= 9 && code <= 13 && code !== 10);
        if (columnLimit && result.length + 1 === columnLimit && (separator || !isWs)) {
          start = offset;
          append(text.length);
          return result;
        }
        const isSep = separator
          ? (singleSepCode >= 0 ? code === singleSepCode : separator.has(text[offset]!))
          : isWs;
        if (isSep) {
          if (separator || offset > start) append(offset);
          start = offset + 1;
        }
      }
      if (separator || text.length > start) append(text.length);
      return result;
    };
    const w = text.length > 0 ? budget.work(text.length) : undefined;
    return w ? w.then(parseAscii) : parseAscii();
  }
  return fieldsSlow(text, separator, budget, remainingCells, columnLimit, outputSeparatorBytes);
}

async function fieldsSlow(text: string, separator: Set<string> | undefined, budget: ColumnBudget, remainingCells: number, columnLimit = 0, outputSeparatorBytes?: number): Promise<string[]> {
  const result: string[] = [];
  let start = 0, offset = 0;
  const append = (end: number): void => {
    if (outputSeparatorBytes !== undefined) budget.project(result.length ? outputSeparatorBytes : 1);
    budget.check(result.length + 1, budget.columnLimits.maxFields, "fields per row");
    budget.check(result.length + 1, remainingCells, "cells");
    budget.retain(end - start);
    result.push(text.slice(start, end));
  };
  for (const character of text) {
    { const s = budget.step(); if (s) await s; }
    if (columnLimit && result.length + 1 === columnLimit && (separator || !whitespace(character))) {
      start = offset;
      append(text.length);
      return result;
    }
    if (separator ? separator.has(character) : whitespace(character)) {
      if (separator || offset > start) append(offset);
      start = offset + character.length;
    }
    offset += character.length;
  }
  if (separator || offset > start) append(offset);
  return result;
}
