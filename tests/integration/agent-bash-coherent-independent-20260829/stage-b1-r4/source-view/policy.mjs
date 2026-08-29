export const limits = Object.freeze({ capture: 67108864, work: 805306368, tailCapture: 2097152, tailWork: 8388608 });
export class Ledger {
  constructor(initial = { capture: 0, work: 0 }) {
    this.used = { ...initial };
    this.reserved = { capture: limits.tailCapture, work: limits.tailWork };
    this.tail = false;
    this.check();
  }
  check() {
    for (const key of ['capture', 'work']) if (!Number.isSafeInteger(this.used[key]) || this.used[key] < 0 || this.used[key] + this.reserved[key] > limits[key]) throw Error(`Aggregate ${key} admission`);
  }
  charge(bytes, capture = true) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error('Invalid write admission');
    const next = { capture: this.used.capture + (capture ? bytes : 0), work: this.used.work + bytes };
    for (const key of ['capture', 'work']) if (next[key] + this.reserved[key] > limits[key]) throw Error(`Prewrite ${key} refusal`);
    this.used = next;
  }
  beginTail() { this.tail = true; this.reserved = { capture: 0, work: 0 }; }
  snapshot() { return { used: { ...this.used }, reserved: { ...this.reserved }, tail: this.tail, units: 'logical file/write bytes, not RSS or filesystem blocks' }; }
}
export function completeWrite(write, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = write(bytes, offset, bytes.length - offset);
    if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) throw Error('Short/zero write');
    offset += count;
  }
}
export function fault(value) {
  if (value === undefined) return { type: 'undefined' };
  if (value === null) return { type: 'null', value: null };
  if (typeof value === 'number' && !Number.isFinite(value)) return { type: 'number', value: String(value) };
  if (['string', 'boolean', 'number'].includes(typeof value)) return { type: typeof value, value };
  if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() };
  return { type: value instanceof Error ? 'Error' : typeof value, message: value instanceof Error ? value.message.slice(0, 2048) : 'opaque value; identity not serialized' };
}
export function failures() {
  return { primaryPresent: false, primary: undefined, secondary: [], add(value) { if (!this.primaryPresent) { this.primaryPresent = true; this.primary = fault(value); } else this.secondary.push(fault(value)); } };
}
export function resultProfile(raw, present = true) {
  if (!present) return { kind: 'MISSING', complete: false, reportedRows: null, knownRetirement: 'UNKNOWN' };
  let value;
  try { value = JSON.parse(raw.toString()); } catch (error) { return { kind: 'MALFORMED', complete: false, reportedRows: null, knownRetirement: 'UNKNOWN', parseFailure: fault(error) }; }
  const observed = [];
  if (value && typeof value === 'object' && Array.isArray(value.aggregate)) {
    for (const entry of value.aggregate) {
      if (entry && entry.report && Array.isArray(entry.report.rows)) for (const row of entry.report.rows) observed.push({ layout: entry.layout ?? null, row });
    }
  }
  const layouts = ['source-built', 'installed', 'physically-moved'];
  const ids = ['C10', 'C11', 'C15', 'C16', 'C18'];
  const complete = observed.length === 15 && layouts.every(layout => JSON.stringify(observed.filter(row => row.layout === layout).map(row => row.row?.id).sort()) === JSON.stringify(ids));
  return { kind: complete ? 'COMPLETE_REPORTED_MATRIX' : 'PARTIAL_OR_SCHEMA_UNKNOWN', complete, reportedRows: Array.isArray(value?.aggregate) ? observed : null, reportedStatus: Object.hasOwn(value ?? {}, 'status') ? value.status : null, knownRetirement: 'UNKNOWN_UNLESS_RAW_OWNER_RECORD_ESTABLISHES_IT', rawResult: value };
}
export function relativeName(value) {
  if (typeof value !== 'string' || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === 'agents.md')) throw Error('Path admission');
  return value;
}
export function inventoryEqual(before, after) { if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Changed/added/missing owned entry'); }
export function deadline(auth, now) {
  const start = Date.parse(auth.startedUTC);
  const expires = Date.parse(auth.expiresUTC);
  const latest = Date.parse(auth.latestStartUTC);
  if (!Number.isFinite(start) || !Number.isFinite(expires) || !Number.isFinite(latest) || start > latest || expires - latest < 1800000 || now < start || now >= Math.min(start + 1800000, expires)) throw Error('Fresh inclusive window required');
  return Math.min(start + 1800000, expires);
}
