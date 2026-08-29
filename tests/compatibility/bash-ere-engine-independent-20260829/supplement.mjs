import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.dirname(new URL(import.meta.url).pathname);
const log = fs.openSync(path.join(root, 'SUPPLEMENT.capture.data'), 'wx', 0o600);
const emit = value => fs.writeSync(log, JSON.stringify(value) + '\n');
const prefix = 'tests/compatibility/bash-ere-engine-author-20260829/';
const commit = '8bd170e5465c1253a52231c9cf08b5afef064d81';
const directory = path.join(root, 'witnesses');
try {
  emit({ phase: 'start', at: new Date().toISOString() });
  fs.mkdirSync(directory);
  const git = (args, input) => {
    emit({ phase: 'enroll', args });
    const result = spawnSync('/usr/bin/git', args, { cwd: '/Users/kjopek/Workspace/safe-bash', env: { PATH: '/usr/bin:/bin', HOME: directory, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' }, input, timeout: 30000, maxBuffer: 24 * 1024 * 1024 });
    emit({ phase: 'retired', status: result.status, signal: result.signal, stderr: result.stderr?.toString() });
    if (result.error || result.status !== 0 || result.signal) throw result.error ?? Error('git refused');
    return result.stdout;
  };
  const inventory = git(['ls-tree', '-r', '-z', commit, '--', prefix]);
  fs.writeFileSync(path.join(directory, 'inventory.data'), inventory, { mode: 0o600, flag: 'wx' });
  const rows = inventory.toString().split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(row);
    if (!match) throw Error('tree role');
    return { mode: match[1], blob: match[2], name: match[3] };
  }).filter(row => !row.name.slice(prefix.length).includes('/') && /\.(json|mjs|mts)$/.test(row.name));
  if (!rows.length || rows.length > 30) throw Error('row cap');
  const batch = git(['cat-file', '--batch'], rows.map(row => row.blob).join('\n') + '\n');
  let cursor = 0;
  for (const row of rows) {
    const newline = batch.indexOf(10, cursor);
    const [blob, type, length] = batch.subarray(cursor, newline).toString().split(' ');
    const size = Number(length);
    if (blob !== row.blob || type !== 'blob' || !Number.isSafeInteger(size) || size < 0 || size > 8 * 1024 * 1024) throw Error('header');
    const bytes = batch.subarray(newline + 1, newline + 1 + size);
    if (bytes.length !== size || batch[newline + 1 + size] !== 10 || crypto.createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex') !== blob) throw Error('blob authentication');
    row.bytes = size;
    row.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    row.capture = path.basename(row.name) + '.data';
    fs.writeFileSync(path.join(directory, row.capture), bytes, { mode: 0o600, flag: 'wx' });
    cursor = newline + size + 2;
  }
  if (cursor !== batch.length) throw Error('trailing batch');
  fs.writeFileSync(path.join(directory, 'MANIFEST.json'), JSON.stringify({ commit, rows }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  emit({ phase: 'complete', rows: rows.length });
  console.log(rows.map(row => ({ name: row.capture, bytes: row.bytes })));
} catch (error) {
  emit({ phase: 'failure', message: String(error) });
  process.exitCode = 1;
} finally { fs.closeSync(log); }
