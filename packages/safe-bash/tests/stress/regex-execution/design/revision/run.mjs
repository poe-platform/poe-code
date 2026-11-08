import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scenarios, flags } from './fixtures.mjs';

assert.equal(process.argv.length, 2, 'BENIGN_ONLY_NO_ARGUMENTS');
const base = new URL('./', import.meta.url); const root = new URL('../../../../../', base);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const build = JSON.parse(readFileSync(new URL('evidence/build.json', base)));
const verify = () => {
  assert.equal(hash(readFileSync(process.execPath)), build.runtime.sha256);
  for (const [path, expected] of Object.entries(build.source)) assert.equal(hash(readFileSync(new URL(path, root))), expected, path);
  for (const [path, expected] of Object.entries(build.built)) assert.equal(hash(readFileSync(new URL('.temporary/js/' + path, base))), expected, path);
  for (const [path, expected] of Object.entries(build.harness)) assert.equal(hash(readFileSync(new URL(path, base))), expected, path);
};
const schedule = new URL('evidence/schedule.json', base);
assert(!existsSync(schedule), 'NO_RETRY'); verify();
writeFileSync(schedule, JSON.stringify({ utc: new Date().toISOString(), scenarios, flags, archivedRiskCount: 12, newRiskTranche: { author: { maximum: 2, used: 0 }, reviewerMaximum: 2, rootReservedUnused: 2 }, startupMs: 3000, afterReadyMs: 3000, cleanupMs: 1000, ipcBytes: 131072, streamBytes: 16384 }, null, 2) + '\n', { flag: 'wx' });
let failures = 0; let workers = 0;
for (const name of scenarios) {
  verify();
  writeFileSync(new URL(`evidence/${name}.claim.json`, base), JSON.stringify({ utc: new Date().toISOString(), name, risk: false, scheduleSha256: hash(readFileSync(schedule)), buildSha256: hash(readFileSync(new URL('evidence/build.json', base))) }) + '\n', { flag: 'wx' });
  const evidence = await new Promise(resolve => {
    const started = performance.now(); const events = []; const messages = [];
    const child = fork(fileURLToPath(new URL('child.mjs', base)), [name], { cwd: root, execArgv: flags, env: { LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let killed = false; let readyAt; let ipcBytes = 0; let streamBytes = 0; let stderr = ''; let cleanup;
    const kill = reason => {
      if (killed) return; killed = true;
      events.push({ event: 'kill', reason, accepted: child.kill('SIGKILL'), atMs: performance.now() - started });
      cleanup = setTimeout(() => { throw new Error('EXACT_CHILD_CLEANUP_UNCONFIRMED'); }, 1000);
    };
    let guard = setTimeout(() => kill('startup'), 3000);
    child.on('message', message => {
      ipcBytes += Buffer.byteLength(JSON.stringify(message));
      if (ipcBytes > 131072 || messages.length >= 8) { kill('ipc-cap'); return; }
      messages.push(message);
      if (message.type === 'ready') {
        if (readyAt !== undefined) { kill('duplicate-ready'); return; }
        readyAt = performance.now() - started; clearTimeout(guard);
        guard = setTimeout(() => kill('after-ready'), 3000);
        child.send('go', error => { if (error) kill('send-error'); });
      }
    });
    child.stdout.on('data', bytes => { streamBytes += bytes.length; if (streamBytes > 16384) kill('output-cap'); });
    child.stderr.on('data', bytes => { streamBytes += bytes.length; stderr += bytes.toString().slice(0, Math.max(0, 8192 - stderr.length)); if (streamBytes > 16384) kill('output-cap'); });
    for (const event of ['exit', 'disconnect']) child.on(event, (...values) => events.push({ event, values, atMs: performance.now() - started }));
    child.stdout.on('close', () => events.push({ event: 'stdout-close' })); child.stderr.on('close', () => events.push({ event: 'stderr-close' }));
    child.on('error', error => { events.push({ event: 'error', message: error.message }); kill('child-error'); });
    child.on('close', (code, signal) => {
      clearTimeout(guard); clearTimeout(cleanup);
      events.push({ event: 'close', code, signal, atMs: performance.now() - started });
      resolve({ name, pid: child.pid, readyAt, killed, code, signal, ipcBytes, streamBytes, stderr, events, messages });
    });
  });
  writeFileSync(new URL(`evidence/${name}.json`, base), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  verify();
  const done = evidence.messages.find(message => message.type === 'done');
  const failed = evidence.killed || evidence.code !== 0 || !done || Boolean(done.failure);
  for (const event of ['exit', 'disconnect', 'stdout-close', 'stderr-close', 'close']) assert(evidence.events.some(entry => entry.event === event), event);
  if (failed) failures++;
  workers += done?.cleanup.reduce((count, client) => count + client.metrics.created, 0) ?? 0;
  console.log(JSON.stringify({ name, failed, killed: evidence.killed, failure: done?.failure?.message }));
}
const summary = { children: scenarios.length, passes: scenarios.length - failures, failures, workers, activeOwnedChildren: 0, authorRiskUsed: 0 };
writeFileSync(new URL('evidence/summary.json', base), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(summary));
if (failures) process.exitCode = 1;
