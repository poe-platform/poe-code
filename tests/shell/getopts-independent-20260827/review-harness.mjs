import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setImmediate as immediate, setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { semanticControls } from './semantic-controls.mjs';

const candidateUrl = pathToFileURL(process.env.REVIEW_MODULE).href;
const api = await import(candidateUrl);
const { createGetoptsState: fresh, cloneGetoptsState: clone, withGetoptsIndex: at, scanGetopts: scan } = api;
const selection = new Set((process.env.REVIEW_SELECT ?? '').split(',').filter(Boolean));
const results = [];
const normalWork = { maxArguments: 64, maxBytes: 4096, maxSteps: 16384, yieldEvery: 16, checkpoint: () => {} };
const options = (work = {}, reportErrors = true) => ({ reportErrors, work: { ...normalWork, ...work } });
const inspectError = (error) => error instanceof Error ? { name: error.name, code: error.code, message: error.message, stack: error.stack } : { value: error, type: typeof error };
const settle = async (operation) => { try { return { ok: true, value: await operation() }; } catch (reason) { return { ok: false, reason }; } };
const capture = async (id, operation) => {
  if (selection.size && !selection.has(id.split('/')[0])) return;
  const started = performance.now();
  const outcome = await settle(operation);
  results.push({ id, status: outcome.ok ? 'pass' : 'fail', milliseconds: performance.now() - started,
    ...(outcome.ok ? { detail: outcome.value ?? null } : { error: inspectError(outcome.reason) }) });
};
const bounded = async (promise, label) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`watchdog: ${label}`)), 2000); })]); }
  finally { clearTimeout(timer); }
};
const gate = () => { let resolve; let reject; const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; }); return { promise, resolve, reject }; };
const immutable = (state) => { if (state.active) Object.freeze(state.active); return Object.freeze(state); };
const next = (state = fresh(), optstring = 'pqr', args = ['-pqr'], work = {}) => scan(state, optstring, Object.freeze([...args]), options(work));
const expectCode = async (code, operation) => {
  const outcome = await settle(operation);
  assert.equal(outcome.ok, false, `expected ${code} rejection`);
  assert.equal(outcome.reason?.code, code);
  assert.equal(outcome.reason?.name, 'GetoptsError');
  return outcome.reason;
};
const rejectScan = async (code, optstring = 'p', args = ['-p'], work = {}, state = fresh(), suppliedOptions) => {
  const before = structuredClone(state);
  await expectCode(code, () => scan(state, optstring, args, suppliedOptions ?? options(work)));
  assert.deepEqual(state, before);
  assert.deepEqual(await next(state), await next(clone(state)));
};
const reasons = () => [{ sentinel: 'reason' }, false, 0, '', null];
const postP = async () => (await next()).state;

for (const control of semanticControls) {
  if (selection.size && !selection.has(control.id)) continue;
  let state = fresh();
  let ordinal = 0;
  for (const operation of control.operations) {
    if (operation.operation === 'index') { state = at(state, operation.value); continue; }
    await capture(`${control.id}/${++ordinal}`, async () => {
      const before = structuredClone(state);
      immutable(state);
      const result = await scan(state, operation.optstring, Object.freeze([...operation.args]), options({}, operation.reportErrors));
      assert.deepEqual(state, before);
      assert.notEqual(result.state, state);
      state = result.state;
      const { state: ignored, ...projection } = result;
      assert.deepEqual(projection, operation.expected);
      return { expected: operation.expected, actual: projection, state: result.state };
    });
  }
}

