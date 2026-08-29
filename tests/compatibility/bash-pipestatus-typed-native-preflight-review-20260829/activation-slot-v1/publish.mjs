import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const root = path.dirname(new URL(import.meta.url).pathname);
const repo = '/Users/kjopek/Workspace/safe-bash';
const deadline = fs.statSync('/tmp/pipestatus-typed-slot-bootstrap-20260829.stdout').birthtimeMs - 10000 + 360000;
const capture = fs.mkdtempSync('/tmp/pipestatus-typed-slot-publication-');
const journal = fs.openSync(capture + '/events.jsonl', 'wx', 0o600);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function event(value) { fs.writeSync(journal, JSON.stringify({at: new Date().toISOString(), ...value}) + '\n'); fs.fsyncSync(journal); }
async function git(label, args) {
  assert(Date.now() < deadline);
  const stdout = fs.openSync(capture + '/' + label + '.stdout', 'wx', 0o600);
  const stderr = fs.openSync(capture + '/' + label + '.stderr', 'wx', 0o600);
  try {
    const child = spawn('/usr/bin/git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.abbrev=40', ...args], {cwd: repo, stdio: ['ignore', stdout, stderr]});
    let exited = false;
    const done = new Promise(resolve => {
      child.on('error', reason => { event({label, error: String(reason)}); });
      child.on('exit', (code, signal) => { exited = true; event({label, event: 'exit', pid: child.pid, code, signal}); });
      child.on('close', (code, signal) => resolve({code, signal}));
    });
    event({label, event: 'start', pid: child.pid, args});
    const timer = setTimeout(() => child.kill('SIGKILL'), Math.min(30000, deadline - Date.now()));
    const result = await done;
    clearTimeout(timer);
    event({label, event: 'close', pid: child.pid, ...result, exited});
    assert(exited && result.code === 0 && result.signal === null);
    fs.fsyncSync(stdout); fs.fsyncSync(stderr);
    return fs.readFileSync(capture + '/' + label + '.stdout', 'utf8');
  } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
}
try {
  event({event: 'owner-start', pid: process.pid});
  assert(Date.now() < deadline);
  const raw = root + '/raw';
  fs.mkdirSync(raw);
  let captureBytes = 0;
  for (const name of fs.readdirSync('/tmp').sort()) {
    if (!name.startsWith('pipestatus-typed-slot-') || !name.endsWith('.stdout') && !name.endsWith('.stderr')) continue;
    if (name.startsWith('pipestatus-typed-slot-publication')) continue;
    const file = '/tmp/' + name, stat = fs.lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size < 1048576);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, stat.size);
    captureBytes += bytes.length;
    assert(captureBytes < 24 * 1048576);
    fs.writeFileSync(raw + '/' + name, bytes, {flag: 'wx', mode: 0o600});
  }
  const rows = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = directory + '/' + name, stat = fs.lstatSync(file);
      assert(!stat.isSymbolicLink());
      if (stat.isDirectory()) walk(file);
      else {
        assert(stat.isFile() && stat.size < 1048576);
        const bytes = fs.readFileSync(file);
        rows.push({path: path.relative(root, file), bytes: bytes.length, sha256: hash(bytes), mode: stat.mode & 0o777});
      }
    }
  }
  walk(root);
  rows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  assert(bytes < 96 * 1048576);
  const accounting = {at: new Date().toISOString(), domain: 'recursive current owned regular files, UTF-8 byte full-path order; excludes this later snapshot and active publication captures/Git storage', rows, bytes, captureBytes, knownBeforePublication: 11, publicationRoles: 'owner plus three sequential Git children; all must actually exit/close before final success', knownFinalOnSuccess: 15, knownPeak: 2, native: 0, Workers: 0, onePUREHelper: true, noTransitiveCensus: true, noFinalOrPeakDiskClaim: true};
  fs.writeFileSync(root + '/ACCOUNTING.json', JSON.stringify(accounting, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  const relative = path.relative(repo, root);
  await git('add', ['add', '--', relative]);
  const committed = await git('commit', ['commit', '--only', '-m', 'Review typed PIPESTATUS six-native activation slot bindings', '--', relative]);
  const status = await git('status', ['status', '--porcelain', '--untracked-files=all', '--', relative]);
  assert.equal(status, '');
  const commit = committed.match(/\[.* ([0-9a-f]{40})\]/)?.[1];
  assert(commit);
  event({event: 'owner-complete', pid: process.pid, commit, knownRoles: 15});
  const output = JSON.stringify({commit, cleanOwned: true, knownRoles: 15, peak: 2, at: new Date().toISOString(), capture, receiptSha256: hash(fs.readFileSync(root + '/RECEIPT.json')), bytes, captureBytes}) + '\n';
  fs.writeSync(1, output); fs.writeSync(3, output);
} catch (reason) { event({event: 'failure', present: true, reason: String(reason), stack: reason?.stack}); console.error(reason); process.exitCode = 1; }
finally { fs.closeSync(journal); }
