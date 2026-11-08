import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function independentTree(records) {
  const directories = new Map([['', []]]), seen = new Set();
  for (const record of records) {
    const filename = Buffer.from(record.pathBytes ?? Buffer.from(record.path));
    const key = filename.toString('hex'); assert.ok(!seen.has(key)); seen.add(key);
    let parent = '', start = 0;
    for (let offset = 0; offset < filename.length; offset++) if (filename[offset] === 47) {
      const child = filename.subarray(0, offset).toString('hex');
      if (!directories.has(child)) {
        directories.set(child, []);
        directories.get(parent).push({ name: Buffer.from(filename.subarray(start, offset)), mode: '40000', directory: child });
      }
      parent = child; start = offset + 1;
    }
    directories.get(parent).push({ name: Buffer.from(filename.subarray(start)), mode: record.mode, oid: record.blob });
  }
  const hashes = new Map();
  for (const key of [...directories.keys()].sort((left, right) => right.length - left.length)) {
    const entries = directories.get(key);
    entries.sort((left, right) => {
      let offset = 0;
      while (offset < left.name.length && offset < right.name.length && left.name[offset] === right.name[offset]) offset++;
      const leftByte = offset < left.name.length ? left.name[offset] : left.directory !== undefined ? 47 : 0;
      const rightByte = offset < right.name.length ? right.name[offset] : right.directory !== undefined ? 47 : 0;
      return leftByte - rightByte;
    });
    const parts = [];
    for (const entry of entries) {
      parts.push(Buffer.from(entry.mode), Buffer.from([32]), entry.name, Buffer.from([0]), Buffer.from(entry.oid ?? hashes.get(entry.directory), 'hex'));
    }
    const body = Buffer.concat(parts);
    hashes.set(key, createHash('sha1').update(Buffer.from('tree ' + body.length + '\0')).update(body).digest('hex'));
  }
  return hashes.get('');
}
