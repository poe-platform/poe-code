import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const home = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(home, 'raw');
fs.mkdirSync(root, { mode: 0o700 });
const files = Object.fromEntries(['stdout', 'stderr', 'fd3'].map(name => [name, fs.openSync(path.join(root, name + '.raw'), 'wx', 0o600)]));
const receiptFd = fs.openSync(path.join(root, 'RECEIPT.json'), 'wx', 0o600);
const receipt = { pid: null, exit: null, close: null, streams: { stdout: 0, stderr: 0, fd3: 0 }, primary: null, childCount: 0, preflight: false, postflight: false };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let child;
let timeout;
let force;
function validate() {
  const stat = fs.lstatSync(path.join(home, 'PRESEAL.json')); if (!stat.isFile() || stat.size > 262144) throw Error('PRESEAL_ADMISSION');
  const raw = fs.readFileSync(path.join(home, 'PRESEAL.json')); if (hash(raw) !== process.argv[2]) throw Error('PRESEAL_HASH');
  const seal = JSON.parse(raw);
  for (const row of [...seal.inputs, ...seal.own]) {
    const info = fs.lstatSync(row.path); if (!info.isFile() || info.isSymbolicLink() || info.size !== row.bytes || (info.mode & 511) !== row.mode || info.size > 262144 || hash(fs.readFileSync(row.path)) !== row.sha256) throw Error('INPUT_DRIFT:' + row.path);
  }
  return seal;
}
function select(error) { receipt.primary ??= { message: String(error.message ?? error).slice(0, 2000) }; if (child && !receipt.close) child.kill('SIGTERM'); }
try {
  const seal = validate(); receipt.preflight = true;
  child = spawn('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(home, 'dispatch.mjs')], { cwd: home, stdio: ['ignore', 'pipe', 'pipe', 'pipe'], env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: home, TMPDIR: home } });
  receipt.pid = child.pid ?? null; receipt.childCount = 1;
  const closed = new Promise(resolve => { child.once('exit', (code, signal) => { receipt.exit = { code, signal }; }); child.once('close', (code, signal) => { receipt.close = { code, signal }; resolve(); }); });
  child.once('error', select);
  for (const [index, name] of [[1, 'stdout'], [2, 'stderr'], [3, 'fd3']]) {
    child.stdio[index].on('data', bytes => {
      const old = receipt.streams[name]; receipt.streams[name] += bytes.length;
      const cap = 2097152;
      try { if (old < cap) { const kept = bytes.subarray(0, cap - old); let offset = 0; while (offset < kept.length) { const count = fs.writeSync(files[name], kept, offset, kept.length - offset); if (count <= 0) throw Error('CAPTURE_ZERO_WRITE'); offset += count; } } if (receipt.streams[name] > cap) throw Error('REVIEW_CAPTURE_CAP'); } catch (error) { select(error); }
    }); child.stdio[index].once('error', select);
  }
  timeout = setTimeout(() => { select(Error('REVIEW_DEADLINE')); force = setTimeout(() => child.kill('SIGKILL'), 2000); }, seal.deadlineMs);
  await closed; clearTimeout(timeout); clearTimeout(force);
  validate(); receipt.postflight = true;
} catch (error) { select(error); }
finally {
  clearTimeout(timeout); clearTimeout(force);
  for (const descriptor of Object.values(files)) { fs.fsyncSync(descriptor); fs.closeSync(descriptor); }
  fs.writeSync(receiptFd, JSON.stringify(receipt, null, 2) + '\n'); fs.fsyncSync(receiptFd); fs.closeSync(receiptFd);
}
process.stdout.write(JSON.stringify(receipt) + '\n');
process.exitCode = receipt.primary || !receipt.postflight || !receipt.close ? 1 : receipt.close.code;
