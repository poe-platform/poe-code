import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const prior = path.resolve(here, '../preparation-v5');
export const rawRoot = path.join(prior, 'RUN-ARRAY-S06-20260828-02');
export const release = path.join(prior, 'release-ARRAY-S06-20260828-02');
export const archiveHash = '3dbb6dc3708156e0c895b04aacf78f508322b6b08336acff78a6aa53cd707a0c';
export const indexHash = 'f7976df7cef3c0e747f0e998f1ee2b6dbaac7f2342f954fb6ab21f7364a8485e';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function regular(filename, expected) {
  assert.equal(fs.realpathSync(filename), filename);
  assert.ok(fs.lstatSync(filename).isFile());
  const bytes = fs.readFileSync(filename);
  if (expected !== undefined) assert.equal(digest(bytes), expected);
  return bytes;
}
export async function archiveData(selected = [], compareRaw = false, checkpoint = () => {}) {
  const index = JSON.parse(regular(path.join(release, 'CAPTURE-INDEX.json'), indexHash));
  const archive = path.join(release, 'RECORDS.jsonl.gz');
  regular(archive, archiveHash);
  assert.equal(index.records.length, 437);
  assert.equal(new Set(selected).size, selected.length);
  assert.ok(selected.every(name => index.records.some(row => row.name === name)));
  if (compareRaw) assert.deepEqual(fs.readdirSync(path.join(rawRoot, 'records')).sort(), index.records.map(row => row.name).sort());
  const rows = [], values = new Map();
  const input = fs.createReadStream(archive).pipe(createGunzip());
  let expanded = 0, total = 0;
  input.on('data', bytes => { expanded += bytes.length; if (expanded > 192 * 1024 * 1024) input.destroy(new Error('archive DATA bound')); });
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      checkpoint(); assert.ok(rows.length < 437 && line.length <= 32 * 1024 * 1024);
      const row = JSON.parse(line), expected = index.records[rows.length];
      assert.match(row.name, /^[A-Za-z0-9_-]+\.json$/u); assert.equal(row.name, expected.name);
      const bytes = Buffer.from(row.base64, 'base64');
      assert.equal(bytes.length, expected.bytes); assert.equal(row.bytes, expected.bytes);
      assert.equal(digest(bytes), expected.sha256); assert.equal(row.sha256, expected.sha256);
      assert.equal(row.mode, 0o644);
      if (compareRaw) {
        const filename = path.join(rawRoot, 'records', row.name);
        assert.deepEqual(regular(filename), bytes); assert.equal(fs.lstatSync(filename).mode & 0o777, row.mode);
      }
      rows.push({ name: row.name, mode: row.mode, bytes: row.bytes, sha256: row.sha256 });
      if (selected.includes(row.name)) values.set(row.name, bytes);
      total += bytes.length;
    }
  } finally { input.destroy(); }
  assert.equal(rows.length, 437); assert.equal(total, 116980358);
  regular(archive, archiveHash); regular(path.join(release, 'CAPTURE-INDEX.json'), indexHash);
  return { rows, values, bytes: total, expanded };
}
