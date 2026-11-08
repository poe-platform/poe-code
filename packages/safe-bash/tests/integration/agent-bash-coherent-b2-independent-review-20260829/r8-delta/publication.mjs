import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = '/Users/kjopek/Workspace/safe-bash';
const scope = 'tests/integration/agent-bash-coherent-b2-independent-review-20260829/r8-delta';
const deadline = Date.parse('2026-08-29T16:42:00.000Z');
const startedUTC = new Date().toISOString();
const entries = [
  ['owner.stdout', '/private/tmp/b2-r8-independent-delta-review.stdout'],
  ['owner.stderr', '/private/tmp/b2-r8-independent-delta-review.stderr'],
  ['STOP.json', '/private/tmp/b2-r8-independent-delta-review/STOP.json'],
  ['first-check-read.json', '/private/tmp/b2-r8-independent-delta-review/read-ed8d77d06e7c.json'],
  ['checkpoint.stdout', '/private/tmp/b2-r8-independent-delta-checkpoint.stdout'],
  ['checkpoint.stderr', '/private/tmp/b2-r8-independent-delta-checkpoint.stderr'],
];
const roles = [];
let totalBytes = 0;
function clock() { assert(Date.now() < deadline, 'publication deadline'); }
function exclusive(filename, bytes) {
  clock();
  assert(totalBytes + bytes.length <= 1048576, 'bounded publication bytes');
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
      assert(written > 0, 'publication zero write');
      offset += written;
    }
  } finally { fs.closeSync(descriptor); }
  totalBytes += bytes.length;
}
async function git(role, args) {
  clock();
  const record = { role, args, startUTC: new Date().toISOString(), pid: null, exit: null, close: null };
  roles.push(record);
  const child = spawn('/usr/bin/git', args, {
    cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'inherit', 'inherit'],
  });
  record.pid = child.pid ?? null;
  console.log(JSON.stringify({ event: 'start', ...record }));
  const timer = setTimeout(() => child.kill('SIGTERM'), Math.min(30000, deadline - Date.now()));
  let spawnError;
  child.on('error', error => { spawnError = error; });
  child.on('exit', (code, signal) => { record.exit = { code, signal, utc: new Date().toISOString() }; });
  await new Promise(resolve => child.once('close', (code, signal) => {
    record.close = { code, signal, utc: new Date().toISOString() }; resolve();
  }));
  clearTimeout(timer);
  console.log(JSON.stringify({ event: 'retired', ...record }));
  if (spawnError !== undefined) throw spawnError;
  assert.equal(record.close.code, 0, role);
  clock();
}
try {
  clock();
  const records = [];
  for (const [name, source] of entries) {
    const stat = fs.lstatSync(source);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1048576, 'regular bounded evidence');
    const bytes = fs.readFileSync(source);
    assert.equal(bytes.length, stat.size);
    const after = fs.lstatSync(source);
    assert.equal(after.ino, stat.ino);
    assert.equal(after.size, stat.size);
    assert.equal(after.mtimeMs, stat.mtimeMs);
    exclusive(path.join(root, scope, name), bytes);
    records.push({ name, source, bytes: bytes.length, mode: stat.mode & 0o7777,
      sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const record = { status: 'INDEPENDENT_REVIEW_INCOMPLETE_HOLD', startedUTC,
    publicationPID: process.pid, originalOwnerToolExit: 78,
    independentControlsExecuted: 0, candidateRuntimeExecuted: 0,
    sourceReviewComplete: false, fullTaskProcessCensus: 'NOT_ESTABLISHED',
    copiedBytes: totalBytes, records,
    publicationOwnerState: 'EXIT_PENDING_EXTERNAL_OBSERVATION',
    priorFailurePreserved: true };
  exclusive(path.join(root, scope, 'EVIDENCE.json'), Buffer.from(JSON.stringify(record, null, 2) + '\n'));
  const files = ['review.mjs', 'launch.sh', 'publication.mjs', 'HANDOFF.md', 'EVIDENCE.json', ...entries.map(([name]) => name)].map(name => `${scope}/${name}`);
  await git('stage-explicit-review-evidence', ['add', '--', ...files]);
  await git('commit-explicit-review-evidence', ['commit', '--only', '-m', 'docs: preserve incomplete B2 r8 independent review stop', '--', ...files]);
  await git('final-commit-receipt', ['rev-parse', 'HEAD']);
  console.log(JSON.stringify({ status: 'STOP_EVIDENCE_PUBLISHED', totalBytes, roles, endedUTC: new Date().toISOString(), ownerExit: 'PENDING_TOOL_OBSERVATION' }));
} catch (error) {
  console.error(JSON.stringify({ status: 'PUBLICATION_STOP', primaryPresent: true,
    message: error instanceof Error ? error.message : String(error), roles, totalBytes }));
  process.exitCode = 78;
}
