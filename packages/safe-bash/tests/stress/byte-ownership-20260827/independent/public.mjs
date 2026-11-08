import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Shell, ShellLimitError, createMemoryFileSystem, collectBytes, standardCommands } from 'virtual-bash';
import { vectors } from './vectors.mjs';
import { borrowed, completed, hex, success, watchdog } from './fixtures.mjs';

assert.equal(fileURLToPath(import.meta.resolve('virtual-bash')), process.env.OWNERSHIP_PUBLIC);

async function fixture(context, kind, vector, options = {}) {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/borrowed', Buffer.from(vector.whole, 'hex'));
  await fs.writeFile('/haystack', Buffer.from(vectors.patterns.haystack, 'hex'));
  const { source, state } = borrowed(kind, vector.chunks, options);
  const originalRead = fs.readStream.bind(fs);
  fs.readStream = (name, settings) => {
    assert.ok(settings?.signal, 'public input must propagate a signal');
    settings.signal.throwIfAborted();
    return name === '/borrowed' ? source : originalRead(name, settings);
  };
  const shell = new Shell({ fs });
  shell.use(standardCommands());
  context.after(() => shell.dispose());
  return { shell, fs, state };
}

for (const kind of ['Buffer', 'Uint8Array']) {
  for (const [label, vector, command, expected] of [
    ['tail records', vectors.records, 'tail -n 2 /borrowed', vectors.records.tail],
    ['tail binary', vectors.binary, 'tail -c 7 /borrowed', vectors.binary.tail],
    ['head exclusion', vectors.binary, 'head -c -3 /borrowed', vectors.binary.head],
    ['fixed pattern collection', vectors.patterns, 'grep -F -f /borrowed /haystack', vectors.patterns.matches],
  ]) {
    test(`public ${label} ${kind}`, watchdog, async context => {
      const { shell, state } = await fixture(context, kind, vector);
      success(await shell.exec(command), expected);
      completed(state, 5);
    });
  }
  test(`public tail pipeline and file bytes ${kind}`, watchdog, async context => {
    const { shell, fs, state } = await fixture(context, kind, vectors.records);
    success(await shell.exec('tail -n 2 /borrowed | cat > /saved; cat /saved'), vectors.records.tail);
    assert.equal(hex(await fs.readFile('/saved')), vectors.records.tail);
    completed(state, 5);
  });
  test(`public stdin ownership control ${kind}`, watchdog, async context => {
    const { shell } = await fixture(context, kind, vectors.binary);
    const { source, state } = borrowed(kind, vectors.binary.chunks);
    success(await shell.exec('tail -c 7 | cat', { stdin: source }), vectors.binary.tail);
    completed(state, 5);
  });
  test(`public contract collector acceptance control ${kind}`, watchdog, async () => {
    const { source, state } = borrowed(kind, vectors.binary.chunks);
    assert.equal(hex(await collectBytes(source, { maxBytes: 11 })), vectors.binary.whole);
    completed(state, 5);
  });
}

test('public empty nonzero-offset views produce no output', watchdog, async context => {
  const { shell, state } = await fixture(context, 'Buffer', { whole: '', chunks: ['', '', ''] });
  success(await shell.exec('tail -n 2 /borrowed'), '');
  completed(state, 3);
});

test('public upstream error has exact status and diagnostic', watchdog, async context => {
  const { shell, state } = await fixture(context, 'Buffer', vectors.binary, { afterRead: () => { throw new Error('independent upstream failure'); } });
  const result = await shell.exec('tail -c 7 /borrowed');
  assert.deepEqual({ stdout: hex(result.stdoutBytes), stderr: result.stderr, status: result.exitCode },
    { stdout: '', stderr: 'tail: independent upstream failure\n', status: 1 });
  assert.deepEqual(state, { resumed: 1, finalized: true, noMutationChecks: 1 });
});

test('public output limit rejects without mutating input', watchdog, async context => {
  const { shell, state } = await fixture(context, 'Buffer', vectors.binary);
  await assert.rejects(shell.exec('tail -c 7 /borrowed', { limits: { maxOutputBytes: 6 } }),
    error => error instanceof ShellLimitError && error.limit === 'maxOutputBytes');
  completed(state, 5);
});

test('public abort closes cooperative borrowed source', watchdog, async context => {
  const controller = new AbortController();
  const reason = new Error('independent public cancellation');
  const { shell, state } = await fixture(context, 'Buffer', vectors.binary, { afterRead: count => { if (count === 1) controller.abort(reason); } });
  await assert.rejects(shell.exec('tail -c 7 /borrowed', { signal: controller.signal }), error => error === reason);
  assert.equal(state.finalized, true);
  assert.ok(state.noMutationChecks >= 1 && state.noMutationChecks <= 2);
});

test('public awaited sink acceptance before backing reuse', watchdog, async context => {
  const { shell } = await fixture(context, 'Buffer', vectors.binary);
  const { source, state } = borrowed('Buffer', vectors.binary.chunks);
  shell.register({ name: 'borrow-emitter', async execute(command) {
    for await (const chunk of source) await command.stdout.write(chunk);
    return { exitCode: 0 };
  } });
  const accepted = [];
  const result = await shell.exec('borrow-emitter', { stdout: { async write(chunk) {
    const before = hex(chunk);
    await setImmediate();
    assert.equal(hex(chunk), before);
    accepted.push(before);
  } } });
  success(result, vectors.binary.whole);
  assert.equal(accepted.join(''), vectors.binary.whole);
  completed(state, 5);
});

test('public sink rejection preserves attempted bytes and exact diagnostic', watchdog, async context => {
  const { shell, state } = await fixture(context, 'Buffer', vectors.binary);
  const reason = new Error('independent sink rejection');
  const result = await shell.exec('tail -c 7 /borrowed', { stdout: { async write() { throw reason; } } });
  assert.deepEqual({ stdout: hex(result.stdoutBytes), stderr: result.stderr, status: result.exitCode },
    { stdout: '8391', stderr: 'tail: independent sink rejection\n', status: 1 });
  completed(state, 5);
});
