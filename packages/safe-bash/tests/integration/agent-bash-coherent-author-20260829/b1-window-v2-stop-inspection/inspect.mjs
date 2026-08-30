import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
const repo = '/Users/kjopek/Workspace/safe-bash';
const relative = 'tests/integration/agent-bash-coherent-author-20260829/b1-window-v2-stop-inspection';
const root = path.join(repo, relative);
const raw = '/private/tmp/b1-window-v2-stop-inspection';
const began = Date.now();
const deadline = began + 180000;
const records = [];
const starts = [];
const paths = new Map();
let totalBytes = 0;
let input;
function check() { assert(Date.now() < deadline, 'inspection deadline'); }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function write(filename, bytes) {
  check(); assert(totalBytes + bytes.length <= 8 * 1024 * 1024);
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try { let offset = 0; while (offset < bytes.length) { const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(written > 0); offset += written; } }
  finally { fs.closeSync(descriptor); }
  totalBytes += bytes.length;
}
function say(value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n'); assert(bytes.length < 65536);
  for (const descriptor of [1, 3]) { let offset = 0; while (offset < bytes.length) { const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(written > 0); offset += written; } }
}
function read(filename, expected) {
  check(); assert(records.length < 20);
  const prior = records.find(row => row.path === filename); if (prior) return prior;
  let stat;
  try { stat = fs.lstatSync(filename); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const record = { path: filename, exists: false, semantics: 'ABSENT_NOT_ZERO_OR_CLEANUP_PROOF' }; records.push(record); return record;
  }
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1048576, 'bounded regular evidence');
  if (expected) assert.equal(stat.size, expected.bytes);
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size);
  const digest = hash(bytes); if (expected) assert.equal(digest, expected.sha256);
  const after = fs.lstatSync(filename); assert.equal(after.ino, stat.ino); assert.equal(after.size, stat.size); assert.equal(after.mtimeMs, stat.mtimeMs);
  const name = `raw-${String(records.length).padStart(2, '0')}.txt`;
  write(path.join(raw, name), bytes);
  const record = { path: filename, exists: true, bytes: bytes.length, sha256: digest, mode: stat.mode & 0o7777, copy: name, text: bytes.toString('utf8') };
  records.push(record); return record;
}
function visit(value, key = '') {
  if (typeof value === 'string' && value.startsWith('/private/tmp/')) paths.set(key, value);
  else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${key}[${index}]`));
  else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) visit(item, key ? `${key}.${name}` : name);
}
async function git(role, args) {
  check(); assert(starts.length < 4);
  const child = spawn('/usr/bin/git', args, { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const record = { role, pid: child.pid ?? null, args, startUTC: new Date().toISOString(), exit: null, close: null }; starts.push(record);
  let bytes = 0;
  for (const [stream, descriptor] of [[child.stdout, 1], [child.stderr, 2]]) stream.on('data', chunk => { bytes += chunk.length; assert(bytes <= 65536); fs.writeSync(descriptor, chunk); });
  child.on('exit', (code, signal) => { record.exit = { code, signal }; });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { record.close = { code, signal }; resolve(); }); });
  assert.equal(record.close.code, 0); say(record);
}
try {
  fs.mkdirSync(raw);
  const finalPath = path.join(repo, 'tests/integration/agent-bash-coherent-author-20260829/b1-r6-window-v2/FINAL.json');
  const final = read(finalPath, { bytes: 25661, sha256: '89f3c55c91dc664a94df815ef23d5ddbbe6fb7376a1ef5a8e490255c475dd72b' });
  visit(JSON.parse(final.text));
  say({ status: 'BOUND_FINAL_READ_ONLY', inspectionPID: process.pid, startedUTC: new Date(began).toISOString(), paths: Object.fromEntries(paths) });
  input = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const line of input) {
    check();
    if (line.startsWith('read ')) {
      const key = line.slice(5); assert(paths.has(key)); const record = read(paths.get(key));
      say({ ...record, text: record.text?.slice(0, 16000) });
    } else if (line.startsWith('publish ')) {
      const conclusions = JSON.parse(line.slice(8));
      const body = { schema: 'B1_WINDOW_V2_READ_ONLY_STOP_INSPECTION', inspectionStartedUTC: new Date(began).toISOString(), endedUTC: new Date().toISOString(), originalToolExit: 78,
        conclusions, records, inspectionOwnRolesBeforePublication: starts, inspectionPID: process.pid, inspectionOwnerExit: 'PENDING_EXTERNAL_OBSERVATION', originalLedgerUntouched: true,
        oldReviewHOLDAndRootQualifiedAdjudicationDistinct: true };
      write(path.join(root, 'REPORT.json'), Buffer.from(JSON.stringify(body, null, 2) + '\n'));
      write(path.join(root, 'HANDOFF.md'), Buffer.from(`# B1 fresh-window STOP inspection\n\n${conclusions.summary}\n\nOnly fixed bound paths were read; exact bytes and absences are in REPORT.json. No rerun, signals, publisher or product execution. Original exit78 consumes the attempt. Original journals and modes were not changed. Inspection process roles are separate, not inserted into the actual ledger.\n`));
      await git('inspection-stage', ['add', '--', relative]);
      await git('inspection-commit', ['commit', '--only', '-m', 'docs: inspect consumed B1 fresh-window stop', '--', relative]);
      await git('inspection-receipt', ['rev-parse', 'HEAD']);
      say({ status: 'INSPECTION_PUBLISHED', roles: starts, bytes: totalBytes, ownerExit: 'PENDING_EXTERNAL_OBSERVATION' }); input.close(); break;
    } else throw new Error('unknown inspection command');
  }
} catch (error) { say({ status: 'INSPECTION_STOP', primaryPresent: true, message: String(error?.stack ?? error), records: records.map(({ text, ...row }) => row), starts }); process.exitCode = 78; }
finally { input?.close(); }
