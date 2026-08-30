import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import readline from 'node:readline';
import { Owner, identity, writeAll } from '../../agent-bash-coherent-author-20260829/admin-owner-r1/tracked-owner.mjs';
const repo = '/Users/kjopek/Workspace/safe-bash';
const relative = 'tests/integration/agent-bash-coherent-b2-independent-review-20260829/r8-delta-v2';
const root = path.join(repo, relative);
const raw = '/private/tmp/b2-r8-independent-delta-review-v2';
const author = path.join(repo, 'tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r8');
const deadline = Date.parse('2026-08-29T16:47:30.000Z');
const owner = new Owner({ raw, cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: raw, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' }, tools: [], wallMs: Math.max(1, deadline - Date.now()), reserveMs: 60000, cleanupMs: 2000, maxStarts: 13, peak: 3, captureLimit: 8 * 1024 * 1024, metadataLimit: 16 * 1024 * 1024, tailBytes: 262144 });
const cache = new Map();
let sequence = 0;
let input;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const say = value => { const bytes = Buffer.from(JSON.stringify(value) + '\n'); writeAll(fs, 1, bytes, count => owner.charge(count)); writeAll(fs, 3, bytes, () => {}); };
const read = (filename, maximum = 1048576) => {
  if (cache.has(filename)) return cache.get(filename);
  const bound = identity(filename, maximum);
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.length, bound.bytes); assert.equal(digest(bytes), bound.sha256);
  const record = { input: bound, bytes };
  cache.set(filename, record);
  owner.persist(path.join(raw, `input-${String(++sequence).padStart(3, '0')}.json`), { ...bound, text: bytes.toString() });
  return record;
};
const git = async (role, args) => { const result = await owner.run(role, '/usr/bin/git', args, 20000); assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, 0); return fs.readFileSync(result.files[0]); };
try {
  fs.mkdirSync(raw);
  const trusted = read(path.join(repo, 'tests/integration/agent-bash-coherent-author-20260829/b1-r6-window-v2/FINAL.json'));
  assert.equal(trusted.input.bytes, 25661); assert.equal(trusted.input.sha256, '89f3c55c91dc664a94df815ef23d5ddbbe6fb7376a1ef5a8e490255c475dd72b');
  owner.config.tools = JSON.parse(trusted.bytes).tools;
  const packet = read(path.join(author, 'staged/PACKET.json'));
  assert.equal(packet.input.bytes, 6945); assert.equal(packet.input.sha256, '6df866e7990386218848061128777008bfbd6cdd93a7c0f658559fc0d0aa23f9');
  say({ status: 'READ_ONCE_READY', packet: packet.input, snapshot: owner.snapshot() });
  input = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const command of input) {
    owner.check();
    if (command.startsWith('read ')) {
      const [name, from = '0', length = '10000'] = command.slice(5).split(' ');
      assert(!name.includes('..') && !path.isAbsolute(name));
      const record = read(path.join(author, name));
      const offset = Number(from), count = Number(length);
      assert(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(count) && count >= 0 && count <= 16000);
      say({ input: record.input, from: offset, text: record.bytes.toString().slice(offset, offset + count) });
    } else if (command === 'finish') {
      const module = await import('./finish.mjs');
      say(await module.finish({ owner, read, git, say, repo, root, relative, raw, author, digest }));
      input.close(); break;
    } else throw new Error('UNKNOWN_COMMAND');
  }
} catch (error) {
  owner.terminal = true;
  const report = { status: 'REVIEW_STOP', primaryPresent: true, message: error instanceof Error ? error.message : String(error), snapshot: owner.snapshot() };
  try { owner.persist(path.join(raw, 'STOP.json'), report); } catch {}
  say(report); process.exitCode = 78;
} finally { input?.close(); }
