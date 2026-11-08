import fs from 'node:fs';
import crypto from 'node:crypto';
import { types } from 'node:util';

export function admitFile(filename, expected, maximum) {
  if (typeof filename !== 'string' || !Number.isSafeInteger(maximum) || maximum < 0) throw new Error('B1 admission arguments');
  if (!expected || typeof expected !== 'object' || types.isProxy(expected)) throw new Error('B1 admission identity');
  const descriptors = Object.getOwnPropertyDescriptors(expected);
  for (const key of ['bytes', 'sha256']) if (!Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value')) throw new Error('B1 admission own-data identity');
  const bytes = descriptors.bytes.value, sha256 = descriptors.sha256.value;
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximum || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('B1 admission identity bounds');
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes) throw new Error('B1 admission type/size');
  const body = fs.readFileSync(filename);
  if (body.length !== bytes || crypto.createHash('sha256').update(body).digest('hex') !== sha256) throw new Error('B1 admission hash');
  return body;
}
