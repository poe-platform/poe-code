import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import readline from 'node:readline';
const repo = '/Users/kjopek/Workspace/safe-bash';
const scope = path.join(repo, 'tests/integration/final-smoke-preparation-20260829');
const raw = '/private/tmp/final-smoke-preparation-20260829';
const started = Date.now(), deadline = started + 480000;
let sequence = 0, total = 0, input;
const cache = new Map();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const clock = () => assert(Date.now() < deadline, 'preparation deadline');
function write(filename, bytes) {
  assert(total + bytes.length <= 16 * 1024 * 1024); const descriptor = fs.openSync(filename, 'wx', 0o600);
  try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(count > 0); offset += count; } } finally { fs.closeSync(descriptor); } total += bytes.length;
}
function read(relative, expected) {
  clock(); assert(!path.isAbsolute(relative) && !relative.split('/').includes('..') && path.basename(relative) !== 'AGENTS.md');
  if (cache.has(relative)) return cache.get(relative);
  const filename = path.join(repo, relative); const stat = fs.lstatSync(filename); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1048576);
  if (expected) assert.equal(stat.size, expected.bytes);
  const bytes = fs.readFileSync(filename), sha256 = hash(bytes); assert.equal(bytes.length, stat.size);
  if (expected) assert.equal(sha256, expected.sha256);
  const after = fs.lstatSync(filename); assert.equal(after.ino, stat.ino); assert.equal(after.mtimeMs, stat.mtimeMs); assert.equal(after.size, stat.size);
  const record = { path: filename, relative, bytes: stat.size, sha256, mode: stat.mode & 0o7777, body: bytes };
  write(path.join(raw, `input-${++sequence}.txt`), bytes); cache.set(relative, record); return record;
}
function say(value) { const bytes = Buffer.from(JSON.stringify(value) + '\n'); assert(bytes.length < 65536); for (const descriptor of [1,3]) { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(count > 0); offset += count; } } }
try {
  fs.mkdirSync(raw); say({ startedUTC: new Date(started).toISOString(), pid: process.pid, childSpawns: 0 });
  input = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const command of input) {
    clock();
    if (command.startsWith('read ')) {
      const [relative, start = '0', length = '5000'] = command.slice(5).split(' '); const record = read(relative);
      say({ ...record, body: undefined, text: record.body.toString().slice(Number(start), Number(start) + Number(length)) });
    } else if (command.startsWith('json ')) {
      const [relative, field] = command.slice(5).split(' '); const record = read(relative); const parsed = JSON.parse(record.body);
      let selected = field ? parsed[field] : parsed;
      if (Array.isArray(selected)) selected = selected.filter(row => ['R16','R17','C01','C02','C07','C12','C13','C14'].includes(row.id));
      say({ ...record, body: undefined, keys: Object.keys(parsed), selected });
    } else if (command === 'finish') {
      const { finish } = await import('./finish.mjs'); say(await finish({ repo, scope, raw, read, write, hash, cache, clock, started })); input.close(); break;
    } else throw new Error('unknown preparation command');
  }
} catch (error) { const result = { status: 'PREPARATION_STOP', errorPresent: true, error: String(error?.stack ?? error), actualProduct: 0, startedUTC: new Date(started).toISOString(), endedUTC: new Date().toISOString() }; write(path.join(scope, 'STOP.json'), Buffer.from(JSON.stringify(result, null, 2) + '\n')); say(result); process.exitCode = 78; }
finally { input?.close(); }
