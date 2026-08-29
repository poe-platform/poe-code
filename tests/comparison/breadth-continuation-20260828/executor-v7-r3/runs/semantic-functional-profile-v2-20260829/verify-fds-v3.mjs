import fs from 'node:fs';
import path from 'node:path';
import { assertHostEnvironment } from './host-environment.mjs';
assertHostEnvironment();
const root = process.argv[2];
const file = path.join(root, 'PREPARE.json');
const info = fs.lstatSync(file);
if (!info.isFile() || info.size > 16384 || (info.mode & 511) !== 0o600) throw Error('FD_RECEIPT_METADATA');
const prepared = JSON.parse(fs.readFileSync(file));
if (!prepared.qualified) throw Error('FD_PREPARATION_NOT_QUALIFIED');
const receipt = { schema: 'PREOPENED_CAPTURE_FDS_V2', pid: process.pid, parentPid: process.ppid, umask: process.umask(), captures: [] };
for (const [index, expected] of prepared.captures.entries()) {
  const descriptor = index + 1;
  const actual = fs.fstatSync(descriptor);
  if (!actual.isFile() || (actual.mode & 511) !== 0o600 || actual.size !== 0 || actual.dev !== expected.device || actual.ino !== expected.inode) throw Error('FD_CAPTURE_IDENTITY');
  receipt.captures.push({ descriptor, mode: actual.mode & 511, inode: actual.ino, device: actual.dev, bytes: actual.size });
}
fs.writeFileSync(path.join(root, 'FD-GUARD.json'), JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });

