import { Diff3Error } from './contracts.js';
const typedArray = Object.getPrototypeOf(Uint8Array.prototype) as object;
const kind = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag)!.get!;
const extent = Object.getOwnPropertyDescriptor(typedArray, 'byteLength')!.get!;
const buffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer')!.get!;
const offset = Object.getOwnPropertyDescriptor(typedArray, 'byteOffset')!.get!;
/** Rehome a borrowed byte view without producer getters, iteration or species. */
export function byteView(value: Uint8Array): Uint8Array {
  if (kind.call(value) !== 'Uint8Array') throw new Diff3Error('STATE', 'Input must be byte storage');
  try { return new Uint8Array(buffer.call(value) as ArrayBuffer, offset.call(value) as number, extent.call(value) as number); }
  catch { throw new Diff3Error('STATE', 'Input byte storage is unavailable'); }
}
