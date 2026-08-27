import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyLaunch, checkClosure, digest } from './launch-seal.mjs';
import { accounting } from './driver-lifecycle.mjs';

const output = path.dirname(fileURLToPath(import.meta.url));
assert.equal(process.argv[2], '--approval');
const verified = verifyLaunch(output, process.argv[3]);
const { download } = verified;
const resultRoot = path.join(output, 'representative-v3-attempt-001');
fs.mkdirSync(resultRoot);
const events = [], failures = [], timers = [];
let child, spawned = false, finished = false, exited = false, pipesClosed = false, survivorCleanupStarted = false, exit = null, groupId = null, outputBytes = 0;
const write = (name, value) => fs.writeFileSync(path.join(resultRoot, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
function record(value) {
  const entry = { at: new Date().toISOString(), ...value }; events.push(entry);
  try { fs.appendFileSync(path.join(resultRoot, 'supervisor-events.jsonl'), `${JSON.stringify(entry)}\n`); }
  catch (error) { failures.push(`supervisor journal: ${error}`); }
}
function groupAlive() {
  if (!groupId) return false;
  try { process.kill(-groupId, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; failures.push(`group probe: ${error}`); return true; }
}
function signalGroup(signal, reason) {
  if (!groupAlive()) return;
  failures.push(`${reason}: ${signal}`); record({ event: 'owned-group-signal', groupId, signal, reason, exceptional: true });
  try { process.kill(-groupId, signal); } catch (error) { failures.push(`group signal: ${error}`); record({ event: 'owned-group-signal-error', signal, error: String(error) }); }
}
function finish(reason) {
  if (finished) return; finished = true;
  for (const timer of timers) clearTimeout(timer);
  const survivors = groupAlive();
  if (survivors) { signalGroup('SIGKILL', 'final survivor containment'); failures.push('owned group not confirmed gone at final bound'); }
  let coordinatorSummary = null;
  try { coordinatorSummary = JSON.parse(fs.readFileSync(path.join(resultRoot, 'summary.json'))); }
  catch (error) { failures.push(`coordinator final evidence unavailable: ${error}`); }
  const retainedEvents = [];
  let journalComplete = true;
  try {
    const text = fs.readFileSync(path.join(resultRoot, 'events.jsonl'), 'utf8');
    for (const line of text.split('\n').filter(Boolean)) {
      try { retainedEvents.push(JSON.parse(line)); } catch (error) { journalComplete = false; failures.push(`partial coordinator journal: ${error}`); }
    }
  } catch (error) { journalComplete = false; failures.push(`coordinator journal unavailable: ${error}`); }
  const retainedCounts = accounting(retainedEvents);
  if (!spawned || !exited || !pipesClosed || exit?.code !== 0 || exit?.signal || !coordinatorSummary || coordinatorSummary.failures?.length) failures.push('coordinator incomplete or failed');
  record({ event: 'supervisor-final', reason, spawned, exited, exit, survivors });
  try { write('supervisor-summary.json', { completedAt: new Date().toISOString(), approvalSha256: verified.approvalSha256, reason, spawnedCoordinators: Number(spawned), coordinatorExit: exit, coordinatorPipesClosed: pipesClosed, groupId, groupConfirmedGone: !survivors, failures, events, complete: failures.length === 0, coordinatorCounts: coordinatorSummary?.counts ?? null, retainedJournalCounts: retainedCounts, journalParseComplete: journalComplete, partialCountsAreLowerBoundsNotZeroWork: !coordinatorSummary || !journalComplete, missingCoordinatorCountsAreUnknown: true }); }
  catch (error) { failures.push(`supervisor summary publication: ${error}`); process.stderr.write(`${error}\n`); }
  process.exit(failures.length ? 1 : 0);
}
function soonAfterExit() {
  if (!groupAlive()) { if (pipesClosed) finish('coordinator exit/close; owned group gone'); return; }
  if (survivorCleanupStarted) return; survivorCleanupStarted = true;
  signalGroup('SIGTERM', 'survivor after coordinator exit');
  timers.push(setTimeout(() => signalGroup('SIGKILL', 'survivor grace exhausted'), 2000));
  timers.push(setTimeout(() => finish('survivor finalization bound'), 4000));
}
timers.push(setTimeout(() => { failures.push('146s external deadline expired'); signalGroup('SIGTERM', '146s external deadline'); }, 146000));
timers.push(setTimeout(() => { signalGroup('SIGKILL', '148s external deadline'); }, 148000));
timers.push(setTimeout(() => finish('150s external finalization bound'), 150000));
try {
  write('supervisor-binding.json', { approvalPath: process.argv[3], approvalSha256: verified.approvalSha256, approval: verified.approval, actualNodePath: process.execPath, actualNodeSha256: digest(fs.readFileSync(process.execPath)), exactClosure: checkClosure(verified, false) });
  const environment = { PATH: `${path.dirname(download.executable)}:/usr/bin:/bin`, HOME: download.environment.HOME, TMPDIR: download.environment.TMPDIR, npm_config_cache: download.environment.npm_config_cache, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', AUTH_SUPERVISOR_PID: String(process.pid), AUTH_APPROVAL_SHA256: verified.approvalSha256 };
  record({ event: 'coordinator-launch-attempt', executable: download.executable, environment });
  assert.equal(failures.length, 0, 'supervisor evidence failure prohibits coordinator launch');
  child = spawn(download.executable, ['--unhandled-rejections=strict', path.join(output, 'representative.mjs'), '--approval', process.argv[3]], { cwd: verified.root, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  groupId = child.pid ?? null;
  child.once('spawn', () => { spawned = true; record({ event: 'coordinator-launched', pid: child.pid, groupId }); });
  child.on('error', error => { failures.push(`coordinator process: ${error}`); record({ event: 'coordinator-error', error: String(error) }); if (!spawned) finish('coordinator spawn failed'); else signalGroup('SIGTERM', 'coordinator error'); });
  child.once('exit', (code, signal) => { exited = true; exit = { code, signal }; record({ event: 'coordinator-exit', code, signal }); soonAfterExit(); });
  child.once('close', () => { pipesClosed = true; record({ event: 'coordinator-pipes-closed' }); soonAfterExit(); });
  for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
    stream.on('data', bytes => {
      outputBytes += bytes.length;
      if (outputBytes > 1024 * 1024) { signalGroup('SIGTERM', 'coordinator output limit'); return; }
      try { fs.appendFileSync(path.join(resultRoot, `coordinator.${name}`), bytes); }
      catch (error) { failures.push(`coordinator output write: ${error}`); signalGroup('SIGTERM', 'coordinator output write failure'); }
    });
    stream.on('error', error => { failures.push(`coordinator ${name} stream: ${error}`); signalGroup('SIGTERM', 'coordinator stream failure'); });
  }
} catch (error) { failures.push(String(error.stack ?? error)); signalGroup('SIGTERM', 'supervisor setup failure'); if (!groupId) finish('supervisor setup failure'); }
