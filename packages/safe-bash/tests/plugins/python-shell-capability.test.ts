import assert from 'node:assert/strict';
import test from 'node:test';
import { createPythonShellCapability, pythonShellDispatchActive } from '../../src/commands/python/shell-capability.js';
import type { CommandContext } from '../../src/contracts/index.js';

test('shell capability passes literal argv and child state with shared invocation authority', async () => {
  const scope = {};
  const signal = new AbortController().signal;
  const context = { signal, executionScope: scope, cwd: '/parent', env: { TOKEN: 'host' }, async invoke(command, args, options) {
    assert.equal(pythonShellDispatchActive(scope), true);
    assert.equal(command, 'echo');
    assert.deepEqual(args, ['$(bad);*']);
    assert.equal(options?.cwd, '/child');
    assert.deepEqual(options?.env, { TOKEN: 'host', CHILD: 'yes' });
    await options!.stdout!.write(new Uint8Array([0, 255]));
    await options!.stderr!.write(new TextEncoder().encode('warning'));
    return { exitCode: 7 };
  } } as CommandContext;
  const shell = createPythonShellCapability(context);
  assert.deepEqual(await shell.call!({ argv: ['echo', '$(bad);*'], cwd: '/child', env: { CHILD: 'yes' } }, { signal }), { stdout: [0, 255], stderr: [119, 97, 114, 110, 105, 110, 103], exitCode: 7 });
  assert.equal(context.cwd, '/parent');
  assert.equal(pythonShellDispatchActive(scope), false);
});

test('script mode invokes the parent parser and output overflow fails', async () => {
  const signal = new AbortController().signal;
  const context = { signal, executionScope: {}, cwd: '/', env: {}, async invoke(command, args, options) {
    assert.equal(command, 'sh');
    assert.deepEqual(args, ['-c', 'echo ok | cat']);
    await options!.stdout!.write(new Uint8Array(9));
    return { exitCode: 0 };
  } } as CommandContext;
  const shell = createPythonShellCapability(context, { maxOutputBytes: 8 });
  await assert.rejects(shell.call!({ script: 'echo ok | cat' }, { signal }), /output limit/);
  assert.equal(pythonShellDispatchActive(context.executionScope), false);
});

test('child deadlines abort work without replacing parent cancellation authority', async () => {
  const parent = new AbortController();
  let aborted = false;
  const context = { signal: parent.signal, executionScope: {}, cwd: '/', env: {}, async invoke(_command, _args, options) {
    await new Promise<void>(resolve => options!.signal!.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    return { exitCode: 0 };
  } } as CommandContext;
  const shell = createPythonShellCapability(context);
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(shell.call!({ argv: ['delayed'], timeoutMs: 1 }, { signal: parent.signal }), /timeout/i);
    assert.equal(aborted, true);
    assert.equal(parent.signal.aborted, false);
    assert.equal(pythonShellDispatchActive(context.executionScope), false);
  } finally { clearTimeout(keepAlive); }
});
