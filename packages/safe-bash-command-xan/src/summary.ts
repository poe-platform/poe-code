import type { ByteSource } from 'safe-bash-contracts/io';
import type { Arguments } from './argv.js';
import { unsigned } from './argv.js';
import { Budget } from './budget.js';
import type { RecordRow } from './csv.js';
import { boundedSort } from './sort.js';
import { cellText, compareBytes, textRow, decimalNumber } from './cells.js';
import type { Writer } from './writer.js';

export async function* summarize(args: Arguments, rows: AsyncGenerator<RecordRow>, first: RecordRow | undefined, selected: number[], budget: Budget, writer: Writer): ByteSource {
  const options = args.options!;
  let held = selected.length * 256;
  budget.hold(held);
  const hold = (size: number): void => { budget.hold(size); held += size; };
  const states = selected.map(() => ({ count: 0, empty: 0, numeric: 0, sum: 0, mean: 0, m2: 0,
    min: Infinity, max: -Infinity, minLength: Infinity, maxLength: 0,
    first: undefined as Uint8Array | undefined, last: undefined as Uint8Array | undefined,
    types: new Set<string>(), frequencies: new Map<string, { bytes: Uint8Array; count: number }>() }));
  try {
    for await (const row of rows) {
      try {
        for (let j = 0; j < selected.length; j++) {
          budget.work();
          const state = states[j]!, bytes = row.cells[selected[j]!]!.decoded.view();
          state.minLength = Math.min(state.minLength, bytes.length); state.maxLength = Math.max(state.maxLength, bytes.length);
          if (args.command === 'freq') {
            if (!bytes.length && options.has('no-extra')) continue;
            hold(bytes.length * 4 + 64);
            let key = '';
            for (let i = 0; i < bytes.length; i++) { budget.work(); key += String.fromCharCode(bytes[i]!); if ((i & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; } }
            const existing = state.frequencies.get(key);
            if (existing) { existing.count++; budget.release(bytes.length * 4 + 64); held -= bytes.length * 4 + 64; }
            else state.frequencies.set(key, { bytes: bytes.slice(), count: 1 });
            continue;
          }
          if (!bytes.length) { state.empty++; state.types.add('empty'); }
          else {
            state.count++;
            if (!state.first || await compareBytes(bytes, state.first, budget) < 0) {
              hold(bytes.length); if (state.first) { held -= state.first.length; budget.release(state.first.length); } state.first = bytes.slice();
            }
            if (!state.last || await compareBytes(bytes, state.last, budget) > 0) {
              hold(bytes.length); if (state.last) { held -= state.last.length; budget.release(state.last.length); } state.last = bytes.slice();
            }
          }
          budget.hold(bytes.length * 4);
          try {
          const text = cellText(bytes, budget), parsed = decimalNumber(text, budget);
          const numeric = parsed !== undefined, value = parsed ?? 0;
          if (numeric) {
            state.types.add(Number.isInteger(value) && !text.includes('.') && !text.toLowerCase().includes('e') ? 'int' : 'float');
            state.sum += value; state.min = Math.min(state.min, value); state.max = Math.max(state.max, value);
          } else if (text) state.types.add('string');
          if (numeric || (!bytes.length && options.has('nulls'))) {
            state.numeric++;
            const delta = value - state.mean; state.mean += delta / state.numeric; state.m2 += delta * (value - state.mean);
          }
          } finally { budget.release(bytes.length * 4); }
        }
      } finally { row.free(); }
    }
    if (args.command === 'freq') {
      yield* textRow(['field', 'value', 'count'], writer, budget);
      const limit = options.has('all') ? 0n : await unsigned(options.get('limit') ?? '10', '--limit', budget);
      for (let j = 0; j < selected.length; j++) {
        const state = states[j]!;
        budget.hold(state.frequencies.size * 32);
        try {
          const entries = [...state.frequencies.values()];
          await boundedSort(entries, 32, budget, async (a, b) => b.count - a.count || await compareBytes(a.bytes, b.bytes, budget));
          const name = args.noHeaders ? String(selected[j]) : first!.cells[selected[j]!]!.decoded.view();
          let remaining = 0;
          for (let i = 0; i < entries.length; i++) {
            budget.work(); const entry = entries[i]!;
            if (limit && BigInt(i) >= limit) { remaining += entry.count; continue; }
            yield* textRow([name, entry.bytes.length ? entry.bytes : '<empty>', String(entry.count)], writer, budget);
          }
          if (remaining && !options.has('no-extra')) yield* textRow([name, '<rest>', String(remaining)], writer, budget);
        } finally { budget.release(state.frequencies.size * 32); }
      }
    } else {
      yield* textRow(['field', 'count', 'count_empty', 'type', 'types', 'sum', 'mean', 'variance', 'stddev', 'min', 'max', 'lex_first', 'lex_last', 'min_length', 'max_length'], writer, budget);
      for (let j = 0; j < selected.length; j++) {
        const state = states[j]!, types = ['string', 'float', 'int', 'empty'].filter(type => state.types.has(type));
        const type = state.types.has('string') ? (state.types.has('int') || state.types.has('float') ? 'mixed' : 'string') : state.types.has('float') ? 'float' : state.types.has('int') ? 'int' : state.types.has('empty') ? 'empty' : '';
        const variance = state.numeric ? Math.max(0, state.m2 / state.numeric) : 0;
        const number = (value: number): string => state.numeric ? String(value) : '';
        yield* textRow([args.noHeaders ? String(selected[j]) : first!.cells[selected[j]!]!.decoded.view(),
          String(state.count), String(state.empty), type, types.join('|'), String(state.sum), number(state.mean), number(variance), number(Math.sqrt(variance)),
          Number.isFinite(state.min) ? String(state.min) : '', Number.isFinite(state.max) ? String(state.max) : '',
          state.first ?? '', state.last ?? '', Number.isFinite(state.minLength) ? String(state.minLength) : '', state.count + state.empty ? String(state.maxLength) : ''], writer, budget);
      }
    }
  } finally { budget.release(held); }
}