await capture('P01/fresh', async () => {
  const left = fresh(); const right = fresh(); assert.notEqual(left, right); assert.equal(left.index, 0); assert.equal(right.index, 0);
  for (const state of [left, right]) { const before = structuredClone(state); const result = await next(immutable(state)); assert.equal(result.option, 'p'); assert.equal(result.optind, 1); assert.notEqual(result.state, state); assert.deepEqual(state, before); }
});
await capture('P02/clones', async () => {
  const parent = await postP(); const left = clone(parent); const right = clone(parent);
  assert.notEqual(left, parent); assert.notEqual(left.active, parent.active); assert.notEqual(left.active, right.active);
  const second = await next(left); assert.equal(second.option, 'q'); assert.equal((await next(second.state)).option, 'r');
  assert.equal((await next(right)).option, 'q'); assert.equal((await next(parent)).option, 'q');
});
await capture('P03/reset-clones', async () => {
  const parent = await postP(); const before = structuredClone(parent);
  assert.equal((await next(at(clone(parent), 1))).option, 'p');
  assert.equal((await next(clone(parent))).option, 'q');
  const jumped = await next(at(parent, 2)); assert.equal(jumped.option, 'q'); assert.equal(jumped.optind, 2); assert.deepEqual(parent, before);
});
for (const [ordinal, value] of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined, {}].entries()) {
  await capture(`P04/${ordinal}`, async () => { const state = immutable(await postP()); const before = structuredClone(state); await expectCode('INVALID_INPUT', () => at(state, value)); assert.deepEqual(state, before); });
}
for (const [ordinal, state] of [null, undefined, {}, { index: NaN }, { index: 0.5 }, { index: 1, active: { argument: -1, offset: 1 } }, { index: 1, active: { argument: 0, offset: 0 } }, { index: 1, active: null }].entries()) {
  await capture(`P05/${ordinal}`, async () => { await expectCode('INVALID_INPUT', () => clone(state)); await expectCode('INVALID_INPUT', () => scan(state, 'p', ['-p'], options())); });
}
for (const [ordinal, [spec, args]] of [[1, ['-p']], ['p', {}], ['p', [1]], ['p', new Array(2)]].entries()) await capture(`P06/${ordinal}`, () => rejectScan('INVALID_INPUT', spec, args));
for (const [ordinal, [spec, args]] of [['p\0', ['-p']], ['p', ['-p\0']], ['q:', ['-q', 'x\0']], ['p', ['-p', 'x\0']]].entries()) await capture(`P07/${ordinal}`, () => rejectScan('INVALID_INPUT', spec, args));
for (const [ordinal, character] of ['é', '🧪', '\ud800'].entries()) await capture(`P08/${ordinal}`, () => rejectScan('NON_ASCII_OPTION', `p${character}`));
await capture('P09/selected-only', async () => { const first = await next(fresh(), 'p', ['-pé']); assert.equal(first.option, 'p'); assert.equal(first.optind, 1); await rejectScan('NON_ASCII_OPTION', 'p', ['-pé'], {}, first.state); });
for (const [ordinal, character] of ['é', '🧪'].entries()) await capture(`P10/${ordinal}`, async () => {
  await rejectScan('NON_ASCII_OPTION', 'p', [`-${character}`]);
  for (const args of [[`-q${character}`], ['-q', character]]) assert.deepEqual((await next(fresh(), 'q:', args)).argument, { kind: 'set', value: character });
});
for (const spec of ['p', '?p', 'p:?', ':p', ':?p']) for (const character of ['?', ':']) await capture(`P11/${spec}/${character}`, async () => {
  const result = await next(fresh(), spec, [`-${character}`]); assert.equal(result.kind, 'unknown-option'); assert.equal(result.status, 0);
  assert.deepEqual(result.argument, spec.startsWith(':') ? { kind: 'set', value: character } : { kind: 'unset' });
});
for (const field of ['maxArguments', 'maxBytes', 'maxSteps', 'yieldEvery']) for (const [ordinal, value] of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '8', null, undefined].entries()) {
  await capture(`P12/${field}/${ordinal}`, async () => { const work = { ...normalWork, [field]: value }; if (value === undefined) delete work[field]; await rejectScan('INVALID_INPUT', 'p', ['-p'], {}, fresh(), { reportErrors: true, work }); });
}
await capture('P12/yield-zero', () => rejectScan('INVALID_INPUT', 'p', ['-p'], { yieldEvery: 0 }));
await capture('P13/cardinality', async () => { await next(fresh(), 'p', ['-p'], { maxArguments: 1 }); await rejectScan('ARGUMENT_LIMIT', 'p', ['-p'], { maxArguments: 0 }); assert.equal((await next(fresh(), '', [], { maxArguments: 0 })).kind, 'end'); });
await capture('P14/admission', async () => { let checkpoints = 0; await rejectScan('ARGUMENT_LIMIT', 'p', new Array(100000), { maxArguments: 0, checkpoint: () => { checkpoints++; }, yieldEvery: 1 }); assert.equal(checkpoints, 0); });
await capture('P15/bytes', async () => { await next(fresh(), 'p', ['-p'], { maxBytes: 3 }); await rejectScan('BYTE_LIMIT', 'p', ['-p'], { maxBytes: 2 }); assert.equal((await next(fresh(), '', [], { maxBytes: 0 })).kind, 'end'); });
for (const [ordinal, [value, bytes]] of [['é', 6], ['🧪', 8], ['\ud800', 7], ['\udc00', 7]].entries()) await capture(`P16/${ordinal}`, async () => {
  assert.deepEqual((await next(fresh(), 'q:', ['-q', value], { maxBytes: bytes })).argument, { kind: 'set', value });
  await rejectScan('BYTE_LIMIT', 'q:', ['-q', value], { maxBytes: bytes - 1 });
});
for (const [ordinal, first] of ['operand', '-p'].entries()) await capture(`P17/${ordinal}`, () => rejectScan('BYTE_LIMIT', 'p', [first, 'x'.repeat(1000)], { maxBytes: 100 }));
for (const cap of [0, 1, 2]) await capture(`P18/${cap}`, async () => {
  const charges = []; const operation = () => next(fresh(), '', [], { maxSteps: cap, yieldEvery: 1, checkpoint: (steps) => { charges.push(steps); } });
  if (cap < 2) await expectCode('STEP_LIMIT', operation); else { assert.equal((await operation()).kind, 'end'); assert.deepEqual(charges, [1, 1]); }
  assert(charges.reduce((total, steps) => total + steps, 0) <= cap);
});
await capture('P19/short-cap', () => rejectScan('STEP_LIMIT', 'p', ['-p'], { maxSteps: 6, yieldEvery: 3 }));
for (const [interval, expected] of [[3, [3, 3, 1]], [1, [1, 1, 1, 1, 1, 1, 1]], [100, [7]]]) await capture(`P19/${interval}`, async () => {
  const charges = []; await next(fresh(), 'p', ['-p'], { maxSteps: 7, yieldEvery: interval, checkpoint: (steps) => { charges.push(steps); } }); assert.deepEqual(charges, expected);
});
for (const location of ['spec', 'arg']) await capture(`P20/${location}`, async () => {
  const text = 'p'.repeat(1024 * 1024); const charges = [];
  await rejectScan('STEP_LIMIT', location === 'spec' ? text : 'p', location === 'arg' ? [text] : ['-p'], { maxBytes: 2 ** 22, maxSteps: 4, yieldEvery: 1, checkpoint: (steps) => { charges.push(steps); } }); assert(charges.reduce((total, steps) => total + steps, 0) <= 4);
});
await capture('P21/reuse-and-index', async () => {
  const charges = []; const controls = options({ maxSteps: 7, checkpoint: (steps) => { charges.push(steps); } });
  const first = await scan(fresh(), 'p', ['-p'], controls); const second = await scan(fresh(), 'p', ['-p'], controls); assert.deepEqual(first, second); assert.deepEqual(charges, [7, 7]);
  const totals = []; for (const index of [2, Number.MAX_SAFE_INTEGER]) { let total = 0; const result = await next(at(fresh(), index), 'p', ['-p'], { checkpoint: (steps) => { total += steps; } }); assert.equal(result.optind, 2); totals.push(total); } assert.equal(totals[0], totals[1]);
});
await capture('P22/awaited-gates', async () => {
  const admission = gate(); const final = gate(); const entered = gate(); const finalEntered = gate(); let calls = 0; let complete = false;
  const operation = next(fresh(), '', [], { yieldEvery: 1, checkpoint: () => { calls++; if (calls === 1) { entered.resolve(); return admission.promise; } finalEntered.resolve(); return final.promise; } }).then((value) => { complete = true; return value; });
  try { await bounded(entered.promise, 'first checkpoint'); await immediate(); assert.equal(complete, false); assert.equal(calls, 1); admission.resolve(); await bounded(finalEntered.promise, 'last checkpoint'); await immediate(); assert.equal(complete, false); final.resolve(); assert.equal((await bounded(operation, 'gated call')).kind, 'end'); }
  finally { admission.resolve(); final.resolve(); await settle(() => operation); }
});
for (const [ordinal, reason] of reasons().entries()) for (const position of ['initial', 'final']) for (const style of ['throw', 'reject']) await capture(`P23/${ordinal}/${position}/${style}`, async () => {
  const state = immutable(await postP()); const before = structuredClone(state);
  const checkpoint = () => { if (style === 'throw') throw reason; return Promise.reject(reason); };
  const outcome = await settle(() => next(state, 'pqr', ['-pqr'], { yieldEvery: position === 'initial' ? 1 : 100, checkpoint }));
  assert.equal(outcome.ok, false); assert(Object.is(outcome.reason, reason)); assert.deepEqual(state, before); assert.equal((await next(state)).option, 'q');
});
for (const [ordinal, reason] of [...reasons(), undefined].entries()) await capture(`P24/${ordinal}`, async () => {
  const controller = new AbortController(); controller.abort(reason); let calls = 0; const state = immutable(await postP()); const before = structuredClone(state);
  const outcome = await settle(() => next(state, 'pqr', ['-pqr'], { signal: controller.signal, yieldEvery: 1, checkpoint: () => { calls++; } }));
  assert.equal(outcome.ok, false); assert(Object.is(outcome.reason, controller.signal.reason)); assert.equal(calls, 0); assert.deepEqual(state, before); assert.equal((await next(state)).option, 'q');
});
for (const [ordinal, reason] of [...reasons(), undefined].entries()) await capture(`P25/${ordinal}`, async () => {
  const controller = new AbortController(); const pending = gate(); const entered = gate(); let calls = 0; const state = immutable(await postP()); const before = structuredClone(state);
  const outcomePromise = settle(() => next(state, 'pqr', ['-pqr'], { signal: controller.signal, yieldEvery: 1, checkpoint: () => { calls++; entered.resolve(); return pending.promise; } }));
  try { await bounded(entered.promise, 'abort gate'); controller.abort(reason); const outcome = await bounded(outcomePromise, 'pending checkpoint cancellation'); assert.equal(outcome.ok, false); assert(Object.is(outcome.reason, controller.signal.reason)); assert.equal(calls, 1); assert.deepEqual(state, before); assert.equal((await next(state)).option, 'q'); }
  finally { pending.resolve(); await bounded(outcomePromise, 'released abort gate'); }
});
for (const action of ['resolve', 'reject']) await capture(`P26/${action}`, async () => {
  const controller = new AbortController(); const pending = gate(); const entered = gate(); let calls = 0; const unhandled = []; const listener = (reason) => { unhandled.push(reason); };
  process.on('unhandledRejection', listener);
  const outcomePromise = settle(() => next(fresh(), 'p', ['-p'], { signal: controller.signal, yieldEvery: 1, checkpoint: () => { calls++; entered.resolve(); return pending.promise; } }));
  try { await bounded(entered.promise, 'late callback'); controller.abort(false); const outcome = await bounded(outcomePromise, 'late callback abort'); assert.equal(outcome.ok, false); assert.equal(outcome.reason, false); pending[action](new Error('late callback rejection')); await immediate(); await immediate(); assert.deepEqual(unhandled, []); assert.equal(calls, 1); }
  finally { pending.resolve(); await bounded(outcomePromise, 'late callback cleanup'); process.removeListener('unhandledRejection', listener); }
});
for (const position of ['initial', 'final', 'final-microtask']) await capture(`P27/${position}`, async () => {
  const controller = new AbortController(); const reason = { at: position }; const state = immutable(await postP()); const before = structuredClone(state);
  const checkpoint = () => { if (position !== 'final-microtask') { controller.abort(reason); return; } return Promise.resolve().then(() => { queueMicrotask(() => queueMicrotask(() => controller.abort(reason))); }); };
  const outcome = await settle(() => next(state, 'pqr', ['-pqr'], { signal: controller.signal, yieldEvery: position === 'initial' ? 1 : 100, checkpoint }));
  assert.equal(outcome.ok, false); assert.equal(outcome.reason, reason); assert.deepEqual(state, before);
});
await capture('P28/task-yield', async () => {
  const controller = new AbortController(); let calls = 0; let charges = 0; let timerFired = false; const timer = setTimeout(() => { timerFired = true; controller.abort('timer'); }, 0);
  try { const outcome = await bounded(settle(() => next(fresh(), 'p', ['p'.repeat(1024 * 1024)], { signal: controller.signal, maxBytes: 2 ** 22, maxSteps: 2 ** 23, yieldEvery: 8, checkpoint: async (steps) => { calls++; charges += steps; await immediate(); } })), 'task yielding'); assert.equal(outcome.ok, false); assert.equal(outcome.reason, 'timer'); assert(timerFired); assert(charges < 1024 * 1024); return { calls, charges, timerFired }; }
  finally { clearTimeout(timer); }
});
for (const mode of ['success', 'validation', 'limit', 'callback', 'abort']) await capture(`P29/${mode}`, async () => {
  const controller = new AbortController(); const hostListener = () => {}; controller.signal.addEventListener('abort', hostListener); const baseline = getEventListeners(controller.signal, 'abort');
  try { for (let repetition = 0; repetition < 3; repetition++) {
    const checkpoint = () => { if (mode === 'callback') return Promise.reject('callback'); if (mode === 'abort') controller.abort('abort'); };
    await settle(() => next(fresh(), mode === 'validation' ? 'p\0' : 'p', ['-p'], { signal: controller.signal, checkpoint, yieldEvery: 1, maxSteps: mode === 'limit' ? 2 : 100 }));
    assert.deepEqual(getEventListeners(controller.signal, 'abort'), baseline);
  } } finally { controller.signal.removeEventListener('abort', hostListener); }
});
await capture('P30/concurrent-input', async () => {
  const state = immutable(await postP()); const before = structuredClone(state); const left = gate(); const right = gate(); const leftEntered = gate(); const rightEntered = gate(); const controller = new AbortController();
  const failed = settle(() => next(state, 'pqr', ['-pqr'], { signal: controller.signal, checkpoint: () => { leftEntered.resolve(); return left.promise; } }));
  const successful = next(state, 'pqr', ['-pqr'], { checkpoint: () => { rightEntered.resolve(); return right.promise; } });
  try { await bounded(Promise.all([leftEntered.promise, rightEntered.promise]), 'concurrent gates'); controller.abort(0); const failure = await bounded(failed, 'concurrent abort'); assert.equal(failure.ok, false); assert.equal(failure.reason, 0); right.resolve(); assert.equal((await bounded(successful, 'concurrent success')).option, 'q'); assert.equal((await next(state)).option, 'q'); assert.deepEqual(state, before); }
  finally { left.resolve(); right.resolve(); await bounded(Promise.all([failed, successful]), 'concurrent cleanup'); }
});
const malformed = [undefined, null, {}, { work: normalWork }, { reportErrors: 0, work: normalWork }, { reportErrors: '0', work: normalWork }, { reportErrors: true }, { reportErrors: true, work: null }, options({ checkpoint: undefined }), options({ checkpoint: 1 }), options({ signal: { aborted: false } })];
for (const [ordinal, supplied] of malformed.entries()) await capture(`P31/${ordinal}`, async () => { const state = fresh(); const before = structuredClone(state); await expectCode('INVALID_INPUT', () => scan(state, 'p', ['-p'], supplied)); assert.deepEqual(state, before); assert.equal((await next(state)).option, 'p'); });
await capture('P32/purity', async () => {
  const text = await readFile(process.env.REVIEW_SOURCE_DATA, 'utf8');
  assert(!/\b(?:import|require|fetch|process|console|globalThis)\b/.test(text));
  assert.deepEqual(Object.keys(api).sort(), ['GetoptsError', 'cloneGetoptsState', 'createGetoptsState', 'scanGetopts', 'withGetoptsIndex']);
  const result = await next(); assert.equal(result.option, 'p');
  return { sourceImports: 0, injectedHostCapabilities: ['checkpoint', 'AbortSignal'], noRuntimeBindingAcceptance: true };
});

const bytes = await readFile(process.env.REVIEW_MODULE);
const output = { module: { url: candidateUrl, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mode: process.env.REVIEW_MODE },
  counts: { total: results.length, pass: results.filter((result) => result.status === 'pass').length, fail: results.filter((result) => result.status === 'fail').length }, results };
await writeFile(process.env.REVIEW_OUTPUT, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(output.counts));
process.exitCode = output.counts.fail ? 1 : 0;
