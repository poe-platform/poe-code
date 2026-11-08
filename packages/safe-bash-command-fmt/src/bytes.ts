import { FmtError } from './contracts.js';

const prototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const tag = Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)!.get!;
const length = Object.getOwnPropertyDescriptor(prototype, 'byteLength')!.get!;
const buffer = Object.getOwnPropertyDescriptor(prototype, 'buffer')!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(prototype, 'byteOffset')!.get!;
const values = Uint8Array.prototype.values;
/** Intrinsic inspection admits cross-realm byte views without trusting overrides. */
export function byteView(input: Uint8Array): { length: number; values: IterableIterator<number> } {
  try {
    if (tag.call(input) !== 'Uint8Array') throw new Error();
    return { length: length.call(input) as number, values: values.call(input) };
  } catch { throw new FmtError('INPUT', 'Input must be an available Uint8Array byte view'); }
}
export function ownedBytes(input: Uint8Array, maximum: number): Uint8Array {
  const view = byteView(input);
  if (view.length > maximum) throw new FmtError('LIMIT', 'Argument byte limit exceeded');
  const result = new Uint8Array(view.length);
  let offset = 0;
  for (const byte of view.values) result[offset++] = byte;
  return result;
}
/** Borrow only until the source advances; never dispatch producer methods/species. */
export function byteSpan(input: Uint8Array, offset: number, count: number): Uint8Array {
  return new Uint8Array(buffer.call(input) as ArrayBuffer, (byteOffset.call(input) as number) + offset, count);
}
