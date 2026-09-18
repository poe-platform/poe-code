import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import type { PlaywrightAbilityRequest } from '../../src/playwright/abilities.js';
import { evaluateNativeExpression } from '../../src/playwright/native-evaluation.js';
import { playwrightStandardAbilities } from '../../src/playwright/standard-capabilities.js';

function fixture() {
  const realm = createContext({});
  const events: string[] = [];
  const cleanups: (() => Promise<void>)[] = [];
  const invoke = async (callback: Function, args: unknown[]) => { realm.input = args; return runInContext(`(${callback.toString()})(...input)`, realm); };
  const capture = async (callback: Function, input: unknown) => {
    assert.equal(cleanups.length, 1);
    events.push('acquire');
    const capsule = await invoke(callback, [input]);
    return { async evaluate(callback: Function, input: unknown) { events.push('serialize'); return invoke(callback, [capsule, input]); }, async dispose() { events.push('dispose'); } };
  };
  const page = { url: () => 'https://fixture.example/', evaluateHandle: capture };
  const context = { pages: () => [page] };
  const request: PlaywrightAbilityRequest = {
    command: 'eval', session: 'owner', args: ['1 + 2'], options: {}, signal: new AbortController().signal,
    limits: { maxCommandBytes: 1048576, maxArtifactBytes: 1048576 },
    browserSession: { context: context as never, page: page as never, async resolveTarget() { throw new Error('Unused'); }, async selectPage() {}, registerCleanup: cleanup => cleanups.push(cleanup) },
    async write() { throw new Error('No output before response'); }, async readFile() { throw new Error('No file reads'); }, async writeArtifact() { throw new Error('Result hook belongs to capability'); }, registerCleanup: cleanup => cleanups.push(cleanup),
  };
  return { request, page, context, events, cleanups, capture };
}

test('native expression helper preserves pinned transport normalization before pretty JSON', async () => {
  for (const [expression, expected] of [
    ['1 + 2', '3'], ['() => ({ answer: 42 })', '{\n  "answer": 42\n}'], ['async () => undefined', 'undefined'],
    ['({toJSON(){return 1}})', '{\n  "toJSON": {}\n}'], ['new Error("value")', '{\n  "name": "Error"\n}'],
    ['new Date(NaN)', '"1970-01-01T00:00:00.000Z"'], ['Object.create({toJSON(){return 42}})', '42'],
    ['({get broken(){throw new Error("getter")},okay:2})', '{\n  "okay": 2\n}'],
  ]) {
    const state = fixture();
    assert.equal((await evaluateNativeExpression({ ...state.request, args: [expression!] }))?.text, expected);
    assert.deepEqual(state.events, ['acquire', 'serialize', 'dispose']);
  }
});

test('bounded native helper retains errors as admitted text rather than unbounded native exceptions', async () => {
  for (const [expression, expected] of [['Promise.reject("bad")', 'bad'], ['1n', 'Do not know how to serialize a BigInt']]) {
    const state = fixture();
    const result = await evaluateNativeExpression({ ...state.request, args: [expression!] });
    assert.equal(result?.status, 'error');
    assert.equal(result?.text, expected);
  }
  const state = fixture();
  await assert.rejects(evaluateNativeExpression({ ...state.request, args: ['Promise.reject("世".repeat(500))'], limits: { maxCommandBytes: 128, maxArtifactBytes: 128 } }), /byte.*limit/);
  assert.equal(state.events.at(-1), 'dispose');
});

test('oversized input and foreign selected pages fail before native acquisition', async () => {
  const state = fixture();
  await assert.rejects(evaluateNativeExpression({ ...state.request, args: ['x'.repeat(65537)] }), /input byte limit/);
  state.context.pages = () => [];
  await assert.rejects(evaluateNativeExpression(state.request), /belong/);
  assert.deepEqual(state.events, []);
});

