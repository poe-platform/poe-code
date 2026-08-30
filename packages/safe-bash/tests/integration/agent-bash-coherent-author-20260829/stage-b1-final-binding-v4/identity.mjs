import path from 'node:path';
export function validateIdentities(records) {
  if (!Array.isArray(records) || records.length > 128) throw Error('Identity list shape');
  const seen = new Set();
  for (let index = 0; index < records.length; index++) {
    const itemDescriptor = Object.getOwnPropertyDescriptor(records, String(index));
    if (!itemDescriptor || !Object.hasOwn(itemDescriptor, 'value')) throw Error('Identity list hole/accessor');
    const record = itemDescriptor.value;
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw Error('Identity record must not be nested');
    const names = Object.keys(record).sort();
    if (names.join(',') !== 'bytes,path,sha256') throw Error('Identity keys');
    const values = {};
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(record, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('Identity data property');
      values[name] = descriptor.value;
    }
    if (typeof values.path !== 'string' || !path.isAbsolute(values.path) || path.normalize(values.path) !== values.path || values.path.includes('\0')) throw Error('Identity absolute path');
    if (!Number.isSafeInteger(values.bytes) || values.bytes < 0 || values.bytes > 8388608) throw Error('Identity byte size');
    if (typeof values.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(values.sha256)) throw Error('Identity SHA256');
    if (seen.has(values.path)) throw Error('Duplicate identity path');
    seen.add(values.path);
  }
  return records;
}
