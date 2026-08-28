import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { captureActor } from './capture-actor.mjs';
import { catalogue } from './catalogue.mjs';

const output = process.argv[2];
const approvedOutput = fileURLToPath(new URL('./runs/stub-v1/', import.meta.url));
assert.equal(output, approvedOutput);
const rows = [];
const save = (name, value) => {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  assert(bytes.length <= 1048576);
  writeFileSync(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
};
const inputFor = (actorKind, namespace) => {
  const profile = catalogue.profiles.find(row => row.actorKind === actorKind);
  const limits = Object.fromEntries(['wallMs', 'stdoutBytes', 'stderrBytes', 'metadataBytes', 'storageBytes', 'events'].map(key => [key, profile.costs[key]]));
  return { schema: 1, task: { id: `stub/${actorKind}`, recordId: profile.recordId, bindingIds: profile.bindingIds, fragmentIds: profile.fragmentIds, environment: 'SYNTHETIC_STUB_ONLY', fixtureReference: profile.fixtureReference, actorKind }, namespace, limits };
};
const raw = result => ({ ...result, local: null, localIdentityFacts: { selectedIsCaller: result.local.hasSelectedReason && Object.hasOwn(result.local, 'callerReason') && Object.is(result.local.selectedReason, result.local.callerReason), selectedIsHost: result.local.hasSelectedReason && Object.hasOwn(result.local, 'hostReason') && Object.is(result.local.selectedReason, result.local.hostReason), hasHarnessFailure: result.local.harnessFailure !== undefined } });
const step = async (id, body) => {
  const check = await body(id);
  await check();
  rows.push({ id, status: 'PASS_SYNTHETIC_ACTOR_COMPONENT_ONLY' });
};

try {
  await step('S01', async id => {
    let seenArgvBytes = null;
    const namespace = { createYqCommand: () => ({ async execute(context) { seenArgvBytes = context.args.reduce((sum, argument) => sum + Buffer.byteLength(argument), 0); return { exitCode: 0 }; } }) };
    const input = inputFor('WRK-02/above-cap', namespace);
    const foreignTask = runInNewContext(`JSON.parse(${JSON.stringify(JSON.stringify(input.task))})`);
    const result = await captureActor({ ...input, task: foreignTask });
    save(`${id}.json`, { role: 'STUB_NOT_YAML', seenArgvBytes, result: raw(result) });
    return () => { assert.equal(seenArgvBytes, 65537); assert.equal(result.capture.status, 0); assert.equal(result.capture.events.at(-1).captureComplete, true); };
  });
  await step('S02', async id => {
    let getters = 0;
    let factories = 0;
    const input = inputFor('WRK-04/at-cap', { createYqCommand() { factories++; throw new Error('not reached'); } });
    Object.defineProperty(input.task, 'recordId', { enumerable: true, get() { getters++; throw new Error('getter must not run'); } });
    let thrown;
    try { await captureActor(input); } catch (reason) { thrown = reason; }
    save(`${id}.json`, { role: 'OWN_DATA_REJECTION', getters, factories, rejected: thrown !== undefined });
    return () => { assert.equal(getters, 0); assert.equal(factories, 0); assert(thrown instanceof TypeError); };
  });
  await step('S03', async id => {
    const input = inputFor('WRK-04/at-cap', { createYqCommand() { throw new Error('not reached'); } });
    input.task.bindingIds = new Array(1);
    let thrown;
    try { await captureActor(input); } catch (reason) { thrown = reason; }
    save(`${id}.json`, { role: 'HOLE_REJECTION', rejected: thrown !== undefined });
    return () => assert(thrown instanceof TypeError);
  });
  await step('S04', async id => {
    const reason = { role: 'actual-proxy-reason' };
    const input = inputFor('WRK-04/at-cap', {});
    input.task = new Proxy(input.task, { ownKeys() { throw reason; } });
    let thrown;
    try { await captureActor(input); } catch (failure) { thrown = failure; }
    save(`${id}.json`, { role: 'THROWN_IDENTITY', sameActualReason: thrown === reason });
    return () => assert.equal(thrown, reason);
  });
  await step('S05', async id => {
    const namespace = { createYqCommand: () => ({ async execute(context) {
      const iterator = context.stdin[Symbol.asyncIterator]();
      await iterator.next(); await iterator.next(); await iterator.next(); await iterator.next();
      await iterator.return();
      await context.stdout.write(Buffer.from('STUB\n'));
      return { exitCode: 0 };
    } }) };
    const result = await captureActor(inputFor('UTF-22/producer-reuse', namespace));
    save(`${id}.json`, { role: 'STUB_REUSE_HOST_ONLY_NO_RETENTION_PROOF', result: raw(result) });
    return () => { assert.equal(result.capture.stdoutHex, '535455420a'); assert.equal(result.capture.events.filter(event => event.kind === 'producer-overwrite').length, 4); assert(result.observations.every(observation => observation.status === 'UNOBSERVED')); };
  });
  await step('S06', async id => {
    const namespace = { createYqCommand: () => ({ async execute(context) {
      const iterator = context.stdin[Symbol.asyncIterator]();
      try { return await iterator.next(); } finally { await iterator.return(); }
    } }) };
    const result = await captureActor(inputFor('LIF-02/host-observation', namespace));
    save(`${id}.json`, { role: 'STUB_NEXT_FAILURE_HOST_ONLY', result: raw(result) });
    return () => { assert.equal(result.local.selectedReason, result.local.hostReason); assert(result.capture.events.some(event => event.kind === 'iterator-return')); assert(!result.capture.events.some(event => event.kind === 'register-cleanup')); };
  });
  await step('S07', async id => {
    const namespace = { createYqCommand: () => ({ async execute(context) { try { await context.stdout.write(Buffer.alloc(16, 0x61)); } catch {} return { exitCode: 0 }; } }) };
    const input = inputFor('WRK-04/at-cap', namespace);
    input.limits.stdoutBytes = 8;
    const result = await captureActor(input);
    save(`${id}.json`, { role: 'STUB_SWALLOWS_CAPTURE_ERROR_NOT_PRODUCT', result: raw(result) });
    return () => { assert.equal(result.capture.status, 0); assert.equal(result.capture.rejected, false); assert.equal(result.capture.stdoutHex, '61'.repeat(8)); assert.equal(result.capture.events.at(-1).captureComplete, false); assert.notEqual(result.local.harnessFailure, undefined); };
  });
  await step('S08', async id => {
    const namespace = { createYqCommand: () => ({ async execute(context) {
      const iterator = context.stdin[Symbol.asyncIterator]();
      let original;
      try { await iterator.next(); } catch (reason) { original = reason; }
      try { await iterator.return(); } catch {}
      throw original;
    } }) };
    const result = await captureActor(inputFor('LIF-10/host-observation', namespace));
    save(`${id}.json`, { role: 'STUB_COOPERATIVE_HOST_ONLY', result: raw(result) });
    return () => { assert.equal(result.local.selectedReason, result.local.hostReason); assert.equal(result.local.cleanupReasons[0], result.local.cleanupReason); assert(result.capture.events.some(event => event.kind === 'late-return-release')); };
  });
  await step('S09', async id => {
    const requested = [];
    const namespace = { createYqQuerySession: () => ({ ownedWork: {
      async charge(count) { requested.push(['charge', count]); },
      reserve(count) { requested.push(['reserve', count]); return { async beforeUnit() { requested.push(['beforeUnit']); }, finish() { requested.push(['finish']); }, abandon() { requested.push(['abandon']); } }; },
    }, async close() { requested.push(['close']); } }) };
    const result = await captureActor(inputFor('WRK-22/carry-reserve-abort', namespace));
    save(`${id}.json`, { role: 'NOOP_STUB_NO_BUDGET_OR_PRODUCT_ALGORITHM', requested, result: raw(result) });
    return () => { assert.deepEqual(requested, [['charge', 1023], ['reserve', 1], ['beforeUnit'], ['abandon'], ['close']]); assert.equal(result.observations[0].facts.privateCountersObserved, false); };
  });
  await step('S10', async id => {
    const optionsKinds = [];
    const namespace = { yqCommands(options) { optionsKinds.push(options === null ? 'null' : typeof options); return { setup() {} }; } };
    const result = await captureActor(inputFor('TYP-05/options', namespace));
    save(`${id}.json`, { role: 'NOOP_FACTORY_STUB_NOT_PLUGIN_VALIDATION', optionsKinds, result: raw(result) });
    return () => { assert.deepEqual(optionsKinds, ['object', 'object', 'object', 'null']); assert.equal(result.observations[0].facts.getterReads, 0); assert.equal(result.observations[0].facts.calls.length, 4); };
  });
  save('SUMMARY.json', { schema: 1, status: 'PASS_SYNTHETIC_COMPONENT_ONLY', rows, targetExecutions: 0, compilerExecutions: 0, productAlgorithmStubs: 0, fixtureOrParserClaims: 0 });
  process.stdout.write(`synthetic actor component: ${rows.length} checks\n`);
} catch (reason) {
  save('FAILURE.json', { schema: 1, status: 'FAIL', completedRows: rows, message: typeof reason?.message === 'string' ? reason.message : 'non-message failure', targetExecutions: 0 });
  process.exitCode = 1;
}
