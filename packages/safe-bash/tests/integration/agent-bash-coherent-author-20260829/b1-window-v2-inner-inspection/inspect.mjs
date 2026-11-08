import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
const repo = '/Users/kjopek/Workspace/safe-bash';
const relative = 'tests/integration/agent-bash-coherent-author-20260829/b1-window-v2-inner-inspection';
const home = path.join(repo, relative);
const raw = '/private/tmp/b1-window-v2-inner-inspection';
const started = Date.now(), deadline = started + 180000;
const records = [], references = [], roles = [];
const buffers = new Map();
let total = 0, referencedReads = 0, terminal;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function clock() { assert(Date.now() < deadline, 'inspection inclusive deadline'); }
function write(filename, bytes) {
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(count > 0); offset += count; } }
  finally { fs.closeSync(descriptor); }
}
function say(value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n'); assert(bytes.length < 65536);
  for (const descriptor of [1, 3]) { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(count > 0); offset += count; } }
}
async function admit(filename, expected) {
  clock(); const prior = records.find(row => row.path === filename); if (prior) return prior;
  let stat;
  try { stat = fs.lstatSync(filename); } catch (error) { if (error?.code !== 'ENOENT') throw error; const row = { path: filename, exists: false }; records.push(row); return row; }
  assert(stat.isFile() && !stat.isSymbolicLink(), 'regular nonsymlink evidence only');
  if (expected) assert.equal(stat.size, expected.bytes);
  assert(stat.size <= 16 * 1024 * 1024, 'stream-hash ceiling');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename, { highWaterMark: 65536 })) { clock(); hash.update(chunk); }
  const sha256 = hash.digest('hex'); if (expected) assert.equal(sha256, expected.sha256);
  const row = { path: filename, exists: true, bytes: stat.size, sha256, mode: stat.mode & 0o7777, inode: stat.ino, mtimeMs: stat.mtimeMs };
  records.push(row);
  if (stat.size > 1048576) { row.disposition = 'STAT_HASH_ONLY_OVER_ONE_MIB'; return row; }
  assert(total + stat.size <= 8 * 1024 * 1024, 'aggregate read cap');
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size); assert.equal(digest(bytes), sha256);
  const after = fs.lstatSync(filename); assert.equal(after.ino, stat.ino); assert.equal(after.size, stat.size); assert.equal(after.mtimeMs, stat.mtimeMs);
  row.capture = path.join(raw, `raw-${String(records.length).padStart(2, '0')}.txt`);
  write(row.capture, bytes); total += bytes.length; buffers.set(filename, bytes); return row;
}
let roots;
function summarize(value, prefix = '', found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => summarize(item, `${prefix}[${index}]`, found)); return found;
  }
  const scalars = Object.fromEntries(Object.entries(value).filter(([, item]) => item === null || ['string','number','boolean'].includes(typeof item)));
  if (Object.keys(scalars).length && found.length < 120) found.push({ at: prefix, ...scalars });
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && path.isAbsolute(item) && roots.some(root => item.startsWith(root + '/')) && /(?:\.json|\.jsonl|\.stdout|\.stderr|\.raw)$/.test(item)) {
      if (!references.some(row => row.path === item)) references.push({ origin: `${prefix}.${key}`, path: item });
    } else if (item && typeof item === 'object') summarize(item, prefix ? `${prefix}.${key}` : key, found);
  }
  return found;
}
function display(filename) {
  const bytes = buffers.get(filename); if (!bytes) return;
  try {
    const parsed = JSON.parse(bytes.toString('utf8')); const summary = summarize(parsed);
    say({ path: filename, keys: Object.keys(parsed), summary, references });
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    say({ path: filename, text: bytes.toString('utf8').slice(0, 18000) });
  }
}
async function git(role, args) {
  clock(); assert(roles.length < 3);
  const child = spawn('/usr/bin/git', args, { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore','pipe','pipe'] });
  const row = { role, pid: child.pid ?? null, startUTC: new Date().toISOString(), exit: null, close: null }; roles.push(row);
  let count = 0, stdout = '';
  for (const [stream, descriptor] of [[child.stdout, 1], [child.stderr, 2]]) stream.on('data', bytes => { count += bytes.length; assert(count < 65536); fs.writeSync(descriptor, bytes); if (descriptor === 1) stdout += bytes.toString(); });
  child.on('exit', (code, signal) => { row.exit = { code, signal }; });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { row.close = { code, signal }; resolve(); }); });
  assert.equal(row.close.code, 0); say(row); return stdout;
}
try {
  fs.mkdirSync(raw);
  const finalPath = path.join(repo, 'tests/integration/agent-bash-coherent-author-20260829/b1-r6-window-v2/FINAL.json');
  await admit(finalPath, { bytes: 25661, sha256: '89f3c55c91dc664a94df815ef23d5ddbbe6fb7376a1ef5a8e490255c475dd72b' });
  const packet = JSON.parse(buffers.get(finalPath)); roots = [packet.captureRoot, packet.runtimeRoot];
  for (const filename of [path.join(packet.captureRoot, 'publication-preimport.stdout'), path.join(packet.captureRoot, 'publication-preimport.stderr'), path.join(packet.runtimeRoot, 'RESULT.json')]) {
    say(await admit(filename)); display(filename);
  }
  terminal = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const line of terminal) {
    clock();
    if (line.startsWith('read ')) {
      const index = Number(line.slice(5)); assert(Number.isSafeInteger(index) && references[index]); assert(++referencedReads <= 8);
      const filename = references[index].path; say(await admit(filename)); display(filename);
    } else if (line.startsWith('finish ')) {
      const conclusion = JSON.parse(line.slice(7));
      const report = { startedUTC: new Date(started).toISOString(), endedUTC: new Date().toISOString(), conclusion, records,
        totalReadBytes: total, referencedReads, originalLedgerUntouched: true, inspectionPID: process.pid, inspectionExit: 'PENDING_TOOL_OBSERVATION' };
      write(path.join(home, 'REPORT.json'), Buffer.from(JSON.stringify(report, null, 2) + '\n'));
      write(path.join(home, 'HANDOFF.md'), Buffer.from(`# B1 inner STOP read-only inspection\n\n${conclusion.summary}\n\nSee REPORT.json for exact pre-parse hashes, retained raw capture paths, and qualifications. No runtime or publisher replay, signals, source edits, or Workers. Original seven-start ledger is unchanged.\n`));
      await git('inspection-add', ['add', '--', relative]);
      await git('inspection-commit', ['commit', '--only', '-m', 'docs: identify B1 inner preimport refusal and runtime results', '--', relative]);
      const commit = (await git('inspection-receipt', ['rev-parse','HEAD'])).trim();
      say({ status: 'INSPECTION_PUBLISHED', commit, roles, totalReadBytes: total, ownerExit: 'PENDING_EXTERNAL_OBSERVATION' }); terminal.close(); break;
    } else throw new Error('unknown inspection command');
  }
} catch (error) { say({ status: 'INSPECTION_STOP', reasonPresent: true, message: String(error?.stack ?? error), records, roles }); process.exitCode = 78; }
finally { terminal?.close(); }
