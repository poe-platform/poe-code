import { fork, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { commands, raw, workloads, policyNames } from './fixtures.mjs';
const base = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(base, '../../../../..');
if (!existsSync('/tmp/regex-revision-author-ready.txt') || process.env.NODE_OPTIONS || process.argv.length !== 2) throw new Error('READY_FIXED_RUN_ONLY');
const frozen = JSON.parse(readFileSync(resolve(base, 'evidence/frozen.json')));
const repair = existsSync(resolve(base, 'evidence/repair.json')) ? JSON.parse(readFileSync(resolve(base, 'evidence/repair.json'))) : undefined;
const verify = () => {
  if (repair) for (const [path, expected] of Object.entries(frozen.source)) {
    if (createHash('sha256').update(readFileSync(resolve(base, '.scratch/source', path))).digest('hex') !== expected) throw new Error('SNAPSHOT_DRIFT ' + path);
  }
  const liveSource = repair ? Object.fromEntries(Object.entries(frozen.source).filter(([path]) => path === 'src/commands/grep.ts' || path.startsWith('src/commands/search/') || path.startsWith('tests/stress/regex-execution/design/'))) : frozen.source;
  for (const [path, expected] of Object.entries({ ...liveSource, ...frozen.harness, ...frozen.built, ...frozen.generatedCopies, ...repair?.overrides })) {
    if (createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') !== expected) throw new Error('FROZEN_DRIFT ' + path);
  }
};
verify();
const engines = ['current', 'worker', 'worker-stream'];
const schedule = [...commands.map(vector => ['vector', vector.id]), ...raw.map(vector => ['raw', vector.id]), ...policyNames.map(name => ['policy', name]), ...workloads.flatMap(name => [0, 1, 2].flatMap(repetition => engines.map((unused, offset) => ['bench', name, engines[(offset + repetition) % engines.length], String(repetition)]))), ['package', 'moved-esm']];
if (!repair) writeFileSync(resolve(base, 'evidence/schedule.json'), JSON.stringify({ at: new Date().toISOString(), harnessCommit: spawnSync('git', ['log', '-1', '--format=%H', '--', base], { cwd: root, encoding: 'utf8' }).stdout.trim(), schedule, riskyExecutionsAllocated: 0, riskyExecutions: 0, historicalRiskExhausted: 12, siblingRiskAllocations: [2, 2], rootRiskReserve: 2, repetitions: 3, warmup: 'one exact-output preflight for each benchmark child; excluded', bounds: { startupMs: 3000, afterReadyMs: 10000, cleanupMs: 1000, sampledRssBytes: 536870912, ipcBytes: 1048576, streamBytes: 65536 }, provenance: 'bounded fork/ready/go/heartbeat/kill/exact-child-close supervisor adapted from ../run.mjs; no risk mode or arbitrary fixture input' }, null, 2) + '\n', { flag: 'wx' });
let failures = 0;
const pending = [...schedule.entries()].filter(([index]) => !repair || !existsSync(resolve(base, `evidence/run-${String(index).padStart(2, '0')}.json`)));
if (repair) pending.push(['recheck-17', schedule[17]]);
for (const [index, args] of pending) {
  verify();
  const evidence = await new Promise(resolveResult => {
    const started = performance.now();
    const events = [];
    const messages = [];
    const child = fork(resolve(base, 'child.mjs'), args, { cwd: root, execArgv: ['--unhandled-rejections=strict', '--max-old-space-size=64', '--stack-size=2048'], env: { LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let killed = false;
    let bytes = 0;
    let streams = 0;
    let stderr = '';
    let readyAt;
    let cleanup;
    const kill = reason => {
      if (killed) return;
      killed = true;
      events.push({ event: 'kill', reason, at: performance.now() - started, accepted: child.kill('SIGKILL') });
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
        watchdog = setTimeout(() => kill('after-ready'), 10000);
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
      resolveResult({ args, pid: child.pid, readyAt, killed, events, messages, stderr, ipcBytes: bytes, streamBytes: streams, code, signal });
    });
  });
  writeFileSync(resolve(base, `evidence/run-${String(index).padStart(2, '0')}.json`), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  verify();
  const done = evidence.messages.find(message => message.type === 'done');
  const pass = !evidence.killed && evidence.code === 0 && done?.result.pass === true && ['exit', 'disconnect', 'stdout-close', 'stderr-close', 'close'].every(event => evidence.events.some(entry => entry.event === event));
  if (!pass) failures++;
  console.log(JSON.stringify({ args, pass, error: done?.result.error, code: evidence.code }));
}
writeFileSync(resolve(base, 'evidence/summary.json'), JSON.stringify({ plannedChildren: schedule.length, thisPhaseChildren: pending.length, thisPhaseFailures: failures, riskyExecutions: 0, activeChildren: 0, verification: repair ? 'unchanged copied source plus live command/prototype source; original README drift retained; explicit adapter/harness hash overrides in repair.json' : 'live source/build/harness' }, null, 2) + '\n', { flag: 'wx' });
process.exitCode = failures ? 1 : 0;
