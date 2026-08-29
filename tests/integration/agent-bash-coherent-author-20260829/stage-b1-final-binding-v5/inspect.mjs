import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const scope = import.meta.dirname;
fs.mkdirSync(`${scope}/capture`);
const startedUTC = new Date().toISOString();
const git = (role, args, input) => {
  const child = spawnSync('/usr/bin/git', args, { input, maxBuffer: 262144, timeout: 15000, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' } });
  for (const channel of ['stdout', 'stderr']) fs.writeFileSync(`${scope}/capture/${role}.${channel}`, child[channel] ?? Buffer.alloc(0), { flag: 'wx' });
  if (child.error || child.signal || child.status !== 0) throw Error(`Git metadata ${role}`);
  return child.stdout;
};
git('status', ['status', '--porcelain=v1', '-z', '--', 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-final-binding-v5']);
git('index', ['diff', '--cached', '--name-only', '-z']);
const commit = 'b4cdef973a996ca00199cab721c3565c5d6ee9ed';
const paths = git('review-paths', ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit]).toString().split('\0').filter(file => /\/(?:REPORT\.md|RECEIPT\.json)$/.test(file));
const specs = paths.map(file => `${commit}:${file}`).join('\n') + '\n';
const meta = git('review-types', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], specs).toString().trim().split('\n');
const records = meta.map((row, index) => { const [blob, type, size] = row.split(' '); if (type !== 'blob' || !/^\d+$/.test(size) || Number(size) > 131072) throw Error('Review type/size'); return { path: paths[index], blob, bytes: Number(size) }; });
const framed = git('review-bodies', ['cat-file', '--batch'], specs);
let offset = 0;
for (const record of records) {
  const newline = framed.indexOf(10, offset);
  if (framed.subarray(offset, newline).toString() !== `${record.blob} blob ${record.bytes}`) throw Error('Review framing');
  const bytes = framed.subarray(newline + 1, newline + 1 + record.bytes);
  record.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (record.path.endsWith('RECEIPT.json') && record.sha256 !== '771a5c71c542701f63456a879c34279a3abecba47141569b07863d689758c69d') throw Error('Review hash');
  if (record.path.endsWith('REPORT.md')) console.log(bytes.toString());
  offset = newline + record.bytes + 2;
}
fs.writeFileSync(`${scope}/INSPECTION.json`, JSON.stringify({ startedUTC, finishedUTC: new Date().toISOString(), commit, records, gitChildren: 5, productCalls: 0 }, null, 2) + '\n', { flag: 'wx' });
