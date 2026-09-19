import type { Runtime } from '../runtime.js';
import { CsvkitDiagnostic } from '../errors.js';
import { integer } from '../cli/parser.js';
import { numericField } from '../csv.js';
import { floatText } from './json-table.js';
import { bytesRepr } from './dbf-files.js';
import type { DbfMemo } from './dbf-memo.js';

export type DbfValue = string | boolean | null | { readonly kind: 'integer' | 'float' | 'currency' | 'date' | 'datetime' | 'bytes'; readonly value: string };

export interface DbfField { readonly name: string; readonly type: string; readonly length: number }
const ascii = (bytes: Uint8Array): string => Array.from(bytes, byte => String.fromCharCode(byte)).join('');
const whitespace = (byte: number): boolean => byte === 32 || byte >= 9 && byte <= 13;

export async function parseDbfField(field: DbfField, data: Uint8Array, version: number, decode: (bytes: Uint8Array) => Promise<string>, memo: ((index: number) => DbfMemo | null) | undefined, runtime: Runtime): Promise<DbfValue> {
  runtime.step(); const type = field.type;
  if (type === 'C' || type === 'V') {
    let end = data.length; while (end && (data[end - 1] === 0 || data[end - 1] === 32)) { runtime.step(); end--; }
    return decode(data.subarray(0, end));
  }
  if (type === 'N' || type === 'F') {
    let begin = 0; let end = data.length;
    while (begin < end && whitespace(data[begin]!)) begin++;
    while (end > begin && whitespace(data[end - 1]!)) end--;
    while (begin < end && data[begin] === 42) begin++;
    while (end > begin && data[end - 1] === 42) end--;
    data = data.subarray(begin, end); const text = ascii(data);
    const int = type === 'N' && [...data].every(byte => byte < 128) ? integer(text, runtime.context.limits.maxDecimalDigits) : undefined;
    if (int !== undefined) return { kind: 'integer', value: String(int) };
    if (type === 'N' ? [...data].every(whitespace) : !data.length) return null;
    try {
      if ([...data].some(byte => byte > 127)) throw new CsvkitDiagnostic('non-ASCII');
      return { kind: 'float', value: floatText(numericField(type === 'N' ? text.replaceAll(',', '.') : text)) };
    } catch (failure) {
      if (!(failure instanceof CsvkitDiagnostic)) throw failure;
      throw new CsvkitDiagnostic(`ValueError: could not convert string to float: ${bytesRepr(type === 'N' ? Uint8Array.from(data, byte => byte === 44 ? 46 : byte) : data)}`);
    }
  }
  if (type === 'L') {
    if (!data.length || 'TtYy'.includes(ascii(data))) return true;
    if ('FfNn'.includes(ascii(data))) return false;
    if ('? '.includes(ascii(data))) return null;
    throw new CsvkitDiagnostic(`ValueError: Illegal value for logical field: ${bytesRepr(data)}`);
  }
  if (type === 'D') {
    const text = ascii(data);
    // Python int(bytes) accepts ASCII whitespace, unlike int(str).
    const component = (begin: number, end: number) => [...data.subarray(begin, end)].every(byte => byte < 128) ? integer(text.slice(begin, end)) : undefined;
    const year = component(0, 4); const month = component(4, 6); const day = component(6, 8);
    const days = typeof year === 'number' && typeof month === 'number' ? [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,31,30,31,30,31,31,30,31,30,31][month - 1] : undefined;
    if (typeof year === 'number' && year >= 1 && year <= 9999 && typeof day === 'number' && day >= 1 && days && day <= days)
      return { kind: 'date', value: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
    if ([...data].every(byte => byte === 32 || byte === 48)) return null;
    throw new CsvkitDiagnostic(`ValueError: invalid date ${bytesRepr(data)}`);
  }
  const binaryLength = (length: number): DataView => {
    if (data.length !== length) throw new CsvkitDiagnostic(`error: unpack requires a buffer of ${length} bytes`);
    return new DataView(data.buffer, data.byteOffset, data.byteLength);
  };
  if (type === 'I' || type === '+') return { kind: 'integer', value: String(binaryLength(4).getInt32(0, true)) };
  if (type === 'O' || type === 'B' && [48,49,50].includes(version)) return { kind: 'float', value: floatText(binaryLength(8).getFloat64(0, true)) };
  if (type === 'Y') {
    const value = binaryLength(8).getBigInt64(0, true); const positive = value < 0n ? -value : value;
    let fraction = String(positive % 10000n).padStart(4, '0');
    while (fraction.endsWith('0')) fraction = fraction.slice(0, -1);
    return { kind: 'currency', value: `${value < 0n ? '-' : ''}${positive / 10000n}${fraction ? '.' + fraction : ''}` };
  }
  if (type === 'T' || type === '@') {
    if ([...data].every(whitespace)) return null;
    const view = binaryLength(8); const day = view.getUint32(0, true); if (!day) return null;
    const ordinal = day - 1721425;
    if (ordinal < 1) throw new CsvkitDiagnostic('ValueError: ordinal must be >= 1');
    if (ordinal > 3652059) throw new CsvkitDiagnostic(`ValueError: year ${new Date((ordinal - 719163) * 86400000).getUTCFullYear()} is out of range`);
    const date = new Date((ordinal - 719163) * 86400000 + view.getUint32(4, true));
    if (date.getUTCFullYear() > 9999) throw new CsvkitDiagnostic('OverflowError: date value out of range');
    const text = date.toISOString().slice(0, 19).replace('T', ' ');
    return { kind: 'datetime', value: text + (date.getUTCMilliseconds() ? '.' + String(date.getUTCMilliseconds()).padStart(3, '0') + '000' : '') };
  }
  if ('MGPB'.includes(type)) {
    const index = data.length === 4 ? new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true) : [...data].every(byte => byte < 128) ? integer(ascii(data)) : undefined;
    let position: number;
    if (index === undefined) {
      if (![...data].every(byte => byte === 32 || byte === 0)) throw new CsvkitDiagnostic(`ValueError: Memo index is not an integer: ${bytesRepr(data)}`);
      position = 0;
    } else position = Number(index);
    const result = memo!(position); if (result === null) return null;
    if (type !== 'M' || result.binary) return { kind: 'bytes', value: bytesRepr(result.bytes) };
    return decode(result.bytes);
  }
  return { kind: 'bytes', value: bytesRepr(data) };
}
