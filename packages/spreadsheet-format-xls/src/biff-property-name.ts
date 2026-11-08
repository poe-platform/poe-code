import { SsconvertError, type CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { singleByteTables } from '@poe-code/spreadsheet-engine/encoding/tables';
import { biffDbcsTables } from '@poe-code/spreadsheet-engine/encoding/biff-dbcs-tables';
import { biffDecode } from './biff-strings.js';
import type { BiffPropertyBytes } from './biff-property-bytes.js';

/** Validate representability before exposing bounded encoded windows. */
export function createBiffPropertyNameEncoder(context: CapabilityContext, charge: (amount: number) => void,
  accountText: (text: string) => string): (name: string, codepage: number) => BiffPropertyBytes | undefined {
  // Reverse the same tables as the importer; no transliteration or escape fallback.
  const encodings = new Map<number, Map<string, number[]>>();
  return (name: string, cp: number): BiffPropertyBytes | undefined => {
    accountText(name);
    if (cp === 65001) {
      let length = 1;
      for (const point of name) { const code = point.codePointAt(0)!; length += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
      return { length, *chunks() {
        const encoder = new TextEncoder(), buffer = new Uint8Array(16384);
        try {
          for (let at = 0; at < name.length;) {
            context.signal.throwIfAborted(); let end = Math.min(name.length, at + 4096);
            if (end < name.length && name.charCodeAt(end - 1) >= 0xd800 && name.charCodeAt(end - 1) <= 0xdbff) end--;
            const result = encoder.encodeInto(name.slice(at, end), buffer); at = end; yield buffer.subarray(0, result.written);
          }
          yield new Uint8Array(1);
        } finally { buffer.fill(0); }
      } };
    }
    if (cp === 1200) {
      const length = (name.length + 1) * 2; charge(length);
      if (length > 0xffffffff || length > context.limits.outputBytes)
        throw new SsconvertError("resource-limit", "ssconvert BIFF property output bytes limit exceeded");
      return { length, *chunks() {
        const buffer = new Uint8Array(16384), view = new DataView(buffer.buffer);
        try {
          for (let at = 0; at < name.length; at += 8192) {
            context.signal.throwIfAborted(); const size = Math.min(8192, name.length - at);
            for (let i = 0; i < size; i++) view.setUint16(i * 2, name.charCodeAt(at + i), true);
            yield buffer.subarray(0, size * 2);
          }
          yield new Uint8Array(2);
        } finally { buffer.fill(0); }
      } };
    }
    let reverse = encodings.get(cp);
    if (!reverse) {
      reverse = new Map(); encodings.set(cp, reverse);
      const dbcs = biffDbcsTables[cp], table = dbcs?.single ?? singleByteTables[cp === 1201 ? "iso-8859-1" : cp === 10000 ? "macintosh" : cp >= 1250 && cp <= 1258 ? `windows-${cp}` : `cp${cp}`];
      if (!table) return undefined;
      for (let i = 0; i < table.length; i++) { charge(1); if (table[i] !== "\uffff" && !reverse.has(table[i]!)) reverse.set(table[i]!, [i]); }
      if (dbcs) for (const [lead, row] of Object.entries(dbcs.double)) for (let trail = 0; trail < row.length; trail++) {
        charge(1); if (row[trail] !== "\uffff" && !reverse.has(row[trail]!)) reverse.set(row[trail]!, [Number(lead), trail]);
      }
    }
    const characters = function* () { yield* name; yield "\0"; };
    let length = 0;
    for (const character of characters()) {
      charge(1); const value = reverse.get(character); if (!value) return undefined;
      if (biffDecode(Uint8Array.from(value), cp) !== character) return undefined;
      length += value.length;
      if (length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert BIFF property output bytes limit exceeded");
    }
    const table = reverse;
    return { length, *chunks() {
      const buffer = new Uint8Array(16384); let at = 0;
      try {
        for (const character of characters()) {
          const value = table.get(character)!;
          if (at + value.length > buffer.length) { context.signal.throwIfAborted(); yield buffer.subarray(0, at); at = 0; }
          buffer.set(value, at); at += value.length;
        }
        if (at) yield buffer.subarray(0, at);
      } finally { buffer.fill(0); }
    } };
  };
}
