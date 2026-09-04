import type { ValueAllocation } from "../contracts/value.js";
import { yieldTurn } from "../contracts/yield.js";

export interface StringWork {
  remaining: number;
  signal: AbortSignal;
  exhausted(): never;
  allocation?: ValueAllocation;
  steps?: number;
}

export function stringCheckpoint(work: StringWork, units = 1): Promise<void> | undefined {
  work.signal.throwIfAborted();
  work.remaining -= units;
  if (work.remaining < 0) work.exhausted();
  work.steps = (work.steps ?? 0) + units;
  if (work.steps < 128) return undefined;
  work.steps %= 128;
  return yieldTurn(work.signal);
}

export function nextCodePointOffset(value: string, offset: number): number {
  if (offset >= value.length) return value.length;
  return offset + (value.codePointAt(offset)! > 0xffff ? 2 : 1);
}

export function previousCodePointOffset(value: string, offset: number): number {
  if (offset <= 0) return 0;
  const last = value.charCodeAt(offset - 1);
  const previous = value.charCodeAt(offset - 2);
  return offset - (last >= 0xdc00 && last <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff ? 2 : 1);
}

export async function scanString(value: string, work: StringWork, start = 0, end = value.length, maximum = Infinity): Promise<{ end: number; count: number; bytes: number }> {
  let position = start;
  let count = 0;
  let bytes = 0;
  while (position < end && count < maximum) {
    const pending = stringCheckpoint(work);
    if (pending) await pending;
    work.signal.throwIfAborted();
    const point = position + 1 < end ? value.codePointAt(position)! : value.charCodeAt(position);
    position += point > 0xffff ? 2 : 1;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    count++;
  }
  work.signal.throwIfAborted();
  return { end: position, count, bytes };
}
