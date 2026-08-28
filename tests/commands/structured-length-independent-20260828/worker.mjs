import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [mode, manifestPath, manifestHash] = process.argv.slice(2);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(manifestPath);
assert.equal(hash(manifestBytes), manifestHash, 'controller-authenticated execution manifest');
const manifest = JSON.parse(manifestBytes);
const vectors = JSON.parse(await readFile(new URL('./vectors.json', import.meta.url)));
const root = await realpath(manifest.root);
const expectedRootUrl = pathToFileURL(join(root, 'dist/index.js')).href;
for (const [relative, expected] of Object.entries(manifest.files)) {
  assert.equal(hash(await readFile(join(root, relative))), expected, relative);
}
const receipts = [];
const load = async relative => {
  const url = pathToFileURL(join(root, 'dist', relative)).href;
  assert.ok(Object.hasOwn(manifest.files, `dist/${relative}`), 'loaded module must be captured');
  receipts.push({ url, sha256: manifest.files[`dist/${relative}`] });
  return import(url);
};
const { Interpreter } = await load('commands/structured/interpreter.js');
const { Budget, resolveJqLimits, JqError, JqLimitError, object, put } = await load('commands/structured/limits.js');
const { Decimal } = await load('commands/structured/numbers.js');
const { FsError } = await load('contracts/index.js');
class ObservedBudget extends Budget {
  charges = [];
  ticks = 0;
  step(count = 1) { this.charges.push(count); return super.step(count); }
  async tick() { this.ticks++; return super.tick(); }
}
const ast = { kind: 'call', name: 'length', args: [] };
const evaluate = async (input, signal = new AbortController().signal) => {
  const budget = new ObservedBudget(resolveJqLimits({ maxSteps: 1 }), signal);
  const iterator = new Interpreter(budget, new Map()).run(ast, input);
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.deepEqual(await iterator.next(), { done: true, value: undefined });
  assert.deepEqual(budget.charges, [1]); assert.equal(budget.ticks, 1);
  return { value: first.value, budget };
};
const observed = [];
if (mode === 'semantics') {
  for (const row of vectors.strings) {
    assert.ok(row.input.length <= vectors.maximumLiteralStringCodeUnits);
    const result = await evaluate(row.input);
    assert.equal(result.value, row.expected, row.id);
    assert.throws(() => result.budget.step(), error => error instanceof JqLimitError && error.message === 'maxSteps limit exceeded');
    observed.push({ id: row.id, value: result.value, existingEntryCharges: 1 });
  }
  const specialObject = object(); put(specialObject, '__proto__', 3); put(specialObject, 'constructor', 2);
  for (const [id, input, expected] of [
    ['null', null, 0], ['positive', 2.25, 2.25], ['negative', -2.25, 2.25], ['negative-zero', -0, 0],
    ['infinity', -Infinity, Infinity], ['nan', NaN, NaN], ['array', [null, false, 'x'], 3],
    ['empty-array', [], 0], ['sparse-array', new Array(3), 3], ['empty-object', object(), 0],
    ['own-special-keys', specialObject, 2], ['decimal', new Decimal('25', -1, true, '-2.5', -2.5), 2.5],
  ]) {
    const result = await evaluate(input);
    assert.ok(Object.is(result.value, expected), id);
    observed.push({ id, expected: String(expected), existingEntryCharges: 1 });
  }
  for (const input of [true, false]) {
    await assert.rejects(evaluate(input), error => error instanceof JqError && error.message === 'boolean has no length' && error.exitCode === 5);
    observed.push({ id: `boolean-${input}`, rejected: 'JqError:boolean has no length:5' });
  }
  for (const [id, reason] of [['errno', new FsError('EFBIG')], ['null', null], ['false', false], ['zero', 0], ['empty', ''], ['symbol', Symbol('stop')]]) {
    const controller = new AbortController(); controller.abort(reason);
    const budget = new ObservedBudget(resolveJqLimits({ maxSteps: 1 }), controller.signal);
    const iterator = new Interpreter(budget, new Map()).run(ast, vectors.sentinel);
    await assert.rejects(iterator.next(), error => error === reason);
    assert.deepEqual(budget.charges, [1]); assert.equal(budget.ticks, 1);
    observed.push({ id: `pre-aborted-${id}`, exactReason: true });
  }
} else if (mode === 'allocation') {
  const descriptor = Object.getOwnPropertyDescriptor(Array, 'from');
  const original = descriptor.value;
  const marker = new Error('independent tiny sentinel collection marker');
  const calls = [];
  let productCollected = false;
  Object.defineProperty(Array, 'from', { ...descriptor, value: function (...args) {
    if (args[0] === vectors.sentinel) { calls.push(new Error().stack); throw marker; }
    return Reflect.apply(original, this, args);
  } });
  try {
    assert.throws(() => Array.from(vectors.sentinel), error => error === marker);
    let count = 0;
    for (const element of vectors.sentinel) { void element; count++; }
    assert.equal(count, vectors.sentinelExpected);
    assert.equal(calls.length, 1, 'positive counter control must not trigger sentinel collection');
    assert.deepEqual(Array.from([7]), [7], 'unrelated Array.from delegates unchanged');
    try {
      const result = await evaluate(vectors.sentinel);
      assert.equal(result.value, vectors.sentinelExpected);
    } catch (error) { if (error !== marker) throw error; productCollected = true; }
    if (productCollected) {
      assert.equal(calls.length, 2);
      assert.ok(calls[1].includes(fileURLToPath(pathToFileURL(join(root, 'dist/commands/structured/interpreter.js')))), 'marker must originate in loaded interpreter');
    } else assert.equal(calls.length, 1);
  } finally { Object.defineProperty(Array, 'from', descriptor); }
  assert.deepEqual(Object.getOwnPropertyDescriptor(Array, 'from'), descriptor);
  observed.push({ id: 'allocation-discriminator', productCollected, counterControl: true, instrumentationCountercontrol: true,
    unrelatedDelegation: true, restored: true, markerStacks: calls });
} else if (mode === 'trusted-iterator') {
  const descriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.iterator);
  const original = descriptor.value;
  for (const scenario of ['finite', 'empty', 'throws', 'abort-without-new-observation']) {
    const controller = new AbortController();
    const reason = new FsError('EACCES');
    const events = [];
    Object.defineProperty(String.prototype, Symbol.iterator, { ...descriptor, value: function (...args) {
      if (this !== vectors.trustedIteratorSentinel) return Reflect.apply(original, this, args);
      let index = 0;
      return { next() {
        events.push(`next-${++index}`);
        if (scenario === 'throws') throw reason;
        if (scenario === 'empty') return { done: true };
        if (scenario === 'abort-without-new-observation' && index === 1) {
          controller.abort(false); queueMicrotask(() => events.push('microtask'));
        }
        return index <= 3 ? { done: false, get value() { events.push(`value-${index}`); return index === 2 ? undefined : {}; } } : { done: true };
      } };
    } });
    try {
      if (scenario === 'throws') await assert.rejects(evaluate(vectors.trustedIteratorSentinel), error => error === reason);
      else {
        const result = await evaluate(vectors.trustedIteratorSentinel, controller.signal);
        assert.equal(result.value, scenario === 'empty' ? 0 : vectors.trustedIteratorExpected);
      }
    } finally { Object.defineProperty(String.prototype, Symbol.iterator, descriptor); }
    assert.deepEqual(Object.getOwnPropertyDescriptor(String.prototype, Symbol.iterator), descriptor);
    if (scenario === 'abort-without-new-observation') {
      assert.equal(controller.signal.reason, false);
      assert.deepEqual(events, ['next-1', 'value-1', 'next-2', 'value-2', 'next-3', 'value-3', 'next-4', 'microtask']);
    }
    observed.push({ id: scenario, events, restored: true });
  }
} else if (mode === 'public') {
  const resolved = import.meta.resolve('virtual-bash');
  assert.equal(resolved, expectedRootUrl, 'actual moved package root must resolve exactly');
  const { Shell, createMemoryFileSystem, structuredCommands, createStructuredCommands, toByteSource } = await import('virtual-bash');
  receipts.push({ url: resolved, sha256: manifest.files['dist/index.js'] });
  const fs = createMemoryFileSystem();
  const command = createStructuredCommands()[0];
  const rows = [...vectors.strings.filter(row => !row.internalOnly).map(row => ({ id: row.id, input: JSON.stringify(row.input), expected: `${row.expected}\n` })), ...vectors.public];
  for (const row of rows) {
    const chunks = [], errors = [];
    const result = await command.execute({ command: 'jq', args: ['-c', 'length'], cwd: '/', env: {}, fs,
      stdin: toByteSource(row.input), signal: new AbortController().signal,
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
    assert.equal(result.exitCode, 0, row.id); assert.equal(Buffer.concat(chunks).toString(), row.expected, row.id);
    assert.equal(Buffer.concat(errors).length, 0, row.id);
    observed.push({ id: `public-command-${row.id}`, exitCode: 0, stdout: row.expected });
  }
  await fs.writeFile('/input.json', new TextEncoder().encode('["A😀B","é","👩‍💻"]'));
  const shell = new Shell({ fs }).use(structuredCommands());
  try {
    const result = await shell.exec("jq -c 'map(length)' /input.json | jq -c 'length' > /result.json");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    assert.equal(new TextDecoder().decode(await fs.readFile('/result.json')), '3\n');
    assert.equal(new TextDecoder().decode(await fs.readFile('/input.json')), '["A😀B","é","👩‍💻"]');
    observed.push({ id: 'moved-shell-pipeline-vfs', exitCode: 0, resultFile: '3\n', inputPreserved: true });
  } finally { await shell.dispose(); }
} else throw new Error(`unknown mode ${mode}`);
process.stdout.write(JSON.stringify({ mode, candidate: manifest.candidate, manifestSha256: manifestHash, runtime: { version: process.version, path: process.execPath },
  receipts, observations: observed, nativeExecuted: false, productPrototype: false }) + '\n');
