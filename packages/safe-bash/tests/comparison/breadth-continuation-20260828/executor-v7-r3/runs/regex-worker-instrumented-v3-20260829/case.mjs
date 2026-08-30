import fs from 'node:fs';
import { ownedWriter } from './owned-writer.mjs';
import { mutationInitial, mutateOwned, mutationReplacement } from './mutation.mjs';
import { mutationControls, writerControls } from './writer-controls.mjs';
import path from 'node:path';
import workers from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardedOperation } from './guarded-operation.mjs';
import { assess, bytes, hash, journal, own, reason, requireValue, stickyKey, witness } from './common.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const nativeWrite = fs.writeFileSync.bind(fs), nativeChmod = fs.chmodSync.bind(fs);
const configuration = JSON.parse(bytes(process.argv[2], 65536));
requireValue(hash(bytes(process.argv[2], 65536)) === process.argv[3], 'CONTROL_CONFIG_HASH');
const control = configuration.control, kind = control.kind;
process.stdout.write(JSON.stringify({ event: 'control-bootstrap', id: control.id, source: 'harmless-only' }) + '\n');
process.stderr.write('');
const parentEvents = [];
let parentBytes = 0, reserved = 0, evaluated = 0, getterCalls = 0, caught, caughtPresent = false;
const oldPrior = workers.getEnvironmentData(stickyKey);
const prior = {token: control.id + ':prior', flag: new SharedArrayBuffer(4)};
workers.setEnvironmentData(stickyKey, prior);
let witnessRejects = 0, slotRefused = false;
const malformed = [undefined, null, Object.create({token:'test',flag:new SharedArrayBuffer(4)}), {token:'other',flag:new SharedArrayBuffer(4)}, {token:'test',flag:new ArrayBuffer(4)}, {token:'test',flag:new SharedArrayBuffer(8)}, {token:'test',flag:Object.create(SharedArrayBuffer.prototype)}, {get token(){getterCalls++;return 'test';},flag:new SharedArrayBuffer(4)}];
malformed.push(Object.assign(Object.create({ inherited: true }), {token:'test',flag:new SharedArrayBuffer(4)}));
malformed.push(new Proxy({token:'test',flag:new SharedArrayBuffer(4)}, {get(){getterCalls++;throw Error('PROXY');}}));
const refusedCell = new SharedArrayBuffer(4); Atomics.store(new Int32Array(refusedCell), 0, 1); malformed.push({token:'test',flag:refusedCell});
for (const value of malformed) { try { witness(value, 'test'); } catch { witnessRejects++; } }
requireValue(witnessRejects === 11 && getterCalls === 0, 'WITNESS_NEGATIVE_SCHEMA');
const requested = () => ({ execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
const sentinels = { abort: Object.freeze({ name: 'CALLER_ABORT_SENTINEL' }) };
const emit = event => {
  const size = Buffer.byteLength(JSON.stringify(event) + '\n');
  requireValue(parentBytes + size <= 65536, 'PARENT_CAPTURE_LIMIT'); parentBytes += size;
  parentEvents.push(event);
  if (kind === 'start-publication-null' && event.event === 'start') throw null;
  if (kind === 'terminate-publication-undefined' && event.event === 'terminate-call') throw undefined;
  if (kind === 'bounded-journal-falsy-primary' && event.event === 'closed') throw undefined;
};
function wait(worker, predicate) {
  return new Promise((resolve, reject) => {
    let timer;
    const clear = () => { clearTimeout(timer); worker.off('message', message); worker.off('error', error); worker.off('exit', exit); };
    const message = value => { if (predicate(value)) { clear(); resolve(value); } };
    const error = value => { clear(); reject(value); };
    const exit = code => { clear(); reject(new Error('EARLY_WORKER_EXIT:' + code)); };
    worker.on('message', message); worker.once('error', error); worker.once('exit', exit);
    timer = setTimeout(() => { clear(); reject(new Error('STUB_WAIT_TIMEOUT')); }, 5000);
  });
}
async function runWorker(Constructor, action = 'normal') {
  const worker = new Constructor(new URL(configuration.entry), requested());
  try {
    await wait(worker, value => value.kind === 'ready');
    const result = wait(worker, value => value.kind === 'result');
    worker.postMessage({ action });
    const value = await result;
    requireValue(value.value === 42, 'STUB_ACTUAL_RESULT'); evaluated++;
  } finally { await worker.terminate(); }
}
const mutation = mutationInitial();
const mutationChecks = mutationControls();
let writerChecks = null;
const mutationOwner = ownedWriter({root:configuration.fixtureRoot,entries:[{path:fileURLToPath(configuration.entry),kind:'replace',mode:0o644,maximum:65536}],role:'HARMLESS_FIXTURE'});
const modifications = { role: 'PRESEALED_HARMLESS_CONTROL' };
if (kind === 'after-admission-drift') modifications.beforeNative = () => mutateOwned(mutationOwner,fileURLToPath(configuration.entry),configuration.originalWorker,mutationReplacement,mutation);
if (kind === 'loaded-source-drift') modifications.childFault = 'loaded-source';
if (kind === 'child-publication') modifications.childFault = 'publication';
if (kind === 'constructor-unknown-data') {
  modifications.beforeNative = Constructor => { try { new Constructor(new URL(configuration.entry), requested()); } catch (error) { slotRefused = error.code === 'WITNESS_SLOT_BUSY'; } };
  modifications.constructorFailure = { reason: undefined };
}
if (kind === 'startup-failure') modifications.childFault = 'startup';
if (kind === 'preload-drift') configuration.tools = configuration.tools.map(row => row.url === configuration.preload ? { ...row, sha256: '0'.repeat(64) } : row);
const operation = await guardedOperation({
  view: configuration.view,
  configuration: { profile: { kind: 'HARMLESS', root: configuration.fixtureRoot, control: control.id }, entry: configuration.entry, members: configuration.members, tools: configuration.tools, preload: configuration.preload, offline: configuration.offline, directory: configuration.directory, operation: control.id, maximumStarts: kind === 'zero-allowance' ? 0 : 8, emit, reserve: count => { requireValue(reserved + count <= 8 * 98304, 'CASE_EVIDENCE_RESERVE'); reserved += count; }, control: modifications },
  emit,
  body: async Constructor => {
    if (kind.startsWith('allocation-') || kind === 'historical-fail-data') return;
    if (kind === 'parent-hash-only') return;
    if (kind === 'eight-starts' || kind === 'ninth-start') {
      for (let ordinal = 0; ordinal < 8; ordinal++) await runWorker(Constructor, kind === 'ninth-start' && ordinal === 0 ? 'recursive' : 'normal');
      if (kind === 'ninth-start') { try { new Constructor(new URL(configuration.entry), requested()); } catch (error) { caughtPresent = true; caught = error; } }
      return;
    }
    if (kind === 'second-active') {
      const worker = new Constructor(new URL(configuration.entry), requested());
      try { await wait(worker, value => value.kind === 'ready'); try { new Constructor(new URL(configuration.entry), requested()); } catch (error) { caughtPresent = true; caught = error; } }
      finally { await worker.terminate(); }
      return;
    }
    if (kind === 'caller-abort') {
      const worker = new Constructor(new URL(configuration.entry), requested());
      try { await wait(worker, value => value.kind === 'ready'); throw sentinels.abort; }
      finally { await worker.terminate(); }
    }
    if (kind === 'bounded-journal-falsy-primary') {
      writerChecks = writerControls(configuration.directory);
      await runWorker(Constructor);
      const name = path.join(configuration.directory, 'bounded.jsonl');
      const owner=ownedWriter({root:configuration.directory,entries:[{path:name,kind:'create',mode:0o600,maximum:32}]});
      try{owner.write(name,Buffer.alloc(0));}finally{owner.close();}
      const writer = journal(name, 32);
      try { let denied = false; try { writer.emit({ value: 'x'.repeat(64) }); } catch (error) { denied = error.code === 'JOURNAL_BOUND'; } requireValue(denied, 'BYTE_LIMIT_PREDICATE'); }
      finally { writer.close(); }
      throw false;
    }
    const directKinds = new Set(['hash-drift','mode-drift','symlink','url-forged','url-getter-proxy','url-query','url-fragment','url-percent','url-outside','options-inherited','options-accessor','options-extra','options-limit','url-data','options-eval','options-argv','url-string','url-foreign','caught-parent','zero-allowance','preload-drift','caller-preload']);
    if (directKinds.has(kind)) {
      let entry = new URL(configuration.entry), value = requested();
      if (kind === 'url-forged') entry = Object.create(URL.prototype);
      if (kind === 'url-getter-proxy') {
        const bad = { get href() { getterCalls++; throw new Error('GETTER_EXECUTED'); } };
        for (const input of [bad, new Proxy(entry, { get() { getterCalls++; throw new Error('PROXY_EXECUTED'); } })]) { try { new Constructor(input, value); } catch (error) { caughtPresent = true; caught = error; } }
        return;
      }
      if (kind === 'url-query') entry.search = '?x=1';
      if (kind === 'url-fragment') entry.hash = '#x';
      if (kind === 'url-percent') entry = new URL(configuration.entry.replace('worker.mjs', '%77orker.mjs'));
      if (kind === 'url-outside') entry = new URL('file:///outside/worker.mjs');
      if (kind === 'url-foreign') entry = new URL('./foreign.mjs', configuration.entry);
      if (kind === 'url-data') entry = new URL('data:text/javascript,0');
      if (kind === 'url-string') entry = fileURLToPath(configuration.entry);
      if (kind === 'options-inherited') value = Object.create(value);
      if (kind === 'options-accessor') value = { get execArgv() { getterCalls++; return []; }, resourceLimits: value.resourceLimits };
      if (kind === 'options-extra') value.extra = true;
      if (kind === 'options-limit') value.resourceLimits.stackSizeMb = 5;
      if (kind === 'options-eval') value.eval = true;
      if (['options-argv','caller-preload'].includes(kind)) value.execArgv = ['--import', configuration.preload];
      if (kind === 'caught-parent') entry = 'wrong';
      try { new Constructor(entry, value); } catch (error) { caughtPresent = true; caught = error; }
      return;
    }
    const action = ['import-escape','caught-nested','sticky-zero-exit-assessment','source-fallback'].includes(kind) ? 'escape' : kind === 'builtin-escape' ? 'builtin' : kind === 'recursive-worker' ? 'recursive' : 'normal';
    await runWorker(Constructor, action);
  },
});

mutationOwner.close();
const failures = [];
const check = (value, name) => { if (!value) failures.push(name); };
check(operation.receipt.created === control.workers, 'EXACT_WORKER_COUNT');
check(operation.knownRetired, 'ALL_ACTUAL_WORKERS_RETIRED');
check(getterCalls === 0, 'NO_GETTER_OR_PROXY_TRAP');
check(workers.getEnvironmentData(stickyKey) === prior, 'ENVIRONMENT_DATA_RESTORED');
workers.setEnvironmentData(stickyKey, oldPrior);
check(witnessRejects === 11, 'ELEVEN_WITNESS_SCHEMA_NEGATIVES');
if (kind === 'constructor-unknown-data') check(slotRefused, 'REENTRANT_SLOT_DENIED_RESTORED_ON_UNDEFINED');
if (kind === 'ninth-start') check(operation.receipt.rows[0]?.sticky === 1 && operation.receipt.rows.slice(1).every(row => row.sticky === 0), 'CROSS_WORKER_STICKY_ISOLATION');
let assessed = operation.assessment;
const mutable = structuredClone(operation.receipt);
if (kind === 'missing-witness') mutable.rows[0].witnesses = mutable.rows[0].witnesses.filter(event => !(event.event === 'load' && event.role === 'product' && event.url.endsWith('/matching.mjs')));
if (kind === 'duplicate-token') { const row = mutable.rows[0].witnesses.find(event => event.event === 'load' && event.role === 'product'); mutable.rows[0].witnesses.push({ ...row, token: 'foreign' }); }
if (kind === 'missing-exit-assessment') mutable.rows[0].exited = false;
if (kind === 'sticky-zero-exit-assessment') mutable.rows[0].exitCode = 0;
if (kind === 'parent-hash-only') {
  mutable.attempts = 1; mutable.created = 1;
  mutable.rows = [{ token: control.id + ':1', entry: configuration.entry, requested: requested(), effective: { ...requested(), execArgv: ['--import', configuration.preload] }, exited: true, exitCode: 0, terminateCalls: 1, terminatePending: 0, terminateErrors: [], terminateResults: [{type:'number',value:0}], emergency: false, sticky: 0, witnesses: [], expected: configuration.members, errors: [] }];
}
if (['missing-witness','duplicate-token','missing-exit-assessment','sticky-zero-exit-assessment','parent-hash-only'].includes(kind)) assessed = assess(mutable, { entry: configuration.entry, members: configuration.members, maximumStarts: 8, operation: control.id });
if (kind === 'constructor-unknown-data') {
  mutable.closed = false;
  let refused = false;
  try { assess(mutable, { entry: configuration.entry, members: configuration.members, maximumStarts: 8, operation: control.id }); }
  catch (error) { refused = error.code === 'RECEIPT_SCHEMA'; }
  check(refused, 'DESIGNATED_UNKNOWN_RECEIPT_REFUSAL');
  assessed = { qualified: false, unknownReceiptRefused: refused, actualNativeConstructorEntered: false };
}
const positive = new Set(['positive','moved','url-positive','options-positive','eight-starts','four-loads','natural-cleanup','effective-argv']);
if (kind === 'allocation-unknown-data') check(!Object.hasOwn({ size: 2048 }, 'allocatedBytes'), 'UNKNOWN_NOT_ZERO');
else if (kind === 'allocation-zero-data') check(({ allocatedBytes: 0 }).allocatedBytes === 0, 'ZERO_KNOWN');
else if (kind === 'allocation-known-data') check(({ allocatedBytes: 4096, size: 2048 }).allocatedBytes !== 2048, 'NO_LOGICAL_ALLOCATION_INFERENCE');
else if (kind === 'historical-fail-data') check(configuration.historicalDUMismatches === 2, 'HISTORICAL_FAILS_UNCHANGED');
else check(assessed.qualified === positive.has(kind), 'DESIGNATED_QUALIFICATION_PREDICATE');
if (kind === 'four-loads') check(operation.receipt.rows[0].witnesses.filter(row => row.event === 'load' && row.role === 'product').length === 4, 'ACTUAL_FOUR_LOADS');
if (kind === 'effective-argv') check(operation.receipt.rows[0].requested.execArgv.length === 0 && operation.receipt.rows[0].effective.execArgv.length === 2, 'REQUESTED_EFFECTIVE_DISTINCT');
if (kind === 'start-publication-null') check(operation.receipt.primaryPresent && operation.receipt.primary.type === 'null', 'NULL_PRIMARY');
if (kind === 'terminate-publication-undefined') check(operation.receipt.primaryPresent && operation.receipt.primary.type === 'undefined', 'UNDEFINED_PRIMARY');
if (kind === 'bounded-journal-falsy-primary') check(operation.receipt.primaryPresent && operation.receipt.primary.type === 'boolean' && operation.receipt.primary.value === false && operation.receipt.cleanup.some(row => row.reason.type === 'undefined'), 'FALSE_PRIMARY_LATER_UNDEFINED');
if (kind === 'caller-abort') check(operation.primaryPresent && operation.rawPrimary === sentinels.abort, 'CALLER_REASON_IDENTICAL');
delete operation.rawPrimary;
const result = { schema: 'HARMLESS_REGEX_CONTROL_V3', id: control.id, kind, pass: failures.length === 0, failures, created: operation.receipt.created, knownRetired: operation.knownRetired, evaluated, mutation, mutationChecks, writerChecks, mutationWriter:mutationOwner.receipt(), witnessRejects, slotRefused, caughtPresent, caught: reason(caught), parentBytes, reserved, parentEvents, operation, assessed, actualProductExecutions: 0, harmlessFixturesOnly: true };
const serialized = Buffer.from(JSON.stringify(result) + '\n');
requireValue(serialized.length <= 262144, 'CONTROL_RECEIPT_BOUND');
nativeWrite(path.join(configuration.directory, 'RESULT.json'), serialized, { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ id: control.id, pass: result.pass, failures, created: result.created, knownRetired: result.knownRetired, resultBytes: serialized.length, resultSha256: hash(serialized) }) + '\n');
process.exitCode = result.pass ? 0 : 1;
