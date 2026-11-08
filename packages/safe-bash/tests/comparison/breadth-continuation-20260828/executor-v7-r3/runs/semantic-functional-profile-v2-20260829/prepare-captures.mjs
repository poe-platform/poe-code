import fs from 'node:fs';
import path from 'node:path';

const [root, fault] = process.argv.slice(2);
const allowed = ['none', 'undefined', 'null', 'false'];
if (!path.isAbsolute(root) || !allowed.includes(fault) || fs.realpathSync(root) !== root) throw Error('PREPARER_BOUNDARY');
const receipt = { schema: 'PRIVATE_CAPTURE_PREPARATION_V2', pid: process.pid, parentPid: process.ppid, umask: process.umask(), primaryPresent: false, primaryType: null, primaryCode: null, captures: [], secondary: [], qualified: false };
const handles = [];
const select = error => {
  if (!receipt.primaryPresent) { receipt.primaryPresent = true; receipt.primaryType = error === null ? 'null' : typeof error; receipt.primaryCode = typeof error?.code === 'string' ? error.code : null; }
  else receipt.secondary.push({ type: error === null ? 'null' : typeof error, code: typeof error?.code === 'string' ? error.code : null });
};
try {
  for (const name of ['stdout.raw', 'stderr.raw']) {
    const descriptor = fs.openSync(path.join(root, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const item = { name, descriptor, synced: false, closed: false };
    handles.push(item);
    const stat = fs.fstatSync(descriptor);
    item.mode = stat.mode & 511;
    item.device = stat.dev;
    item.inode = stat.ino;
    item.bytes = stat.size;
    if (!stat.isFile() || item.mode !== 0o600 || stat.size !== 0) throw Error('PRIVATE_CAPTURE_MODE');
  }
  if (fault === 'undefined') throw undefined;
  if (fault === 'null') throw null;
  if (fault === 'false') throw false;
} catch (error) { select(error); }
finally {
  for (const item of handles) {
    try { fs.fsyncSync(item.descriptor); item.synced = true; } catch (error) { select(error); }
    try { fs.closeSync(item.descriptor); item.closed = true; } catch (error) { select(error); }
    receipt.captures.push(item);
  }
}
receipt.qualified = !receipt.primaryPresent && receipt.captures.length === 2 && receipt.captures.every(row => row.synced && row.closed);
const bytes = Buffer.from(JSON.stringify(receipt) + '\n');
if (bytes.length > 16384) throw Error('PREPARER_RECORD_BOUND');
fs.writeFileSync(path.join(root, 'PREPARE.json'), bytes, { flag: 'wx', mode: 0o600 });
process.exitCode = receipt.qualified ? 0 : 71;

