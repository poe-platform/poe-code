import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function validateIdentities(records) {
  if (!Array.isArray(records)) throw Error('Identity list must be an array');
  const lengthDescriptor = Object.getOwnPropertyDescriptor(records, 'length');
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > 128) throw Error('Identity list length');
  const length = lengthDescriptor.value;
  const keys = Reflect.ownKeys(records);
  if (keys.length !== length + 1 || keys.some(key => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)))) throw Error('Identity list hidden/symbol keys');
  const result = [];
  const seen = new Set();
  for (let index = 0; index < length; index++) {
    const item = Object.getOwnPropertyDescriptor(records, String(index));
    if (!item || !Object.hasOwn(item, 'value') || item.enumerable !== true) throw Error('Identity list hole/accessor/hidden item');
    const record = item.value;
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw Error('Nested/nonrecord identity');
    const names = Reflect.ownKeys(record);
    if (names.length !== 3 || names.some(name => typeof name !== 'string') || names.slice().sort().join(',') !== 'bytes,path,sha256') throw Error('Identity exact own keys');
    const values = {};
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(record, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw Error('Identity accessor/hidden key');
      values[name] = descriptor.value;
    }
    if (typeof values.path !== 'string' || !path.isAbsolute(values.path) || path.normalize(values.path) !== values.path || values.path.includes('\0')) throw Error('Identity absolute canonical path');
    if (!Number.isSafeInteger(values.bytes) || values.bytes < 0 || values.bytes > 8388608) throw Error('Identity bounded size');
    if (typeof values.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(values.sha256)) throw Error('Identity SHA256');
    if (seen.has(values.path)) throw Error('Identity duplicate path');
    seen.add(values.path);
    result.push({ path: values.path, bytes: values.bytes, sha256: values.sha256 });
  }
  return result;
}
export function combinedIdentities(publisherFiles, preimportFiles) {
  const publisher = validateIdentities(publisherFiles);
  const helpers = validateIdentities(preimportFiles);
  return validateIdentities([...publisher, ...helpers]);
}
export function readIdentity(record, maximum = 8388608) {
  const [entry] = validateIdentities([record]);
  if (entry.bytes > maximum) throw Error('Identity role byte ceiling');
  const stat = fs.lstatSync(entry.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes || fs.realpathSync(entry.path) !== entry.path) throw Error('Identity physical type/size');
  const body = fs.readFileSync(entry.path);
  if (body.length !== entry.bytes || crypto.createHash('sha256').update(body).digest('hex') !== entry.sha256) throw Error('Identity hash');
  return body;
}
