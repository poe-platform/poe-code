import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const base = new URL('./', import.meta.url);
const cases = ['exit-active', 'error-active', 'exit-error-abort-race', 'partial-live-close', 'pending-source-reject', 'pending-source-abort', 'uncooperative-pending-abort', 'downstream-close-pending', 'downstream-throw', 'single-next-order', 'batch-byte-cap', 'capacity-policy'];
const flags = ['--unhandled-rejections=strict', '--max-old-space-size=64', '--stack-size=2048'];
const manifest = JSON.parse(readFileSync(new URL('evidence/fixed-freeze.json', base)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const verify = () => { for (const [path, expected] of Object.entries(manifest.files)) assert.equal(hash(readFileSync(path)), expected, path); };
const put = (name, value) => writeFileSync(new URL('evidence/guards/' + name + '.json', base), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
mkdirSync(new URL('evidence/guards/', base)); verify();
put('schedule', { utc: new Date().toISOString(), cases, expected: 'all pass; capacity-policy explicitly records failfast and idle slot retention, not a production policy endorsement', flags, afterReadyMs: 3000, startupMs: 3000, cleanupMs: 1000, maxIpcBytes: 131072, maxStreamBytes: 16384, newRiskConsumed: 0, harness: Object.fromEntries(['guards-child.mjs', 'guards-run.mjs'].map(name => [name, hash(readFileSync(new URL(name, base)))])) });
const results = [];
for (const name of cases) {
  verify(); put(name + '.claim', { utc: new Date().toISOString(), name, benignOnly: true });
  const evidence = await new Promise(resolve => {
    const events = []; const messages = []; const start = performance.now();
    const child = fork(fileURLToPath(new URL('guards-child.mjs', base)), [name], { cwd: base, execArgv: flags, env: { LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let killed = false; let readyAt; let ipcBytes = 0; let streamBytes = 0; let stderr = ''; let cleanupGuard;
    const kill = reason => { if (killed) return; killed = true; events.push({ event: 'kill', reason, accepted: child.kill('SIGKILL') }); cleanupGuard = setTimeout(() => { throw new Error('EXACT_CHILD_CLEANUP_UNCONFIRMED'); }, 1000); };
    let guard = setTimeout(() => kill('startup'), 3000);
    child.on('message', message => {
      ipcBytes += Buffer.byteLength(JSON.stringify(message)); if (ipcBytes > 131072 || messages.length >= 8) { kill('ipc-cap'); return; }
      messages.push(message);
      if (message.type === 'ready') { if (readyAt !== undefined) { kill('duplicate-ready'); return; } readyAt = performance.now() - start; clearTimeout(guard); guard = setTimeout(() => kill('after-ready'), 3000); child.send('go', error => { if (error) kill('send-error'); }); }
    });
    child.stdout.on('data', bytes => { streamBytes += bytes.length; if (streamBytes > 16384) kill('output-cap'); });
    child.stderr.on('data', bytes => { streamBytes += bytes.length; stderr += bytes.toString().slice(0, Math.max(0, 8192 - stderr.length)); if (streamBytes > 16384) kill('output-cap'); });
    for (const event of ['exit', 'disconnect']) child.on(event, (...values) => events.push({ event, values }));
    child.stdout.on('close', () => events.push({ event: 'stdout-close' })); child.stderr.on('close', () => events.push({ event: 'stderr-close' }));
    child.on('error', error => { events.push({ event: 'error', message: error.message }); kill('child-error'); });
    child.on('close', (code, signal) => { clearTimeout(guard); clearTimeout(cleanupGuard); events.push({ event: 'close', code, signal }); resolve({ name, pid: child.pid, killed, readyAt, code, signal, ipcBytes, streamBytes, stderr, events, messages }); });
  });
  put(name, evidence); verify();
  const done = evidence.messages.find(message => message.type === 'done');
  const failed = evidence.killed || evidence.code !== 0 || !done || Boolean(done.failure);
  for (const event of ['exit', 'disconnect', 'stdout-close', 'stderr-close', 'close']) assert(evidence.events.some(entry => entry.event === event), event);
  const result = { name, failed, failure: done?.failure, killed: evidence.killed }; results.push(result); console.log(JSON.stringify(result));
}
put('summary', { pass: results.filter(result => !result.failed).length, fail: results.filter(result => result.failed).length, results, activeOwnedChildren: 0, newRiskConsumed: 0 });
