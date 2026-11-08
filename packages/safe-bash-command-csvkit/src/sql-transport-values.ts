import type { CsvWriteCell } from './csv.js';
import type { SqlValue } from './contracts.js';
import { CsvkitBlocked } from './errors.js';

/** Keep arbitrary precision numeric text; the injected driver binds it as numeric. */
export function nativeValue(value: CsvWriteCell): SqlValue {
  if (value === null || typeof value !== 'object') return value;
  if (value.kind === 'decimal' || value.kind === 'date' || value.kind === 'datetime') return value.value;
  if (value.kind === 'float') return Number(value.value);
  if (value.kind === 'timedelta') throw new CsvkitBlocked('network interval driver conversion profile');
  throw new CsvkitBlocked('network scalar driver conversion profile');
}
export function numericBooleanValue(value: CsvWriteCell): SqlValue {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value && typeof value === 'object' && value.kind === 'timedelta') {
    const micros = value.microseconds;
    const millis = micros / 1000n - (micros % 1000n < 0n ? 1n : 0n);
    const date = new Date(Number(millis));
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) throw new CsvkitBlocked('network emulated interval bind range');
    return date.toISOString().slice(0, 19).replace('T', ' ') + '.' + String((micros % 1000000n + 1000000n) % 1000000n).padStart(6, '0');
  }
  return nativeValue(value);
}

export function postgresqlValue(value: CsvWriteCell): SqlValue {
  if (value && typeof value === 'object' && value.kind === 'timedelta') return `${value.microseconds} microseconds`;
  return nativeValue(value);
}

export function oracleValue(value: CsvWriteCell): SqlValue {
  if (value && typeof value === 'object' && ['date', 'datetime', 'timedelta'].includes(value.kind)) return Object.freeze({ ...value });
  return numericBooleanValue(value);
}

/** Native codecs receive scalar identities before driver conversion loses precision. */
export function nativeScalarValue(value: CsvWriteCell, convert: (value: CsvWriteCell) => SqlValue): SqlValue {
  if (value && typeof value === 'object' && ['date', 'datetime', 'decimal', 'float'].includes(value.kind)) return Object.freeze({ ...value });
  return convert(value);
}
