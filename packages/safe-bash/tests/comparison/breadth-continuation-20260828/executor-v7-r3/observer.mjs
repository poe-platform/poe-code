import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { registerHooks, isBuiltin } from 'node:module';
const filename = path.resolve(process.argv[2]);
const directory = path.dirname(filename);
const control = JSON.parse(fs.readFileSync(path.join(directory, 'CONTROL.json')));
const stat = fs.lstatSync.bind(fs), write = fs.writeFileSync.bind(fs), append = fs.appendFileSync.bind(fs);
const open = fs.openSync.bind(fs), close = fs.closeSync.bind(fs), readSync = fs.readSync.bind(fs), fstat = fs.fstatSync.bind(fs);
function read(filename) {
  const descriptor = open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fstat(descriptor);
    if (!info.isFile() || info.size > 262144) throw new Error('OBSERVER_READ_BOUND');
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) { const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset); if (!count) throw new Error('OBSERVER_READ_SHORT'); offset += count; }
    return bytes;
  } finally { close(descriptor); }
}
const rawWrite = fs.writeSync.bind(fs);
const chmod = fs.chmodSync.bind(fs);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = { pid: process.pid, role: 'test-only-observer-not-authority', loaded: [], driftApplied: false, denied: [] };
registerHooks({
  load(url, context, nextLoad) {
    if (isBuiltin(url)) return nextLoad(url, context);
    const absolute = fileURLToPath(url);
    const expected = control.helpers.find(entry => entry.absolute === absolute) ?? control.viewFiles.find(entry => entry.absolute === absolute);
    if (!expected) { receipt.denied.push({ url, code: 'OBSERVER_UNBOUND' }); throw new Error('OBSERVER_UNBOUND'); }
    const info = stat(absolute), bytes = read(absolute);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes || (info.mode & 0o7777) !== expected.mode || hash(bytes) !== expected.sha256) throw new Error('OBSERVER_SOURCE_DRIFT');
    const result = nextLoad(url, context);
    if (result.source == null || hash(Buffer.from(result.source)) !== expected.sha256) throw new Error('OBSERVER_RETURNED_SOURCE');
    receipt.loaded.push({ path: absolute, bytes: expected.bytes, sha256: expected.sha256, actualNextLoad: true });
    return result;
  },
});
fs.writeSync = function (descriptor, data, ...rest) {
  const returned = rawWrite(descriptor, data, ...rest);
  if (descriptor === 3 && control.variant === 'drift' && !receipt.driftApplied) {
    const row = JSON.parse(Buffer.isBuffer(data) ? data.toString() : data);
    if (row.kind === 'bootstrap-authenticated') {
      if (!control.driftPath.startsWith(`${control.viewRoot}/`) || !control.viewFiles.some(entry => entry.absolute === control.driftPath)) throw new Error('OBSERVER_DRIFT_PATH');
      chmod(control.driftPath, 0o644);
      try { append(control.driftPath, '\nexport const drift = true;\n'); }
      finally { chmod(control.driftPath, 0o444); }
      receipt.driftApplied = true;
    }
  }
  return returned;
};
process.once('exit', () => {
  const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`);
  if (bytes.length > 262144) throw new Error('OBSERVER_CAPTURE_CAP');
  write(path.join(directory, 'OBSERVER.json'), bytes, { flag: 'wx', mode: 0o644 });
});
