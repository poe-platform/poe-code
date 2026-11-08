import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import readline from 'node:readline';
const repo = '/Users/kjopek/Workspace/safe-bash';
const author = path.join(repo, 'tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r8');
const output = path.join(repo, 'tests/integration/agent-bash-coherent-b2-independent-review-20260829/r8-binding');
const raw = '/private/tmp/b2-r8-independent-binding-review';
const started = Date.now();
const records = new Map();
let sequence = 0, total = 0, input;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const clock = () => assert(Date.now() < started + 240000, 'binding review deadline');
function write(filename, bytes) {
  assert(total + bytes.length <= 8 * 1024 * 1024); const descriptor = fs.openSync(filename, 'wx', 0o600);
  try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(count > 0); offset += count; } } finally { fs.closeSync(descriptor); }
  total += bytes.length;
}
function say(value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n'); assert(bytes.length < 65536);
  for (const descriptor of [1, 3]) { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(count > 0); offset += count; } }
}
async function identity(filename) {
  clock(); const stat = fs.lstatSync(filename); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 256 * 1024 * 1024);
  const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(filename, { highWaterMark: 65536 })) { clock(); hash.update(chunk); }
  const after = fs.lstatSync(filename); assert.equal(after.ino, stat.ino); assert.equal(after.size, stat.size); assert.equal(after.mtimeMs, stat.mtimeMs);
  return { path: filename, bytes: stat.size, sha256: hash.digest('hex'), mode: stat.mode & 0o7777 };
}
async function read(filename, expected) {
  if (records.has(filename)) return records.get(filename);
  const bound = await identity(filename); assert(bound.bytes <= 1048576);
  if (expected) { assert.equal(bound.bytes, expected.bytes); assert.equal(bound.sha256, expected.sha256); }
  assert(path.basename(filename) !== 'AGENTS.md');
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, bound.bytes); assert.equal(digest(bytes), bound.sha256);
  const row = { bound, bytes }; records.set(filename, row); write(path.join(raw, `input-${++sequence}.txt`), bytes); return row;
}
try {
  fs.mkdirSync(raw);
  say({ startedUTC: new Date(started).toISOString(), pid: process.pid, noChildSpawns: true });
  for (const name of ['BINDING.json', 'GRANT.pending.json', 'HANDOFF.md', 'bind.mjs']) {
    const row = await read(path.join(author, 'final-binding-v2', name), name === 'GRANT.pending.json' ? { bytes: 1081, sha256: '779253fa14627330e812e9522603f8e61895a91155d5e4f9fe943f0823573e80' } : undefined);
    say({ name, ...row.bound, text: row.bytes.toString() });
  }
  input = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const command of input) {
    clock(); assert.equal(command, 'finish');
    const { check } = await import('./checks.mjs');
    const result = await check({ repo, author, output, raw, read, identity, digest, write, clock, started });
    write(path.join(output, 'RESULT.json'), Buffer.from(JSON.stringify(result, null, 2) + '\n')); say(result); input.close(); break;
  }
} catch (error) {
  const result = { status: 'HOLD', errorPresent: true, error: String(error?.stack ?? error), startedUTC: new Date(started).toISOString(), endedUTC: new Date().toISOString(), childSpawns: 0, actualB2: 0 };
  write(path.join(output, 'STOP.json'), Buffer.from(JSON.stringify(result, null, 2) + '\n')); say(result); process.exitCode = 78;
} finally { input?.close(); }
