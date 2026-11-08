import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.dirname(new URL(import.meta.url).pathname);
const [label, revision, selected] = process.argv.slice(2);
const capture = fs.openSync(path.join(root, `${label}.capture.data`), 'wx', 0o600);
function record(value) { fs.writeSync(capture, `${JSON.stringify(value)}\n`); }
let children = 0;
try {
  record({ phase: 'start', time: new Date().toISOString(), label, revision, selected });
  if (!/^[a-z0-9-]+$/.test(label) || !/^[0-9a-f]{40}$/.test(revision) || !selected.startsWith('tests/compatibility/')) throw new Error('metadata arguments refused');
  const output = path.join(root, label);
  fs.mkdirSync(output);
  function git(args, input) {
    children++;
    record({ phase: 'before-child', children, executable: '/usr/bin/git', args });
    const result = spawnSync('/usr/bin/git', args, { cwd: '/Users/kjopek/Workspace/safe-bash', input, timeout: 30000, maxBuffer: 16 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', HOME: output, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' } });
    fs.writeFileSync(path.join(output, `child-${children}.stderr.data`), result.stderr ?? Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    record({ phase: 'after-child', children, status: result.status, signal: result.signal, error: result.error?.message, stdoutBytes: result.stdout?.length, stderrBytes: result.stderr?.length });
    if (result.error || result.status !== 0 || result.signal) throw new Error('metadata child refused; retained raw status');
    return result.stdout;
  }
  const listing = git(['ls-tree', '-r', '-z', revision, '--', selected]);
  fs.writeFileSync(path.join(output, 'inventory.data'), listing, { mode: 0o600 });
  const rows = listing.toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(row);
    if (!match || match[3].split('/').includes('AGENTS.md')) throw new Error('unadmitted inventory row');
    return { mode: match[1], blob: match[2], path: match[3] };
  });
  if (!rows.length || rows.length > 100) throw new Error('inventory count outside bounds');
  const bodies = git(['cat-file', '--batch'], Buffer.from(rows.map(row => row.blob).join('\n') + '\n'));
  let offset = 0;
  for (const [index, row] of rows.entries()) {
    const end = bodies.indexOf(10, offset);
    const header = bodies.subarray(offset, end).toString('ascii').split(' ');
    const size = Number(header[2]);
    if (header[0] !== row.blob || header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0 || size > 8 * 1024 * 1024) throw new Error('blob header refused');
    const body = bodies.subarray(end + 1, end + 1 + size);
    if (body.length !== size || bodies[end + 1 + size] !== 10) throw new Error('truncated blob');
    const identity = crypto.createHash('sha1').update(`blob ${size}\0`).update(body).digest('hex');
    if (identity !== row.blob) throw new Error('Git blob integrity refused');
    row.bytes = size;
    row.sha256 = crypto.createHash('sha256').update(body).digest('hex');
    row.capture = `${index}.data`;
    fs.writeFileSync(path.join(output, row.capture), body, { flag: 'wx', mode: 0o600 });
    offset = end + 2 + size;
  }
  if (offset !== bodies.length) throw new Error('unconsumed batch bytes');
  fs.writeFileSync(path.join(output, 'MANIFEST.json'), JSON.stringify({ revision, selected, rows }, null, 2) + '\n', { flag: 'wx' });
  record({ phase: 'complete', children, files: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0) });
} catch (error) {
  record({ phase: 'failure', children, message: error.message });
  process.exitCode = 1;
} finally { fs.closeSync(capture); }
