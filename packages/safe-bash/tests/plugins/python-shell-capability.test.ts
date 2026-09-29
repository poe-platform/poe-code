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
    assert.deepEqual(options?.env, { CHILD: 'yes' });
    await options!.stdout!.write(new Uint8Array([0, 255]));
    await options!.stderr!.write(new TextEncoder().encode('warning'));
    return { exitCode: 7 };
  } } satisfies Partial<CommandContext> as unknown as CommandContext;
  const shell = createPythonShellCapability(context);
  assert.deepEqual(await shell.call!({ argv: ['echo', '$(bad);*'], cwd: '/child', env: { CHILD: 'yes' } }, { signal }), { stdout: [0, 255], stderr: [119, 97, 114, 110, 105, 110, 103], exitCode: 7 });
  assert.equal(context.cwd, '/parent');
  assert.deepEqual(context.env, { TOKEN: 'host' });
  assert.equal(pythonShellDispatchActive(scope), false);
});

test('script mode invokes the parent parser and output overflow fails', async () => {
  const signal = new AbortController().signal;
  const context = { signal, executionScope: {}, cwd: '/', env: {}, async invoke(command, args, options) {
    assert.equal(command, 'sh');
    assert.deepEqual(args, ['-c', 'echo ok | cat']);
    await options!.stdout!.write(new Uint8Array(9));
    return { exitCode: 0 };
  } } satisfies Partial<CommandContext> as unknown as CommandContext;
  const shell = createPythonShellCapability(context, { maxOutputBytes: 8 });
  await assert.rejects(shell.call!({ script: 'echo ok | cat' }, { signal }), /output limit/);
  assert.equal(pythonShellDispatchActive(context.executionScope), false);
});

test('child deadlines abort work without replacing parent cancellation authority', async () => {
  const parent = new AbortController();
  let aborted = false;
  const context = { signal: parent.signal, executionScope: {}, cwd: '/', env: {}, async invoke(_command, _args, options) {
    await options!.stdout!.write(new Uint8Array([0,255]));
    await options!.stderr!.write(new Uint8Array([42]));
    await new Promise<void>(resolve => options!.signal!.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    return { exitCode: 0 };
  } } satisfies Partial<CommandContext> as unknown as CommandContext;
  const shell = createPythonShellCapability(context);
  const keepAlive = setTimeout(() => {}, 100);
  try {
    assert.deepEqual(await shell.call!({ argv: ['delayed'], timeoutMs: 1 }, { signal: parent.signal }), { error: {code:'timeout', message:'Python shell deadline exceeded', stdout:[0,255], stderr:[42]} });
    assert.equal(aborted, true);
    assert.equal(parent.signal.aborted, false);
    assert.equal(pythonShellDispatchActive(context.executionScope), false);
  } finally { clearTimeout(keepAlive); }
});

test('inherited stdin uses the parent source and enforces a caller output cap', async () => {
  const signal = new AbortController().signal;
  const context = { signal, executionScope:{}, cwd:'/', env:{}, stdin:{async *[Symbol.asyncIterator]() {yield new Uint8Array([0,255]);}}, async invoke(_name, _args, options) {
    const input:number[] = [];
    for await (const chunk of options!.stdin!) input.push(...chunk);
    assert.deepEqual(input,[0,255]);
    await options!.stdout!.write(new Uint8Array([1,2]));
    return {exitCode:0};
  }} satisfies Partial<CommandContext> as unknown as CommandContext;
  const shell = createPythonShellCapability(context);
  await assert.rejects(shell.call!({argv:['echo'],stdinMode:'inherit',maxOutputBytes:1},{signal}), /output limit/);
});

for (const limits of [{}, { maxInputBytes: Infinity, maxOutputBytes: Infinity }]) {
  test(`shell accepts large input and output with limits ${JSON.stringify(limits)}`, async () => {
    const signal = new AbortController().signal;
    const context = { signal, executionScope: {}, cwd: '/', env: {}, async invoke(_command, _args, options) {
      for await (const chunk of options!.stdin!) await options!.stdout!.write(chunk);
      return { exitCode: 0 };
    } } satisfies Partial<CommandContext> as unknown as CommandContext;
    const shell = createPythonShellCapability(context, limits);
    const value = 'x'.repeat(100000);
    const result = await shell.call!({ argv: ['cat'], stdin: value }, { signal }) as { stdout: number[] };
    assert.equal(result.stdout.length, value.length);
  });
}

test('shell concurrency defaults to disabled', async () => {
  const signal = new AbortController().signal;
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const context = { signal, executionScope: {}, cwd: '/', env: {}, async invoke() { await gate; return { exitCode: 0 }; } } satisfies Partial<CommandContext> as unknown as CommandContext;
  const shell = createPythonShellCapability(context);
  const first = shell.call!({ argv: ['echo'] }, { signal });
  const second = shell.call!({ argv: ['echo'] }, { signal });
  finish();
  await Promise.all([first, second]);
});

test('finite shell concurrency and input budgets remain enforced', async () => {
  const signal = new AbortController().signal;
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const context = { signal, executionScope: {}, cwd: '/', env: {}, async invoke() { await gate; return { exitCode: 0 }; } } satisfies Partial<CommandContext> as unknown as CommandContext;
  const shell = createPythonShellCapability(context, { maxConcurrentCalls: 1, maxInputBytes: 1 });
  await assert.rejects(shell.call!({ argv: ['cat'], stdin: 'é' }, { signal }), /input limit/);
  const first = shell.call!({ argv: ['echo'] }, { signal });
  await assert.rejects(shell.call!({ argv: ['echo'] }, { signal }), /concurrency limit/);
  finish();
  await first;
});

test('stream exposes output before completion and early close cancels the child', async () => {
  const signal = new AbortController().signal;
  let emitted!: () => void;
  const writing = new Promise<void>(resolve => { emitted = resolve; });
  let cancelled = false;
  const context = { signal, executionScope:{}, cwd:'/', env:{}, async invoke(_command, _args, options) {
    try {
      emitted();
      await options!.stdout!.write(new Uint8Array(32769));
      await new Promise<void>(resolve => {
        if (options!.signal!.aborted) resolve();
        else options!.signal!.addEventListener('abort', () => resolve(), {once:true});
      });
      options!.signal!.throwIfAborted();
      return {exitCode:0};
    } finally { cancelled = options!.signal!.aborted; }
  } } satisfies Partial<CommandContext> as unknown as CommandContext;
  const shell = createPythonShellCapability(context);
  const iterator = shell.stream!({argv:['incremental']}, {signal})[Symbol.asyncIterator]();
  const first = iterator.next();
  await writing;
  const marker = Symbol('not incremental');
  const result = await Promise.race([first, new Promise<typeof marker>(resolve => setTimeout(() => resolve(marker), 25))]);
  assert.notEqual(result, marker, 'stream must yield while the command is still running');
  assert.deepEqual(result, {done:false, value:{type:'stdout', data:Array.from(new Uint8Array(16384))}});
  await iterator.return!();
  assert.equal(cancelled, true);
  assert.equal(pythonShellDispatchActive(context.executionScope), false);
});

test('stream applies backpressure and orders concurrent stdout and stderr writes', async () => {
  const signal = new AbortController().signal;
  let written = false;
  const context = { signal, executionScope:{}, cwd:'/', env:{}, async invoke(_command, _args, options) {
    await Promise.all([
      options!.stdout!.write(new Uint8Array([1])),
      options!.stderr!.write(new Uint8Array([2])),
    ]);
    written = true;
    return {exitCode:7};
  } } satisfies Partial<CommandContext> as unknown as CommandContext;
  const shell = createPythonShellCapability(context);
  const iterator = shell.stream!({argv:['both']}, {signal})[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), {done:false, value:{type:'stdout', data:[1]}});
  assert.equal(written, false);
  assert.deepEqual(await iterator.next(), {done:false, value:{type:'stderr', data:[2]}});
  assert.equal(written, false);
  assert.deepEqual(await iterator.next(), {done:false, value:{type:'exit', returncode:7}});
  assert.equal(written, true);
  assert.equal((await iterator.next()).done, true);
  assert.equal(pythonShellDispatchActive(context.executionScope), false);
});

