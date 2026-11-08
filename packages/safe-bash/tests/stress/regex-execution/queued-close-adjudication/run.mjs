import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const owned = 'tests/stress/regex-execution/queued-close-adjudication';
const canonical = 'tests/commands/regex-execution/followup/messageerror.test.ts';
const source = 'src/commands/regex-execution/client.ts';
const protocol = 'src/commands/regex-execution/protocol.ts';
const registration = '01aa1bffe0568cc6787d5ff8e0331e024a787385';
const review = '0b370e33cdb42128c6585cbebd1f6bad02753285';
const contract = '07acb1a4d30b7592cf247a0220250317be4e2038';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function git(...args) {
  const result = spawnSync('/usr/bin/git', args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
const before = git('rev-parse', `${registration}^`).toString().trim();
const head = git('rev-parse', 'HEAD').toString().trim();
const paths = [canonical, source, protocol, 'src/commands/regex-execution/worker.ts',
  'src/contracts/command.ts', 'src/contracts/command.md', 'package.json'];
const profiles = { before, registration, review, contract, current: head };
const inputs = {};
const identities = [];
for (const [label, revision] of Object.entries(profiles)) {
  inputs[label] = {};
  for (const path of paths) {
    const bytes = label === 'current' ? readFileSync(path) : git('show', `${revision}:${path}`);
    inputs[label][path] = bytes;
    identities.push({ label, revision, path, sha256: sha256(bytes), gitBlob: git('rev-parse', `${revision}:${path}`).toString().trim(),
      matchesRevision: bytes.equals(git('show', `${revision}:${path}`)) });
  }
}
const historical = [
  [registration, 'tests/commands/regex-execution/cleanup-registration/REPORT.md'],
  [registration, 'tests/commands/regex-execution/cleanup-registration/isolated-validation.json'],
  [review, 'tests/stress/regex-execution/cleanup-boundary-review/REPORT.md'],
  [review, 'tests/stress/regex-execution/cleanup-boundary-review/evidence/phase-a-compiled-old-five.json'],
  [review, 'tests/stress/regex-execution/cleanup-boundary-review/evidence/phase-a-packed-old-five.json'],
].map(([revision, path]) => ({ revision, path, sha256: sha256(git('show', `${revision}:${path}`)), currentSha256: sha256(readFileSync(path)) }));
const indexBefore = sha256(git('ls-files', '--stage'));
const freeze = { started: new Date().toISOString(), head, before, registration, review, contract,
  node: process.version, platform: process.platform, arch: process.arch,
  tsx: JSON.parse(readFileSync('node_modules/tsx/package.json')).version,
  typescript: JSON.parse(readFileSync('node_modules/typescript/package.json')).version,
  statusBefore: git('status', '--porcelain=v1').toString(), indexBefore, identities, historical,
  harness: ['run.mjs', 'controls.test.ts'].map(name => ({ path: `${owned}/${name}`, sha256: sha256(readFileSync(`${owned}/${name}`)) })) };
mkdirSync(`${owned}/evidence`, { recursive: true });
writeFileSync(`${owned}/evidence/freeze.json`, JSON.stringify(freeze, null, 2) + '\n', { flag: 'wx' });
const temporary = mkdtempSync(resolve(owned, '.run-'));
const results = [];
async function run(label, args) {
  const command = [process.execPath, '--unhandled-rejections=strict', '--max-old-space-size=128', '--import', 'tsx',
    '--test', '--experimental-test-isolation=none', '--test-concurrency=1', '--test-reporter=tap', ...args];
  const result = await new Promise(resolveResult => {
    const child = spawn(command[0], command.slice(1), { stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '--unhandled-rejections=strict' } });
    const state = { label, command, pid: child.pid, started: new Date().toISOString(), stdout: '', stderr: '', events: [], killed: false };
    let bytes = 0;
    const kill = reason => { if (!state.killed) { state.killed = true; state.killReason = reason; child.kill('SIGKILL'); } };
    const timer = setTimeout(() => kill('exact child 10-second watchdog'), 10000);
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) kill('64-KiB output cap'); else state[key] += chunk; });
      stream.on('close', () => state.events.push(`${key}-close`));
    }
    child.on('error', error => { state.spawnError = String(error); });
    child.on('exit', (code, signal) => state.events.push({ exit: code, signal }));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let pidAbsent = false;
      try { process.kill(child.pid, 0); } catch (error) { if (error.code === 'ESRCH') pidAbsent = true; else throw error; }
      resolveResult({ ...state, code, signal, pidAbsent, finished: new Date().toISOString() });
    });
  });
  results.push(result);
  writeFileSync(`${owned}/evidence/${label}.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ label, code: result.code, killed: result.killed, pidAbsent: result.pidAbsent }));
  assert.equal(result.killed, false);
  assert.equal(result.pidAbsent, true);
  return result;
}
try {
  for (const label of ['before', 'registration', 'current']) {
    const snapshot = resolve(temporary, label);
    for (const path of [canonical, source, protocol, 'package.json']) {
      const target = resolve(snapshot, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, inputs[label][path]);
    }
    const result = await run(`${label}-canonical`, ['--test-name-pattern=^idle messageerror retires promptly, holds capacity and close awaits cleanup$', resolve(snapshot, canonical)]);
    assert.equal(result.code, label === 'before' ? 0 : 1);
    if (label !== 'before') {
      assert.match(result.stdout, /1 !== 2/);
      assert.match(result.stdout, /messageerror\.test\.ts:123:/);
    }
  }
  const controlPath = resolve(temporary, 'current', owned, 'controls.test.ts');
  mkdirSync(dirname(controlPath), { recursive: true });
  writeFileSync(controlPath, readFileSync(`${owned}/controls.test.ts`));
  const controls = await run('current-controls', [controlPath]);
  assert.equal(controls.code, 0);
} finally {
  const unchanged = paths.every(path => sha256(readFileSync(path)) === sha256(inputs.current[path]));
  const historyUnchanged = historical.every(entry => sha256(readFileSync(entry.path)) === entry.currentSha256);
  const indexAfter = sha256(git('ls-files', '--stage'));
  rmSync(temporary, { recursive: true });
  writeFileSync(`${owned}/evidence/finish.json`, JSON.stringify({ finished: new Date().toISOString(), unchanged, historyUnchanged,
    indexBefore, indexAfter, indexUnchanged: indexBefore === indexAfter, exactTemporaryRemoved: temporary,
    strictUnhandled: true, nativeWorkers: 0, riskyRegexProbes: 0,
    children: results.map(({ label, pid, code, killed, pidAbsent }) => ({ label, pid, code, killed, pidAbsent })) }, null, 2) + '\n', { flag: 'wx' });
  assert.equal(unchanged, true);
  assert.equal(historyUnchanged, true);
}
