import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { authenticate, base, checkGuards, fileRecord, gitEntries, json, owned, repository, save } from './auth.mjs';

const [presealCommit, rootHash] = process.argv.slice(2);
assert(/^[a-f0-9]{40}$/.test(presealCommit ?? ''));
authenticate(gitEntries(presealCommit, `${base}/actual-35da1854-v1`));
const rootPath = join(owned, 'ROOT-EXECUTION.json');
assert.equal(fileRecord(rootPath).sha256, rootHash);
const root = json(rootPath);
const guards = json(join(owned, 'preparation/INPUT-GUARDS.json'));
checkGuards(guards);
const evidence = join(owned, 'execution');
mkdirSync(evidence);
const core = join(repository, base, 'executor-preparation-v1/integration-v2/core');
const sealPath = join(core, '../SEAL-v4.json');
const args = [join(core, 'run.mjs'), rootPath, rootHash, sealPath, root.integrationSealSha256];
const bounds = { parentDeadlineMs: 660000, termGraceMs: 150, reapMs: 2500, combinedCaptureBytes: 16777216 };
save(join(evidence, 'RUN-ATTEMPT.json'), { date: '2026-08-28', presealCommit, executable: process.execPath, args, cwd: repository, env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }, bounds, rule: 'Exactly one invocation; no failed-case or setup retry.' });
const stdoutPath = join(evidence, 'stdout.bin');
const stderrPath = join(evidence, 'stderr.bin');
writeFileSync(stdoutPath, '', { flag: 'wx' });
writeFileSync(stderrPath, '', { flag: 'wx' });
const started = Date.now();
const child = spawn(process.execPath, args, { cwd: repository, env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let closed = false;
let exitCode = null;
let signal = null;
let spawnError = null;
let timedOut = false;
let overflow = false;
let combinedBytes = 0;
let terminating = false;
let killTimer;
const kills = [];
const absent = (group) => {
  try { process.kill(-group, 0); return false; }
  catch (error) { return error?.code === 'ESRCH'; }
};
const killOwnedParent = (kind) => {
  if (!child.pid || absent(child.pid)) return;
  try { process.kill(-child.pid, kind); kills.push(kind); }
  catch (error) { if (error?.code !== 'ESRCH') kills.push(`${kind}:${error?.code}`); }
};
const terminate = () => {
  if (terminating) return;
  terminating = true;
  killOwnedParent('SIGTERM');
  killTimer = setTimeout(() => killOwnedParent('SIGKILL'), bounds.termGraceMs);
};
const collect = (path) => (chunk) => {
  const available = Math.max(0, bounds.combinedCaptureBytes - combinedBytes);
  if (chunk.length > available) { overflow = true; terminate(); }
  if (available) appendFileSync(path, chunk.subarray(0, available));
  combinedBytes += Math.min(available, chunk.length);
};
child.stdout.on('data', collect(stdoutPath));
child.stderr.on('data', collect(stderrPath));
child.on('error', (error) => { spawnError = { name: error.name, code: error.code ?? null, message: error.message }; });
child.on('close', (code, childSignal) => { closed = true; exitCode = code; signal = childSignal; });
save(join(evidence, 'PARENT-START.json'), { pid: child.pid ?? null, group: child.pid ?? null, started, bounds });
const deadline = setTimeout(() => { timedOut = true; terminate(); }, bounds.parentDeadlineMs);
while (!closed && Date.now() < started + bounds.parentDeadlineMs + bounds.termGraceMs + bounds.reapMs) await delay(25);
clearTimeout(deadline);
clearTimeout(killTimer);
if (!closed) killOwnedParent('SIGKILL');
const lastEnd = Date.now() + bounds.reapMs;
while ((!closed || (child.pid && !absent(child.pid))) && Date.now() < lastEnd) await delay(25);
const reaped = closed && (!child.pid || absent(child.pid));
save(join(evidence, 'RUN-PROCESS.json'), { pid: child.pid ?? null, group: child.pid ?? null, exitCode, signal, spawnError, timedOut, overflow, combinedBytes, closed, reaped, kills, elapsedMs: Date.now() - started, stdout: fileRecord(stdoutPath), stderr: fileRecord(stderrPath) });
if (!reaped) { child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
let integrity = true;
let integrityError = null;
try { checkGuards(guards); authenticate(gitEntries(presealCommit, `${base}/actual-35da1854-v1`)); }
catch (error) { integrity = false; integrityError = { name: error.name, message: error.message, stack: error.stack }; }
save(join(evidence, 'INTEGRITY-AFTER.json'), { integrity, integrityError, completeInputMembershipIncludingNewEntries: true, modeAndHashChecked: true, observationNotTransaction: true });
const runDirectories = readdirSync(root.outputParent).sort();
const summaries = runDirectories.map((name) => join(root.outputParent, name, 'COMPOUND-RESULT.json')).filter(existsSync);
const metadata = [];
function scan(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) scan(join(path, entry.name));
    else if (entry.name === 'child.json') {
      const record = json(join(path, entry.name));
      metadata.push({ path: join(path, entry.name), ...record, groupAbsentNow: record.group === null || absent(record.group) });
    }
  }
}
for (const name of runDirectories) {
  const captures = join(root.outputParent, name, 'captures');
  if (existsSync(captures)) scan(captures);
}
const compound = summaries.length === 1 ? json(summaries[0]) : null;
const knownOwnedReap = reaped && metadata.every((entry) => entry.reaped && entry.groupAbsentNow) && (compound ? compound.activeChildren.length === 0 : runDirectories.length === 0);
save(join(evidence, 'REAP-AUDIT.json'), { knownOwnedReap, parentReaped: reaped, children: metadata, runDirectories, summaries, noOpaqueOrForeignProcessClaim: true, unsafeIfMissingSummaryAfterAdmission: !compound && runDirectories.length > 0 });
const aggregate = exitCode === 0 && signal === null && !spawnError && !timedOut && !overflow && integrity && knownOwnedReap && compound?.aggregate === 'PASS' ? 'PASS' : 'FAIL';
save(join(evidence, 'OUTCOME.json'), { aggregate, integrity, knownOwnedReap, compound, setupFailureBeforeEvidence: !compound && runDirectories.length === 0, frozenRunInvocations: 1, retries: 0, noProductAcceptance: true });
console.log(JSON.stringify({ aggregate, integrity, knownOwnedReap, exitCode, evidence, compound: summaries[0] ?? null }));
process.exitCode = aggregate === 'PASS' ? 0 : 1;
