import { createHash } from 'node:crypto';

export function requireFact(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code, unsafe: true });
}

export function ownRecord(value, fields, code = 'OWN_RECORD') {
  requireFact(value !== null && typeof value === 'object' && !Array.isArray(value), code);
  const names = Reflect.ownKeys(value);
  requireFact(names.length === fields.length && names.every(name => typeof name === 'string' && fields.includes(name)), `${code}_KEYS`);
  const result = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    requireFact(descriptor && Object.hasOwn(descriptor, 'value') && !Object.hasOwn(descriptor, 'get') && !Object.hasOwn(descriptor, 'set'), `${code}_DATA`);
    Object.defineProperty(result, name, { value: descriptor.value, enumerable: true });
  }
  return result;
}

export function projectData(value) {
  let nodes = 0;
  const ancestors = new Set();
  const visit = (entry, depth) => {
    requireFact(++nodes <= 200000 && depth <= 64, 'DATA_BOUND');
    if (entry === null || typeof entry === 'boolean') return entry;
    if (typeof entry === 'string') { requireFact(entry.length <= 262144, 'DATA_STRING_BOUND'); return entry; }
    if (typeof entry === 'number') { requireFact(Number.isFinite(entry), 'DATA_FINITE'); return entry; }
    requireFact(typeof entry === 'object' && !ancestors.has(entry), 'DATA_TYPE_OR_CYCLE');
    ancestors.add(entry);
    let result;
    if (Array.isArray(entry)) {
      const length = Object.getOwnPropertyDescriptor(entry, 'length');
      requireFact(length && Object.hasOwn(length, 'value') && Number.isSafeInteger(length.value) && length.value <= 200000, 'DATA_ARRAY_LENGTH');
      const names = Reflect.ownKeys(entry);
      requireFact(names.length === length.value + 1 && names.every(name => typeof name === 'string'), 'DATA_ARRAY_KEYS');
      result = [];
      for (let index = 0; index < length.value; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
        requireFact(descriptor && Object.hasOwn(descriptor, 'value') && !Object.hasOwn(descriptor, 'get') && !Object.hasOwn(descriptor, 'set'), 'DATA_ARRAY_HOLE_OR_ACCESSOR');
        result.push(visit(descriptor.value, depth + 1));
      }
    } else {
      result = Object.create(null);
      for (const name of Reflect.ownKeys(entry)) {
        requireFact(typeof name === 'string', 'DATA_SYMBOL');
        const descriptor = Object.getOwnPropertyDescriptor(entry, name);
        requireFact(descriptor && Object.hasOwn(descriptor, 'value') && !Object.hasOwn(descriptor, 'get') && !Object.hasOwn(descriptor, 'set'), 'DATA_ACCESSOR');
        Object.defineProperty(result, name, { value: visit(descriptor.value, depth + 1), enumerable: true });
      }
    }
    ancestors.delete(entry);
    return Object.freeze(result);
  };
  return visit(value, 0);
}

function encode(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
  return `{${Object.keys(value).sort().map(name => `${JSON.stringify(name)}:${encode(value[name])}`).join(',')}}`;
}

export function canonicalData(value) { return encode(projectData(value)); }
export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function dataHash(value) { return sha256(canonicalData(value)); }
export function safePath(value) {
  requireFact(typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..'), 'SOURCE_PATH');
  return value;
}
