import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import fixture from './fixtures/sqlite-page-records.json' with { type: 'json' };
import { scanSqliteRecords } from './sqlite-scan.js';

test('table iteration visits native sparse and signed rowids in order', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/db', Buffer.from(fixture.database, 'base64'));
  const file = await fs.openReadFile('/db');
  try {
    const rows: string[] = [];
    for await (const row of scanSqliteRecords(file, fixture.root, new AbortController().signal)) rows.push(String(row.rowid));
    assert.deepEqual(rows, fixture.rows.map(row => row.id).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1));
  } finally { await file.close(); }
});

test('iteration keeps one snapshot revision across rows', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/db', Buffer.from(fixture.database, 'base64'));
  const file = await fs.openReadFile('/db');
  try {
    const rows = scanSqliteRecords(file, fixture.root, new AbortController().signal)[Symbol.asyncIterator]();
    assert.equal((await rows.next()).done, false);
    await fs.appendFile('/db', new Uint8Array([0]));
    await assert.rejects(rows.next(), /changed/);
  } finally { await file.close(); }
});

test('native deleted divider keys do not truncate table iteration', async () => {
  const gaps = (await import('./fixtures/sqlite-scan-gaps.json', { with: { type: 'json' } })).default;
  const fs = new MemoryFileSystem();
  await fs.writeFile('/db', Buffer.from(gaps.database, 'base64'));
  const file = await fs.openReadFile('/db');
  try {
    const rows: string[] = [];
    for await (const row of scanSqliteRecords(file, gaps.root, new AbortController().signal)) rows.push(String(row.rowid));
    assert.deepEqual(rows, gaps.rows);
  } finally { await file.close(); }
});
