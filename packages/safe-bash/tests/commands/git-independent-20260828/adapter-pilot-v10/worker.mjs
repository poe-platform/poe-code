import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAdapter, bindProbe } from './adapter.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let outputBytes = 0;
const emit = value => {
  const line = JSON.stringify(value) + '\n'; outputBytes += Buffer.byteLength(line);
  assert.ok(outputBytes <= 16 * 1024 * 1024, 'aggregate worker capture');
  return new Promise((resolve, reject) => process.stdout.write(line, error => error ? reject(error) : resolve()));
};
const drain = async () => {
  for (let turn = 0; turn < 2; turn++) {
    await new Promise(resolve => process.nextTick(resolve));
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
  }
};
const bounded = async (pending, milliseconds, label) => {
  let timer;
  try { return await Promise.race([pending, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]); }
  finally { clearTimeout(timer); }
};

export async function run() {
  const seal = JSON.parse(readFileSync(join(root, 'PRESEAL.json')));
  assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
  let current, outsideProbe = 0;
  const dispatch = { probe(...args) { if (current) current.probe(...args); else outsideProbe++; } };
  const bound = bindProbe(dispatch);
  const results = [];
  let safety = false;
  try {
    const { makeCases } = await import('./cases.mjs');
    const app = join(root, 'RUN-01/app/dist');
    const api = await import(pathToFileURL(join(app, 'commands/git/index.js')).href);
    const core = await import(pathToFileURL(join(app, 'index.js')).href);
    const io = await import(pathToFileURL(join(app, 'commands/git/io.js')).href);
    const limits = await import(pathToFileURL(join(app, 'commands/git/limits.js')).href);
    const bytes = readFileSync(join(root, 'records.json'));
    assert.equal(hash(bytes), seal.files.find(row => row.path === 'records.json').sha256);
    const environment = { api, core, records: JSON.parse(bytes), observations: [], internals: { Session: io.Session, limits: limits.GIT_LIMITS } };
    const suite = makeCases(environment).filter(row => seal.membership.some(member => member.id === row.id));
    assert.deepEqual(suite.map(row => row.id), ['A57', 'A60', 'H09']);
    for (const test of suite) {
      const start = process.hrtime.bigint(), controller = new AbortController();
      current = createAdapter(); environment.signal = controller.signal; environment.observations = [];
      let hasFailure = false, failure, timedOut = false, beforeNotification, afterNotification, restoration, cleanupFailure;
      const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('pilot case deadline')); }, seal.limits.caseMs);
      try {
        await bounded(test.body(), seal.limits.caseMs + 1000, 'unknown case settlement');
      } catch (error) { hasFailure = true; failure = error; }
      finally {
        clearTimeout(timer);
        try {
          beforeNotification = current.report();
          await bounded(current.notificationBarrier(), seal.limits.notificationMs, 'unknown owned notification retirement');
          await drain();
          afterNotification = current.report();
        } catch (error) {
          cleanupFailure = error;
          current.emergencyDestroy();
          try { await bounded(current.notificationBarrier(), seal.limits.notificationMs, 'emergency closure unknown'); await drain(); }
          catch (second) { cleanupFailure = new AggregateError([error, second], 'owned cleanup incomplete'); }
        }
        restoration = current.restore();
      }
      const member = seal.membership.find(row => row.id === test.id);
      const mechanicalHolds = [];
      if (!afterNotification?.valid || !restoration.valid || !restoration.restored || !bound.verify() || outsideProbe) mechanicalHolds.push('integrity');
      if (!afterNotification?.contexts.length) mechanicalHolds.push('no actual invocation context');
      if (afterNotification?.contexts.some(context => context.verdict !== 'PASS')) mechanicalHolds.push('invocation lifecycle HOLD');
      if (afterNotification?.resources.length !== member.createdObjects) mechanicalHolds.push('created membership differs');
      const events = afterNotification?.events ?? [];
      if (test.id === 'A57' && (events.some(row => row.event === 'host-registered') || !events.some(row => row.event === 'hook-absent'))) mechanicalHolds.push('noHook route mismatch');
      if (test.id === 'A60' && (!events.some(row => row.event === 'shell-route') || !events.some(row => row.event === 'scope-registered') || !events.some(row => row.event === 'shell-dispose-joined'))) mechanicalHolds.push('actual Shell route missing');
      if (test.id === 'H09' && !events.some(row => row.event === 'host-registered')) mechanicalHolds.push('registered host route missing');
      if (events.filter(row => row.event === 'writer-start').length !== events.filter(row => row.event === 'writer-joined').length) mechanicalHolds.push('private writer join count');
      safety = timedOut || !!cleanupFailure || mechanicalHolds.length > 0;
      const row = { kind: 'case', id: test.id, classification: 'INSTRUMENTED_AUTHOR_MECHANICAL_ONLY', passed: !hasFailure && !safety,
        semanticAssertionsInInstrumentedRun: hasFailure ? 'FAIL' : 'PASS', unmodifiedSemanticCredit: false, safety, timedOut,
        hasFailure, failure: hasFailure ? { type: failure === null ? 'null' : typeof failure, message: String(failure?.message ?? failure), stack: failure?.stack } : null,
        cleanupFailure: cleanupFailure?.stack, mechanicalHolds, observations: environment.observations,
        beforeNotification, afterNotification, restoration, elapsedMs: Number(process.hrtime.bigint() - start) / 1e6 };
      results.push(row); await emit(row); current = undefined;
      if (safety) break;
    }
  } finally {
    if (current) {
      current.emergencyDestroy();
      try { await bounded(current.notificationBarrier(), 5000, 'final owned closure'); await drain(); }
      finally { current.restore(); }
    }
    if (!bound.verify()) safety = true;
    bound.restore();
  }
  await emit({ kind: 'summary', executed: results.length, passed: results.filter(row => row.passed).length,
    failed: results.filter(row => !row.passed).length, stopped: safety, unrun: ['A57','A60','H09'].slice(results.length),
    actualStreamInstances: results.reduce((total, row) => total + (row.afterNotification?.resources.length ?? 0), 0), outsideProbe,
    unmodifiedSemanticGroups: 0, candidateContinuation: 'HELD' });
  process.exitCode = !safety && results.length === 3 && results.every(row => row.passed) ? 0 : 1;
}
