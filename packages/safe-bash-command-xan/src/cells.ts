import type { ByteSource } from 'safe-bash-contracts/io';
import { Budget, XanError } from './budget.js';
import type { Writer } from './writer.js';

export async function* emitted(bytes: Uint8Array, budget: Budget): ByteSource {
  try { yield bytes; } finally { budget.release(bytes.length); }
}
export async function* textRow(values: readonly (string | Uint8Array)[], writer: Writer, budget: Budget): ByteSource {
  const owned: Uint8Array[] = [];
  budget.hold(values.length * 32);
  try {
    const cells: Uint8Array[] = [];
    for (const value of values) {
      if (typeof value === 'string') { const bytes = await budget.encode(value); owned.push(bytes); cells.push(bytes); }
      else cells.push(value);
    }
    yield* emitted(await writer.values(cells), budget);
  } finally { for (const bytes of owned) budget.release(bytes.length); budget.release(values.length * 32); }
}
export async function compareBytes(left: Uint8Array, right: Uint8Array, budget: Budget): Promise<number> {
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    budget.work();
    if (left[i] !== right[i]) return left[i]! < right[i]! ? -1 : 1;
    if ((i & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; }
  }
  return Math.sign(left.length - right.length);
}
export function cellText(bytes: Uint8Array, budget: Budget): string {
  budget.work(bytes.length);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new XanError('cell is not valid UTF-8'); }
}

/** Decimal CSV numbers, without JavaScript's radix prefixes or whitespace coercion. */
export function decimalNumber(text: string, budget: Budget): number | undefined {
  let offset = text[0] === '+' || text[0] === '-' ? 1 : 0;
  let digits = 0;
  while (offset < text.length && text[offset]! >= '0' && text[offset]! <= '9') { offset++; digits++; budget.work(); }
  if (text[offset] === '.') {
    offset++;
    while (offset < text.length && text[offset]! >= '0' && text[offset]! <= '9') { offset++; digits++; budget.work(); }
  }
  if (!digits) return undefined;
  if (text[offset] === 'e' || text[offset] === 'E') {
    offset++;
    if (text[offset] === '+' || text[offset] === '-') offset++;
    const start = offset;
    while (offset < text.length && text[offset]! >= '0' && text[offset]! <= '9') { offset++; budget.work(); }
    if (offset === start) return undefined;
  }
  if (offset !== text.length) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}
