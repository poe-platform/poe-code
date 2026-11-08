import { fork, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { vectors, workloads, risk } from './fixtures.mjs';
const base = new URL('./', import.meta.url);
const root = new URL('../../../../', base);
const mode = process.argv[2];
if (!['benign', 'risk'].includes(mode) || process.argv.length !== 3) throw new Error('FIXED_MODE_ONLY');
const frozen = JSON.parse(readFileSync(new URL('frozen.json', base)));
const verify = () => {
  for (const [path, expected] of Object.entries({ ...frozen.source, ...frozen.built })) {
    if (createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex') !== expected) throw new Error('FROZEN_DRIFT ' + path);
  }
};
verify();
const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'tests/stress/regex-execution/design'], { cwd: root, encoding: 'utf8' }).stdout;
if (dirty.split('\n').some(line => line && !line.includes('/evidence/') && !line.includes('/review/'))) throw new Error('COMMIT_SOURCES_AND_FREEZE_FIRST');
mkdirSync(new URL('evidence/', base), { recursive: true });
const schedule = mode === 'risk' ? risk.author.map(name => ['risk', name]) : [
  ...vectors.flatMap(vector => ['grep', 'rg'].map(profile => ['vector', vector.name, profile])),
  ['lifecycle', 'fixed'],
  ...workloads.flatMap(spec => ['grep', 'rg'].flatMap(profile => [0, 1, 2].flatMap(repetition => {
    const engines = ['current', 'worker16', 'worker128', 'bounded'];
    return engines.map((_unused, index) => ['bench', spec.name, profile, engines[(index + repetition) % engines.length], String(repetition)]);
  }))),
];
const stamp = new Date().toISOString().replaceAll(':', '-');
writeFileSync(new URL(`evidence/${stamp}-${mode}-schedule.json`, base), JSON.stringify({ schedule, historical: 7, newAuthorAllocation: 3, reviewerReserved: 2, riskMax: 5, repetitions: 3, warmups: 0, flags: ['--unhandled-rejections=strict', '--max-old-space-size=64', '--stack-size=2048'], watchdog: { riskAfterReady: 250, vectorAfterReady: 250, otherAfterReady: 5000, startup: 3000, cleanup: 1000, rssSampleBytes: 536870912, maxIpcBytes: 1048576, maxStreamBytes: 65536 }, started: stamp }, null, 2) + '\n');
let failures = 0;
for (const [index, args] of schedule.entries()) {
  verify();
  if (mode === 'risk') {
    const claim = new URL(`evidence/risk-${args[1]}.claim.json`, base);
    if (existsSync(claim)) throw new Error('NO_RISK_RETRY');
    writeFileSync(claim, JSON.stringify({ args, utc: new Date().toISOString(), allocation: index + 1, historical: 7, reserved: 2 }) + '\n', { flag: 'wx' });
  }
  const evidence = await new Promise(resolve => {
    const started = performance.now();
    const events = [];
    const messages = [];
    const child = fork(fileURLToPath(new URL('child.mjs', base)), args, { cwd: root, execArgv: ['--unhandled-rejections=strict', '--max-old-space-size=64', '--stack-size=2048'], env: { LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let killed = false;
    let bytes = 0;
    let streams = 0;
    let stderr = '';
    let readyAt;
    let cleanup;
    const kill = reason => {
      if (killed) return;
      killed = true; events.push({ event: 'kill', reason, at: performance.now() - started, accepted: child.kill('SIGKILL') });
      cleanup = setTimeout(() => { throw new Error('EXACT_CHILD_CLEANUP_UNCONFIRMED'); }, 1000);
    };
    let watchdog = setTimeout(() => kill('startup'), 3000);
    child.on('message', message => {
      bytes += Buffer.byteLength(JSON.stringify(message));
      if (bytes > 1048576 || messages.length > 128) { kill('ipc-cap'); return; }
      messages.push(message);
      if (message.type === 'ready') {
        if (readyAt !== undefined) { kill('duplicate-ready'); return; }
        readyAt = performance.now() - started;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => kill('after-ready'), ['risk', 'vector'].includes(args[0]) ? 250 : 5000);
        child.send('go');
      } else if (message.type === 'heartbeat' && message.rss > 536870912) kill('sampled-rss-cap');
    });
    child.stdout.on('data', chunk => { streams += chunk.length; if (streams > 65536) kill('stream-cap'); });
    child.stderr.on('data', chunk => { streams += chunk.length; stderr += chunk.toString().slice(0, 8192 - stderr.length); if (streams > 65536) kill('stream-cap'); });
    for (const event of ['exit', 'disconnect']) child.on(event, (...values) => events.push({ event, values, at: performance.now() - started }));
    child.stdout.on('close', () => events.push({ event: 'stdout-close' }));
    child.stderr.on('close', () => events.push({ event: 'stderr-close' }));
    child.on('error', error => { events.push({ event: 'error', message: error.message }); kill('child-error'); });
    child.on('close', (code, signal) => {
      clearTimeout(watchdog); clearTimeout(cleanup);
      events.push({ event: 'close', code, signal, at: performance.now() - started });
      resolve({ args, pid: child.pid, readyAt, killed, events, messages, stderr, ipcBytes: bytes, streamBytes: streams, code, signal });
    });
  });
  writeFileSync(new URL(`evidence/${stamp}-${String(index).padStart(3, '0')}.json`, base), JSON.stringify(evidence, null, 2) + '\n');
  verify();
  const done = evidence.messages.find(message => message.type === 'done');
  const failed = evidence.killed || evidence.code !== 0 || !done || done.failure;
  if (failed) failures++;
  console.log(JSON.stringify({ args, killed: evidence.killed, status: done?.result?.status, failure: done?.failure?.message, code: evidence.code }));
  if (mode === 'risk' && (failed || done.result.status === 'error' && !['execution step limit exceeded', 'WORK_DEADLINE', 'EXPLICIT_ABORT'].includes(done.result.error))) throw new Error('RISK_FAMILY_STOP_NO_RETRY');
}
console.log(JSON.stringify({ mode, children: schedule.length, failures, activeChildren: 0 }));
