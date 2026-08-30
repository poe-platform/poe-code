import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import { createObserver } from './observer.mjs';
import { makeCases } from './cases.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const measure = (value, limit) => {
  let bytes = 0;
  const walk = item => {
    if (item === null) bytes += 4;
    else if (typeof item === 'string') bytes += Buffer.byteLength(JSON.stringify(item));
    else if (typeof item === 'number' || typeof item === 'boolean') bytes += String(item).length;
    else if (Array.isArray(item)) { bytes += 2 + Math.max(0, item.length - 1); for (const child of item) walk(child === undefined ? null : child); }
    else if (typeof item === 'object') {
      const entries = Object.entries(item).filter(([, child]) => child !== undefined);
      bytes += 2 + Math.max(0, entries.length - 1);
      for (const [key, child] of entries) { bytes += Buffer.byteLength(JSON.stringify(key)) + 1; walk(child); }
    }
    if (bytes > limit) throw new Error('PRE_SERIALIZATION_CAPTURE_RESERVATION');
  };
  walk(value); return bytes;
};
const bounded = async (promise, milliseconds, label) => {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]); }
  finally { clearTimeout(timer); }
};
const drain = async () => {
  for (let turn = 0; turn < 2; turn++) { await new Promise(resolve => process.nextTick(resolve)); await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); }
};
export async function run(packet) {
  const routes = JSON.parse(readFileSync(packet.routes)).rows;
  const originalFactory = Object.getOwnPropertyDescriptor(zlib, 'createInflate');
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, '__m1aObserver');
  assert.equal(originalObserver, undefined);
  let observer, plan, known = [], outputBytes = 0, safety = false;
  const emit = async value => {
    const line = JSON.stringify(value) + '\n'; outputBytes += Buffer.byteLength(line);
    assert.ok(outputBytes <= packet.captureBytes, 'worker aggregate capture');
    await new Promise((resolve, reject) => process.stdout.write(line, error => error ? reject(error) : resolve()));
  };
  const factory = function (...args) {
    const stream = Reflect.apply(originalFactory.value, zlib, args);
    const owned = { stream, destroy: stream.destroy, closed: false };
    known.push(owned);
    owned.closePromise = new Promise(resolve => stream.once('close', () => { owned.closed = true; resolve(); }));
    if (!observer || known.length > plan.streamCap) {
      stream.on('error', () => {}); stream.destroy(); safety = true; throw new Error('observer factory admission overflow');
    }
    observer.attach(stream);
    return stream;
  };
  Object.defineProperty(zlib, 'createInflate', { ...originalFactory, value: factory }); syncBuiltinESMExports();
  const results = [];
  try {
    const prefix = packet.source ? 'src' : 'dist', extension = packet.source ? 'ts' : 'js';
    const api = await import(pathToFileURL(join(packet.root, prefix, 'commands/git/index.' + extension)).href);
    const core = await import(pathToFileURL(join(packet.root, prefix, 'index.' + extension)).href);
    const io = await import(pathToFileURL(join(packet.root, prefix, 'commands/git/io.' + extension)).href);
    const limits = await import(pathToFileURL(join(packet.root, prefix, 'commands/git/limits.' + extension)).href);
    if (packet.mutant) assert.equal(globalThis.__reviewMutant, packet.mutant, 'actually loaded mutant sentinel');
    await emit({ kind: 'product-loaded', root: packet.root, source: packet.source, mutant: globalThis.__reviewMutant ?? null, sourceIdentity: packet.candidate });
    const records = readFileSync(packet.records); assert.equal(hash(records), packet.recordsSha256);
    const environment = { api, core, records: JSON.parse(records), observations: [], internals: { Session: io.Session, limits: limits.GIT_LIMITS }, realRoot: packet.realRoot };
    const suite = makeCases(environment).filter(row => packet.cases.includes(row.id));
    assert.deepEqual(suite.map(row => row.id), packet.cases);
    for (const test of suite) {
      const started = process.hrtime.bigint(), controller = new AbortController();
      plan = routes.find(row => row.id === test.id); observer = createObserver(plan); known = [];
      Object.defineProperty(globalThis, '__m1aObserver', { configurable: true, value: observer });
      environment.signal = controller.signal; environment.observations = [];
      let hasFailure = false, failure, timedOut = false, unknownCase = false, cleanupFailure, before, after, restored;
      const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('CASE_TIMEOUT')); }, 30000);
      try { await bounded(test.body(), 31000, 'UNKNOWN_CASE_SETTLEMENT'); }
      catch (error) { hasFailure = true; failure = error; unknownCase = error?.message === 'UNKNOWN_CASE_SETTLEMENT'; }
      finally {
        clearTimeout(timer);
        try {
          before = observer.snapshot(hasFailure);
          await bounded(Promise.all(known.map(row => row.closePromise)), 5000, 'UNKNOWN_OWNED_NOTIFICATION');
          await drain(); after = observer.snapshot(hasFailure);
          assert.ok(known.every(row => row.closed), 'all immediately enrolled factory objects close');
          assert.equal(Object.getOwnPropertyDescriptor(zlib, 'createInflate').value, factory, 'factory hook intact');
          assert.equal(globalThis.__m1aObserver, observer, 'observer binding intact');
        } catch (error) {
          cleanupFailure = error;
          for (const row of known) if (!row.closed) Reflect.apply(row.destroy, row.stream, []);
          try { await bounded(Promise.all(known.map(row => row.closePromise)), 5000, 'EMERGENCY_CLOSURE_UNKNOWN'); await drain(); }
          catch (secondary) { cleanupFailure = new AggregateError([error, secondary], 'known-owned cleanup failure'); }
        }
        restored = observer.restore();
      }
      safety ||= timedOut || unknownCase || !!cleanupFailure || after?.verdict !== 'PASS' || !restored.valid;
      const row = { kind: 'case', id: test.id, layout: packet.layout, status: hasFailure ? 'FAIL' : 'PASS', safety,
        hasFailure, error: hasFailure ? { type: failure === null ? 'null' : typeof failure, name: failure?.name, message: String(failure?.message ?? failure), stack: failure?.stack } : null,
        cleanupFailure: cleanupFailure?.stack, observations: environment.observations, lifecycle: { beforeNotification: before, afterNotification: after, trace: observer.trace(), restored },
        actualFactoryObjects: known.length, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
        privateWriterProof: 'SOURCE_LINKED_CONDITIONAL_JOIN_NOT_DYNAMIC_TIMESTAMP', unmodifiedProductModules: !packet.mutant };
      measure(row, plan.reportReserve);
      results.push({ id: row.id, status: row.status, safety: row.safety }); await emit(row);
      observer = undefined; delete globalThis.__m1aObserver;
      if (safety) break;
    }
  } finally {
    if (observer) {
      for (const row of known) if (!row.closed) Reflect.apply(row.destroy, row.stream, []);
      try { await bounded(Promise.all(known.map(row => row.closePromise)), 5000, 'FINAL_CLOSURE_UNKNOWN'); await drain(); }
      finally { observer.restore(); }
    }
    delete globalThis.__m1aObserver;
    Object.defineProperty(zlib, 'createInflate', originalFactory); syncBuiltinESMExports();
    if (packet.realRoot) {
      assert.ok(packet.realRoot.startsWith(packet.workRoot + '/real/'));
      rmSync(packet.realRoot, { recursive: true, force: true });
    }
  }
  await emit({ kind: 'summary', layout: packet.layout, expected: packet.cases.length, executed: results.length,
    passed: results.filter(row => row.status === 'PASS').length, failed: results.filter(row => row.status === 'FAIL').length,
    safety, unrun: packet.cases.slice(results.length), mutant: globalThis.__reviewMutant ?? null, realRootRemoved: true, cases: results });
  process.exitCode = safety || results.some(row => row.status === 'FAIL') || results.length !== packet.cases.length ? 1 : 0;
}
