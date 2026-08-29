import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const root = resolve(own, '../../..');
const label = process.argv[2];
if (!/^[a-z0-9-]{1,32}$/.test(label ?? '')) throw new Error('label');
const capture = resolve(own, 'captures', label);
mkdirSync(capture, { recursive: true });
const outer = openSync(resolve(capture, 'outer.jsonl'), 'wx');
let sequence = 0;
let total = 0;
const started = Date.now();
const record = value => writeSync(outer, JSON.stringify(value) + '\n');
async function git(args, input) {
  const number = ++sequence;
  if (number > 12) throw new Error('child cap');
  const stdout = openSync(resolve(capture, `${number}.stdout.raw`), 'wx');
  const stderr = openSync(resolve(capture, `${number}.stderr.raw`), 'wx');
  const chunks = [];
  const child = spawn('/usr/bin/git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  record({ event: 'spawn', number, pid: child.pid, args });
  let overflow = false;
  const timer = setTimeout(() => child.kill('SIGTERM'), 15000);
  for (const [stream, descriptor] of [[child.stdout, stdout], [child.stderr, stderr]]) {
    stream.on('data', chunk => {
      total += chunk.length;
      if (total > 12 * 1024 * 1024) { overflow = true; child.kill('SIGTERM'); return; }
      writeSync(descriptor, chunk);
      if (descriptor === stdout) chunks.push(chunk);
    });
  }
  child.stdin.end(input);
  const outcome = await new Promise(resolveOutcome => {
    child.on('error', error => record({ event: 'error', number, message: error.message }));
    child.on('close', (code, signal) => resolveOutcome({ code, signal }));
  });
  clearTimeout(timer);
  closeSync(stdout); closeSync(stderr);
  record({ event: 'close', number, ...outcome, overflow });
  if (overflow || outcome.code !== 0 || outcome.signal) throw new Error('Git metadata refusal');
  return Buffer.concat(chunks);
}
try {
  const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  if (request.mode === 'metadata') {
    for (const ref of request.refs) {
      const full = (await git(['rev-parse', '--verify', ref + '^{commit}'])).toString().trim();
      record({ ref, full });
      const listing = await git(['ls-tree', '-r', '-z', full, ...request.paths]);
      writeFileSync(resolve(capture, `${ref}.paths.json`), JSON.stringify(listing.toString().split('\0').filter(Boolean), null, 2) + '\n', { flag: 'wx' });
    }
  } else if (request.mode === 'blobs') {
    if (request.items.length > 40) throw new Error('file cap');
    for (const item of request.items) {
      if (!/^[a-f0-9]{40}$/.test(item.blob) || /(?:^|\/)AGENTS\.md$/.test(item.path) || !/\.(?:ts|js|mjs|md|json|c|h)$/.test(item.path)) throw new Error('input admission');
    }
    const bytes = await git(['cat-file', '--batch'], request.items.map(item => item.blob).join('\n') + '\n');
    let offset = 0;
    const inventory = [];
    for (let index = 0; index < request.items.length; index++) {
      const item = request.items[index];
      const end = bytes.indexOf(10, offset);
      const header = bytes.subarray(offset, end).toString().split(' ');
      const size = Number(header[2]);
      if (header[0] !== item.blob || header[1] !== 'blob' || !Number.isSafeInteger(size) || size > 1024 * 1024) throw new Error('blob header');
      const content = bytes.subarray(end + 1, end + 1 + size);
      if (content.length !== size || bytes[end + 1 + size] !== 10) throw new Error('blob framing');
      const hash = createHash('sha1').update(`blob ${size}\0`).update(content).digest('hex');
      if (hash !== item.blob) throw new Error('blob hash');
      const filename = `${index}-${item.path.replaceAll('/', '__')}`;
      writeFileSync(resolve(capture, filename), content, { flag: 'wx' });
      inventory.push({ ...item, filename, size, sha256: createHash('sha256').update(content).digest('hex') });
      offset = end + 2 + size;
    }
    if (offset !== bytes.length) throw new Error('trailing bytes');
    writeFileSync(resolve(capture, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx' });
  } else throw new Error('mode');
  record({ complete: true, children: sequence, totalCapturedBytes: total, elapsedMs: Date.now() - started });
} catch (error) {
  record({ complete: false, message: error.message });
  process.exitCode = 1;
} finally { closeSync(outer); }
