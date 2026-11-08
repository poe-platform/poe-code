import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scenarios, risks, flags } from './fixtures.mjs';

const base = new URL('./', import.meta.url); const root = new URL('../../../../../', base);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const build = JSON.parse(readFileSync(new URL('evidence/build.json', base)));
const verify = () => {
  assert.equal(hash(readFileSync(process.execPath)), build.runtime.sha256);
  for (const [path, expected] of Object.entries(build.source)) assert.equal(hash(readFileSync(new URL(path, root))), expected, path);
  for (const [path, expected] of Object.entries(build.built)) assert.equal(hash(readFileSync(new URL('.temporary/js/' + path, base))), expected, path);
};
const mode = process.argv[2]; assert(['benign', 'risk'].includes(mode));
const schedule = mode === 'benign' ? scenarios : risks;
const schedulePath = new URL(`evidence/${mode}-schedule.json`, base);
assert(!existsSync(schedulePath), 'NO_REVIEW_RETRY'); verify();
writeFileSync(schedulePath, JSON.stringify({ utc: new Date().toISOString(), schedule, flags, historical: 7, author: 3, reviewRiskMaximum: 2, riskAfterReadyMs: 250, benignAfterReadyMs: 3000, startupMs: 3000, cleanupMs: 1000, maxIpcBytes: 131072, maxStreamBytes: 16384 }, null, 2) + '\n', { flag: 'wx' });
let failures = 0;
for (const name of schedule) {
  verify();
  const claim = new URL(`evidence/${name}.claim.json`, base);
  writeFileSync(claim, JSON.stringify({ utc: new Date().toISOString(), name, risk: risks.includes(name), historicalPlusAuthor: 10, riskOrdinal: risks.indexOf(name) + 1 }) + '\n', { flag: 'wx' });
  const evidence = await new Promise(resolve => {
    const start = performance.now(); const events = []; const messages = [];
    const child = fork(fileURLToPath(new URL('child.mjs', base)), [name], { cwd: root, execArgv: flags, env: { LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let killed = false; let readyAt; let ipcBytes = 0; let streamBytes = 0; let stderr = ''; let cleanupGuard;
    const kill = reason => {
      if (killed) return; killed = true;
      events.push({ event: 'kill', reason, atMs: performance.now() - start, accepted: child.kill('SIGKILL') });
      cleanupGuard = setTimeout(() => { throw new Error('EXACT_CHILD_CLEANUP_UNCONFIRMED'); }, 1000);
    };
    let guard = setTimeout(() => kill('startup'), 3000);
    child.on('message', message => {
      ipcBytes += Buffer.byteLength(JSON.stringify(message));
      if (ipcBytes > 131072 || messages.length >= 8) { kill('ipc-cap'); return; }
      messages.push(message);
      if (message.type === 'ready') {
        if (readyAt !== undefined) { kill('duplicate-ready'); return; }
        readyAt = performance.now() - start; clearTimeout(guard);
        guard = setTimeout(() => kill('after-ready'), mode === 'risk' ? 250 : 3000);
        child.send('go', error => { if (error) kill('send-error'); });
      }
    });
    child.stdout.on('data', bytes => { streamBytes += bytes.length; if (streamBytes > 16384) kill('output-cap'); });
    child.stderr.on('data', bytes => { streamBytes += bytes.length; stderr += bytes.toString().slice(0, Math.max(0, 8192 - stderr.length)); if (streamBytes > 16384) kill('output-cap'); });
    for (const event of ['exit', 'disconnect']) child.on(event, (...values) => events.push({ event, values, atMs: performance.now() - start }));
    child.stdout.on('close', () => events.push({ event: 'stdout-close' })); child.stderr.on('close', () => events.push({ event: 'stderr-close' }));
    child.on('error', error => { events.push({ event: 'error', message: error.message }); kill('child-error'); });
    child.on('close', (code, signal) => {
      clearTimeout(guard); clearTimeout(cleanupGuard);
      events.push({ event: 'close', code, signal, atMs: performance.now() - start });
      resolve({ name, pid: child.pid, readyAt, killed, code, signal, ipcBytes, streamBytes, stderr, events, messages });
    });
  });
  writeFileSync(new URL(`evidence/${name}.json`, base), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  verify();
  const done = evidence.messages.find(message => message.type === 'done');
  const failed = evidence.killed || evidence.code !== 0 || !done || Boolean(done.failure);
  for (const event of ['exit', 'disconnect', 'stdout-close', 'stderr-close', 'close']) assert(evidence.events.some(entry => entry.event === event), event);
  if (failed) failures++;
  console.log(JSON.stringify({ name, failed, killed: evidence.killed, failure: done?.failure?.message, elapsedMs: done?.elapsedMs }));
  if (mode === 'risk' && failed) { console.log('RISK_STOP_NO_RETRY_SECOND_RESERVATION_UNUSED'); break; }
}
console.log(JSON.stringify({ mode, failures, activeOwnedChildren: 0 }));