test('shell stream fragments large writes before the finite host envelope', async () => {
  const { createPythonHostBridge } = await import('../../src/commands/python/host-capabilities.js');
  const signal = new AbortController().signal;
  const bytes = Uint8Array.from({ length: 256 * 1024 }, (_, i) => i % 256);
  const errorBytes = new Uint8Array([...bytes, 0, 255, 128]);
  let settled = false;
  const context = { signal, executionScope: {}, cwd: '/', env: {}, async invoke(_command, _args, options) {
    try { await options!.stdout!.write(bytes); await options!.stderr!.write(errorBytes); return { exitCode: 7 }; }
    finally { settled = true; }
  } } satisfies Partial<CommandContext> as unknown as CommandContext;
  const bridge = createPythonHostBridge({ shell: createPythonShellCapability(context, { maxOutputBytes: 600 * 1024 }) }, { signal, maxMessageBytes: 256 * 1024, maxStreamBytes: 4 * 1024 * 1024 });
  try {
    const handle = await bridge.request({ version: 1, operation: 'stream', capability: 'shell', value: { argv: ['emit'] } });
    const stdout: number[] = [], stderr: number[] = [];
    let exits = 0;
    for (;;) {
      const next = await bridge.request({ version: 1, operation: 'next', handle }) as { done: boolean; value?: { value: { type: string; data?: number[]; returncode?: number } } };
      if (next.done) break;
      const event = next.value!.value;
      if (event.type === 'exit') { exits++; assert.equal(event.returncode, 7); }
      else {
        assert.ok(event.data!.length <= 16 * 1024);
        for (const byte of event.data!) (event.type === 'stdout' ? stdout : stderr).push(byte);
      }
    }
    assert.deepEqual(Uint8Array.from(stdout), bytes);
    assert.deepEqual(Uint8Array.from(stderr), errorBytes);
    assert.equal(exits, 1);
    assert.equal(settled, true);
    assert.equal(pythonShellDispatchActive(context.executionScope), false);
  } finally { await bridge.close(); }
});
