import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const repository = resolve(own, '../../..');
const base = join(repository, 'tests/integration/html-public-independent-20260827/admission-v2');
const bindingPath = join(base, 'binding-04/BINDINGS.json');
const bindingHash = '7df791cf7c7c0010af85726af9d9e78dcdebbdaff0c182fb9670be6e29b8989a';
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
function digest(filename) {
  const buffer = Buffer.alloc(65536), hash = createHash('sha256'), descriptor = openSync(filename, 'r');
  try { let count; while ((count = readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { closeSync(descriptor); }
  return hash.digest('hex');
}
function json(filename, value) { writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }
const scratch = join(own, 'scratch');
const raw = join(own, 'execution');
const phases = [
  { name: 'controls', entry: 'controls.mjs', args: [bindingPath, bindingHash, join(raw, 'controls')], heap: true },
  { name: 'extra-controls', entry: 'controls-extra.mjs', args: [join(raw, 'extra-controls')] },
  { name: 'admission', entry: 'run.mjs', args: [bindingPath, bindingHash, join(raw, 'admission'), '--admission-build'] },
  { name: 'reconstruction', entry: 'reconstruct-only.mjs', args: [bindingPath, bindingHash, join(raw, 'reconstruction')] },
];
const env = { PATH: `${dirname(node)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' };
function groupMembers(group) {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,command='], { encoding: 'utf8', maxBuffer: 4 * 1024 ** 2, timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  return result.stdout.split('\n').filter(line => Number(line.trim().split(/\s+/u)[2]) === group);
}
const started = new Date().toISOString();
assert.equal(digest(bindingPath), bindingHash);
const auth = JSON.parse(readFileSync(join(own, 'PRE.json')));
assert.equal(auth.archive.sha256, auth.expected.archive);
const helperHashes = Object.fromEntries(['supervise.mjs', 'authenticate.mjs', 'settle.mjs', 'STATIC-REVIEW.md'].map(name => [name, digest(join(own, name))]));
const frozen = JSON.parse(readFileSync(join(own, 'EXECUTION-FREEZE.json')));
assert.deepEqual(helperHashes, frozen.helpers);
for (const name of ['core.mjs', 'controls.mjs', 'controls-extra.mjs', 'reconstruct.mjs', 'reconstruct-only.mjs', 'run.mjs', 'stream-fixture.mjs']) assert.equal(digest(join(base, name)), auth.sealed[name].sha256);
assert.equal(digest(node), auth.tools.node.sha256);
mkdirSync(scratch);
mkdirSync(raw);
json(join(raw, 'PRE.json'), { started, helperHashes, node, nodeSha256: digest(node), gitSha256: digest('/usr/bin/git'), tar: { path: '/usr/bin/tar', realpath: realpathSync('/usr/bin/tar'), sha256: digest('/usr/bin/tar') }, psSha256: digest('/bin/ps'), env, phases, phaseTimeoutMs: 900000, killGraceMs: 5000, adaptation: 'None. Original authenticated entrypoints with explicit output paths and owned TMPDIR/HOME only.', actual34: 0 });
const results = [];
for (const phase of phases) {
  const args = [...(phase.heap ? ['--max-old-space-size=96'] : []), join(base, phase.entry), ...phase.args];
  const record = { name: phase.name, started: new Date().toISOString(), executable: node, args, cwd: repository, env, entrySha256: digest(join(base, phase.entry)), supervisorSha256: helperHashes['supervise.mjs'], actual34: 0 };
  json(join(raw, `${phase.name}.PRE.json`), record);
  const stdoutPath = join(raw, `${phase.name}.stdout.data`), stderrPath = join(raw, `${phase.name}.stderr.data`);
  const stdout = openSync(stdoutPath, 'wx'), stderr = openSync(stderrPath, 'wx');
  const child = spawn(node, args, { cwd: repository, env, detached: true, stdio: ['ignore', stdout, stderr] });
  closeSync(stdout); closeSync(stderr);
  record.pid = child.pid;
  record.pgid = child.pid;
  record.signalsSent = [];
  let escalation;
  const closure = new Promise(resolveResult => {
    child.on('error', error => { record.spawnError = error.message; });
    child.on('close', (code, signal) => resolveResult({ code, signal }));
  });
  const timer = setTimeout(() => {
    record.timedOut = true;
    record.membersAtTimeout = groupMembers(child.pid);
    if (record.membersAtTimeout.length) {
      process.kill(-child.pid, 'SIGTERM');
      record.signalsSent.push({ at: new Date().toISOString(), signal: 'SIGTERM', reason: '900s supervised phase hang deadline' });
    }
    escalation = setTimeout(() => {
      const remaining = groupMembers(child.pid);
      if (remaining.length) {
        process.kill(-child.pid, 'SIGKILL');
        record.signalsSent.push({ at: new Date().toISOString(), signal: 'SIGKILL', reason: '5s grace exceeded', remaining });
      }
    }, 5000);
  }, 900000);
  Object.assign(record, await closure);
  clearTimeout(timer);
  clearTimeout(escalation);
  record.closeObserved = true;
  record.finished = new Date().toISOString();
  record.remainingGroupMembers = groupMembers(child.pid);
  record.stdout = { path: stdoutPath, bytes: lstatSync(stdoutPath).size, sha256: digest(stdoutPath) };
  record.stderr = { path: stderrPath, bytes: lstatSync(stderrPath).size, sha256: digest(stderrPath) };
  record.success = record.code === 0 && record.signal === null && !record.spawnError && !record.timedOut && record.remainingGroupMembers.length === 0;
  json(join(raw, `${phase.name}.RAW.json`), record);
  results.push(record);
  console.log(JSON.stringify({ phase: phase.name, code: record.code, signal: record.signal, naturalClose: record.signalsSent.length === 0, remainingGroupMembers: record.remainingGroupMembers.length }));
  if (!record.success) break;
}
const summary = { started, finished: new Date().toISOString(), results, completedPhases: results.length, unexecutedPhases: phases.slice(results.length).map(phase => phase.name), actual34: 0, allPassed: results.length === phases.length && results.every(record => record.success) };
json(join(raw, 'SUPERVISOR.json'), summary);
process.exitCode = summary.allPassed ? 0 : 1;