test('filename output retains the native one MiB cap even with larger host allowances', async () => {
  for (const expression of ['"x".repeat(2 * 1024 * 1024)', 'Promise.reject("x".repeat(2 * 1024 * 1024))']) {
    const state = fixture();
    await assert.rejects(evaluateNativeExpression({ ...state.request, args: [expression], options: { filename: 'overflow.json' }, limits: { maxCommandBytes: 8 * 1024 * 1024, maxArtifactBytes: 8 * 1024 * 1024 } }), /byte.*limit/);
    assert.deepEqual(state.events, ['acquire', 'serialize', 'dispose']);
  }
});

test('cancelled late capsule acquisition is drained and disposed exactly once', async () => {
  const state = fixture();
  const signal = new AbortController();
  let acquired!: () => void;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  state.page.evaluateHandle = async (callback, input) => { const result = await state.capture(callback, input); acquired(); await new Promise<void>(resolve => { finish = resolve; }); return result; };
  const pending = evaluateNativeExpression({ ...state.request, signal: signal.signal });
  const rejected = assert.rejects(pending, /owner canceled/);
  await ready;
  signal.abort(new Error('owner canceled'));
  let drained = false;
  const cleanup = state.cleanups[0]!().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  finish();
  await Promise.all([rejected, cleanup]);
  assert.equal(state.events.filter(event => event === 'dispose').length, 1);
});

test('a modal-yielding session action may return without fabricating a result', async () => {
  const state = fixture();
  const result = await evaluateNativeExpression({ ...state.request, browserSession: { ...state.request.browserSession!, async runAction() {} } });
  assert.equal(result, undefined);
  assert.deepEqual(state.events, []);
});

test('a yielded native action remains owned by the session until its capsule is retired', async () => {
  const state = fixture();
  let acquired!: () => void;
  let finish!: () => void;
  let action!: Promise<void>;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  state.page.evaluateHandle = async (callback, input) => { const result = await state.capture(callback, input); acquired(); await new Promise<void>(resolve => { finish = resolve; }); return result; };
  const result = await evaluateNativeExpression({ ...state.request, browserSession: { ...state.request.browserSession!, async runAction(operation) { action = operation(); await ready; } } });
  assert.equal(result, undefined);
  await state.cleanups[0]!();
  assert.deepEqual(state.events, ['acquire']);
  finish();
  await action;
  assert.deepEqual(state.events, ['acquire', 'serialize', 'dispose']);
});

test('native evaluation and disposal failures retain both causes', async () => {
  const state = fixture();
  const primary = new Error('native serialization failed');
  const retirement = new Error('native disposal failed');
  state.page.evaluateHandle = async (callback, input) => ({ ...await state.capture(callback, input), async evaluate() { throw primary; }, async dispose() { throw retirement; } });
  await assert.rejects(evaluateNativeExpression(state.request), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, retirement]);
    return true;
  });
});

test('native envelope validation rejects malformed values before response encoding', async () => {
  const state = fixture();
  state.page.evaluateHandle = async (callback, input) => ({ ...await state.capture(callback, input), async evaluate() { return { text: 'bad envelope' }; } });
  await assert.rejects(evaluateNativeExpression(state.request), /Invalid native evaluation envelope/);
  assert.equal(state.events.at(-1), 'dispose');
});

test('native entry admission returns a bounded limit outcome rather than transferring a huge array', async () => {
  const state = fixture();
  await assert.rejects(evaluateNativeExpression({ ...state.request, args: ['Array(10001).fill(1)'] }), /byte\/entry limit/);
  assert.deepEqual(state.events, ['acquire', 'serialize', 'dispose']);
});

test('missing-selector errors never request locator code for an unresolved target', async () => {
  const state = fixture();
  Object.assign(state.page, { locator: () => ({ async count() { return 0; } }) });
  const result = await playwrightStandardAbilities.eval!.execute({ ...state.request, args: ['1', '#missing'], browserSession: { ...state.request.browserSession!, targetLocator() { throw new Error('Unresolved target has no code'); } } });
  assert.ok(result);
  assert.deepEqual(result.sections, [{ title: 'Error', content: 'Error: "#missing" does not match any elements.' }]);
});
