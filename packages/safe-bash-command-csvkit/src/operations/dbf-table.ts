import type { Runtime } from '../runtime.js';
import { castValue, CastError, columnTypeOrder, type ColumnType, type TableValue } from '../table/types.js';
import { Decimal } from '../types/decimal.js';
import { CsvkitBlocked } from '../errors.js';
import type { DbfValue } from './dbf-fields.js';

/** Agate tests native DBF values, before string parsing; float is never Boolean. */
export function dbfTable(runtime: Runtime, headers: readonly string[], rows: readonly (readonly DbfValue[])[]) {
  const options = {
    now: runtime.context.clock.now(), timezone: runtime.context.locale.timezone,
    maxDecimalDigits: runtime.context.limits.maxDecimalDigits, maxDecimalExponent: runtime.context.limits.maxDecimalExponent
  };
  const cast = (type: ColumnType, value: DbfValue): TableValue | undefined => {
    runtime.step();
    if (value === null) return null;
    if (typeof value === 'string') {
      try { return castValue(type, value, options, runtime.step); }
      catch (failure) { if (!(failure instanceof CastError)) throw failure; return undefined; }
    }
    if (typeof value === 'boolean') {
      if (type === 'Boolean') return value;
      if (type === 'Number') return { kind: 'decimal', value: value ? '1' : '0' };
      if (type === 'Text') return value ? 'True' : 'False';
      return undefined;
    }
    if (type === 'Text') return value.value;
    if (value.kind === 'date') {
      if (type === 'Date') return { kind: 'date', value: value.value };
      if (type === 'DateTime') return { kind: 'datetime', value: value.value + ' 00:00:00' };
      return undefined;
    }
    if (value.kind === 'datetime') return type === 'DateTime' ? { kind: 'datetime', value: value.value } : undefined;
    if (value.kind === 'bytes') return undefined;
    if (type === 'Number') return { kind: 'decimal', value: Decimal.parse(value.value).toString() };
    if (type === 'Boolean' && value.kind !== 'float') {
      const decimal = Decimal.parse(value.value);
      if (decimal.coefficient === 0n) return false;
      if (!decimal.negative && decimal.exponent <= 0 && decimal.coefficient === 10n ** BigInt(-decimal.exponent)) return true;
    }
    return undefined;
  };
  const columns = headers.map((name, index) => {
    const type = columnTypeOrder({}).find(candidate => rows.every(row => cast(candidate, row[index] ?? null) !== undefined));
    if (!type) throw new CsvkitBlocked('no compatible Agate DBF column type');
    return { name, type };
  });
  return { headers, columns, rows: rows.map(row => columns.map((column, index) => cast(column.type, row[index] ?? null)!)) };
}
