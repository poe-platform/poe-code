/** Internal admitted-key sorting stage. CSV parsing/inference is a separate gate. */
export type SortKey = string | { readonly integer: string } | null;
export interface SortRecord { readonly bytes: Uint8Array; readonly keys: readonly SortKey[] }
export interface SortLimits { readonly retainedBytes: number; readonly work: number; readonly records: number; readonly keyBytes: number }
export class CsvSortError extends Error {
  constructor(readonly code: 'QUOTA' | 'KEY' | 'OPTION', message: string) { super(message); this.name = 'CsvSortError'; }
}

/** Iterative stable merge sort: no recursion, spilling, I/O or ambient capabilities.
 * Bytes are already serialized record payloads; this stage never interprets CSV.
 * Limits account payloads, UTF-16 keys, 8-byte type/key slots and two
 * 8-byte index slots per record. This is logical storage accounting, not
 * an assertion about engine-specific object overhead or garbage collection.
 * The caller must account parser, inference, input and output storage separately.
 */
export function sortRecords(rows: readonly SortRecord[], options: { readonly reverse?: boolean }, limits: SortLimits, signal?: AbortSignal): readonly SortRecord[] {
  const { retainedBytes, work, records, keyBytes } = limits;
  for (const limit of [retainedBytes, work, records, keyBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new CsvSortError('OPTION', 'Sort limits must be nonnegative safe integers');
  }
  const reverse = options.reverse ?? false;
  if (typeof reverse !== 'boolean') throw new CsvSortError('OPTION', 'reverse must be Boolean');
  let steps = 0, retained = 0;
  const check = (amount = 1): void => {
    if (signal?.aborted) throw signal.reason;
    if (amount > work - steps) throw new CsvSortError('QUOTA', 'csvsort comparator/algorithm work quota exceeded');
    steps += amount;
  };
  const reserve = (amount: number): void => {
    if (amount > retainedBytes - retained) throw new CsvSortError('QUOTA', 'csvsort in-memory retained byte quota exceeded; spilling is unavailable');
    retained += amount;
  };
  check(0);
  if (rows.length > records) throw new CsvSortError('QUOTA', 'csvsort record quota exceeded');
  const count = rows[0]?.keys.length ?? 0;
  const types: (string | undefined)[] = [];
  const owned: SortRecord[] = [];
  try {
    reserve(rows.length * 16);
    reserve(count * 8);
    for (const row of rows) {
      check();
      if (row.keys.length !== count) throw new CsvSortError('KEY', 'Composite key arity differs between records');
      reserve(count * 8);
      reserve(row.bytes.byteLength);
      check(row.bytes.byteLength);
      const keys: SortKey[] = [];
      for (let i = 0; i < count; i++) {
        check();
        const key = row.keys[i]!;
        if (key === null) { keys.push(null); continue; }
        const type = typeof key === 'string' ? 'text' : 'integer';
        const text = type === 'text' ? key as string : (key as { integer: string }).integer;
        if (typeof text !== 'string') throw new CsvSortError('KEY', 'Unsupported key type');
        if (text.length > Math.floor(keyBytes / 2)) throw new CsvSortError('QUOTA', 'csvsort key byte quota exceeded');
        reserve(text.length * 2);
        check(text.length);
        if (type === 'integer') {
          const start = text[0] === '-' ? 1 : 0;
          if (text.length === start || (text.length > start + 1 && text[start] === '0') || text === '-0') throw new CsvSortError('KEY', 'Integer keys must be canonical');
          for (let j = start; j < text.length; j++) {
            if (text.charCodeAt(j) < 48 || text.charCodeAt(j) > 57) throw new CsvSortError('KEY', 'Integer keys must be canonical');
          }
        }
        if (types[i] !== undefined && types[i] !== type) throw new CsvSortError('KEY', 'Column key types differ');
        types[i] = type;
        keys.push(type === 'text' ? text : { integer: text });
      }
      const bytes = new Uint8Array(row.bytes.byteLength);
      bytes.set(row.bytes);
      owned.push({ bytes, keys });
    }
    const textCompare = (a: string, b: string): number => {
      let i = 0, j = 0;
      while (i < a.length && j < b.length) {
        check();
        const x = a.codePointAt(i)!, y = b.codePointAt(j)!;
        if (x !== y) return x < y ? -1 : 1;
        i += x > 65535 ? 2 : 1; j += y > 65535 ? 2 : 1;
      }
      return i < a.length ? 1 : j < b.length ? -1 : 0;
    };
    const compare = (a: SortRecord, b: SortRecord): number => {
      check();
      for (let i = 0; i < count; i++) {
        check();
        const x = a.keys[i]!, y = b.keys[i]!;
        let order = 0;
        if (x === null || y === null) order = x === y ? 0 : x === null ? 1 : -1;
        else if (typeof x === 'string' && typeof y === 'string') order = textCompare(x, y);
        else {
          const u = (x as { integer: string }).integer, v = (y as { integer: string }).integer;
          const un = u[0] === '-', vn = v[0] === '-';
          if (un !== vn) order = un ? -1 : 1;
          else {
            order = u.length === v.length ? textCompare(u, v) : u.length < v.length ? -1 : 1;
            if (un) order = -order;
          }
        }
        if (order) return reverse ? -order : order;
      }
      return 0;
    };
    let source = owned, target = new Array<SortRecord>(owned.length);
    for (let width = 1; width < source.length; width *= 2) {
      for (let start = 0; start < source.length; start += width * 2) {
        const middle = Math.min(start + width, source.length), end = Math.min(start + width * 2, source.length);
        let left = start, right = middle;
        for (let out = start; out < end; out++) {
          check();
          // Equal keys always take the earlier run, including reverse order.
          target[out] = right === end || (left < middle && compare(source[left]!, source[right]!) <= 0) ? source[left++]! : source[right++]!;
        }
      }
      [source, target] = [target, source];
    }
    check(0);
    return source;
  } catch (error) {
    owned.length = 0;
    throw error;
  }
}
