import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const presealBytes = readFileSync(join(root, 'SOURCE-PRESEAL.json'));
assert.equal(hash(presealBytes), process.argv[2]);
const preseal = JSON.parse(presealBytes);
const codeGuard = () => {
  for (const entry of preseal.entries) {
    const filename = join(root, entry.path);
    const metadata = lstatSync(filename);
    assert(metadata.isFile() && !metadata.isSymbolicLink());
    assert.equal(metadata.mode & 0o7777, entry.mode);
    assert.equal(metadata.size, entry.bytes);
    assert.equal(hash(readFileSync(filename)), entry.sha256);
  }
  assert.equal(realpathSync(process.execPath), preseal.node.path);
  assert.equal(hash(readFileSync(process.execPath)), preseal.node.sha256);
  assert.equal(lstatSync(process.execPath).mode & 0o7777, preseal.node.mode);
  const actual = readdirSync(root).filter(name => name !== 'runs').sort();
  assert.deepEqual(actual, [...preseal.entries.map(entry => entry.path), 'SOURCE-PRESEAL.json'].sort());
};
codeGuard();
const runs = join(root, 'runs');
mkdirSync(runs, { mode: 0o700 });
const output = join(runs, 'stub-v1');
mkdirSync(output, { mode: 0o700 });
const began = process.hrtime.bigint();
const child = spawnSync(process.execPath, [join(root, 'synthetic-driver.mjs'), `${output}/`], { cwd: root, env: { PATH: '/usr/bin:/bin', NODE_OPTIONS: '', NODE_PATH: '' }, timeout: preseal.synthetic.timeoutMs, maxBuffer: preseal.synthetic.streamBufferBytes, killSignal: 'SIGTERM' });
const ended = process.hrtime.bigint();
const stdout = child.stdout ?? Buffer.alloc(0);
const stderr = child.stderr ?? Buffer.alloc(0);
writeFileSync(join(output, 'parent.stdout.bin'), stdout, { flag: 'wx', mode: 0o600 });
writeFileSync(join(output, 'parent.stderr.bin'), stderr, { flag: 'wx', mode: 0o600 });
let integrity = false;
let integrityError = null;
try {
  codeGuard();
  assert.deepEqual(readdirSync(runs), ['stub-v1']);
  const allowed = new Set([...preseal.synthetic.caseIds.map(id => `${id}.json`), 'SUMMARY.json', 'FAILURE.json', 'parent.stdout.bin', 'parent.stderr.bin']);
  let totalBytes = 0;
  for (const name of readdirSync(output)) {
    assert(allowed.has(name));
    const metadata = lstatSync(join(output, name));
    assert(metadata.isFile() && !metadata.isSymbolicLink());
    assert.equal(metadata.mode & 0o7777, 0o600);
    assert(metadata.size <= 1048576);
    totalBytes += metadata.size;
  }
  assert(totalBytes <= preseal.synthetic.outputTreeBytes - 1048576);
  if (child.status === 0) assert.deepEqual(readdirSync(output).sort(), [...preseal.synthetic.caseIds.map(id => `${id}.json`), 'SUMMARY.json', 'parent.stdout.bin', 'parent.stderr.bin'].sort());
  integrity = true;
} catch (reason) { integrityError = { name: reason.name, message: reason.message }; }
const capture = { schema: 1, role: 'SYNTHETIC_COMPONENT_PARENT_ONLY', argv: [process.execPath, join(root, 'synthetic-driver.mjs'), `${output}/`], cwd: root, pid: child.pid ?? null, exitCode: child.status, signal: child.signal, error: child.error ? { name: child.error.name, message: child.error.message, code: child.error.code ?? null } : null, elapsedNs: (ended - began).toString(), synchronousWaitReturned: true, knownReap: child.status !== null || child.signal !== null, stdout: { bytes: stdout.length, sha256: hash(stdout) }, stderr: { bytes: stderr.length, sha256: hash(stderr) }, integrity, integrityError, candidateExecutions: 0, compilerExecutions: 0, childDescendantsDeclared: 0 };
writeFileSync(join(output, 'PARENT-CAPTURE.json'), JSON.stringify(capture, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const failure = child.status !== 0 || child.signal !== null || child.error !== undefined || !capture.knownReap || !integrity;
if (failure) process.exitCode = 1;
else {
  const summary = JSON.parse(readFileSync(join(output, 'SUMMARY.json')));
  assert.equal(summary.status, 'PASS_SYNTHETIC_COMPONENT_ONLY');
  assert.equal(summary.rows.length, 10);
}
process.stdout.write(JSON.stringify({ exitCode: child.status, signal: child.signal, knownReap: capture.knownReap, integrity, status: failure ? 'FAIL' : 'PASS_SYNTHETIC_COMPONENT_ONLY', output }) + '\n');
