import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const scope = 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-publication-v2';
fs.mkdirSync(`${scope}/capture`);
const startedUTC = new Date().toISOString();
const git = (label, args, input) => {
  const result = spawnSync('/usr/bin/git', args, { input, maxBuffer: 1048576, timeout: 15000 });
  fs.writeFileSync(`${scope}/capture/${label}.stdout`, result.stdout ?? Buffer.alloc(0), { flag: 'wx' });
  fs.writeFileSync(`${scope}/capture/${label}.stderr`, result.stderr ?? Buffer.alloc(0), { flag: 'wx' });
  if (result.error || result.signal || result.status !== 0) throw Error(`Metadata failed ${label}`);
  return result.stdout;
};
git('status', ['status', '--porcelain=v1', '-z', '--', scope]);
git('index', ['diff', '--cached', '--name-only', '-z']);
const commit = 'fdabb9504086a7a4f2b6b99a958035843bbb4f94';
const paths = git('review-paths', ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit]).toString().split('\0').filter(Boolean);
const selected = paths.filter(value => /(?:REPORT\.md|RECEIPT\.json)$/.test(value));
const specs = selected.map(value => `${commit}:${value}`);
const meta = git('review-types', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], specs.join('\n') + '\n').toString().trim().split('\n');
const reviews = [];
for (let index = 0; index < meta.length; index++) {
  const [blob, type, size] = meta[index].split(' ');
  if (type !== 'blob' || !/^\d+$/.test(size) || Number(size) > 131072) throw Error('Review admission');
  reviews.push({ path: selected[index], blob, bytes: Number(size) });
}
const bodies = git('review-bodies', ['cat-file', '--batch'], specs.join('\n') + '\n');
let offset = 0;
for (const review of reviews) {
  const newline = bodies.indexOf(10, offset);
  if (bodies.subarray(offset, newline).toString() !== `${review.blob} blob ${review.bytes}`) throw Error('Review envelope');
  const body = bodies.subarray(newline + 1, newline + 1 + review.bytes);
  review.sha256 = crypto.createHash('sha256').update(body).digest('hex');
  if (review.path.endsWith('RECEIPT.json') && review.sha256 !== '41113e45260e254776bfdf97ff5ed44c5d87f00b53bfb0e6d9698b2eaddf42b8') throw Error('Review receipt mismatch');
  console.log(JSON.stringify(review));
  if (review.path.endsWith('REPORT.md')) console.log(body.toString());
  offset = newline + 2 + review.bytes;
}
fs.writeFileSync(`${scope}/INSPECTION.json`, JSON.stringify({ startedUTC, finishedUTC: new Date().toISOString(), reviews, actual: 0, gitChildren: 5 }, null, 2) + '\n', { flag: 'wx' });
