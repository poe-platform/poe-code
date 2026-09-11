import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandArguments, type ByteSink, type CommandContext, type InvocationCleanup } from '../../../src/contracts/index.js';
import { MemoryFileSystem } from '../../../src/fs/memory/index.js';
import { Shell } from '../../../src/shell/shell.js';
import { ShellLimitError } from '../../../src/shell/types.js';
import { createDos2unixCommand, createUnix2dosCommand, lineEndingCommands, type LineEndingCommandsOptions } from '../../../src/commands/line-endings/index.js';

function fixture() {
  const caller = new AbortController(), cleanups: InvocationCleanup[] = [];
  const chunks: Uint8Array[] = [];
  let pulls = 0;
  const context: CommandContext = {
    command: 'dos2unix', args: [], cwd: '/', env: { LC_ALL: 'C' }, fs: new MemoryFileSystem(), signal: caller.signal,
    stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(65, 13, 10); } },
    stdout: { async write(bytes) { chunks.push(Uint8Array.from(bytes)); } }, stderr: { async write() {} },
    registerCleanup(cleanup) { assert.equal(this, context); cleanups.push(cleanup); },
  };
  return { context, caller, chunks, get pulls() { return pulls; }, close() {
    assert.equal(cleanups.length, 1); return Promise.resolve(cleanups[0]!());
  }, async run(options: LineEndingCommandsOptions = {}) {
    try { return await createDos2unixCommand(options).execute(context); }
    finally { for (const cleanup of cleanups) await cleanup(); }
  } };
}

test('one argument snapshot prevents a later operand bypassing the count cap', async () => {
  const setup = fixture();
  let reads = 0;
  await setup.context.fs.writeFile('/extra', Uint8Array.of(66, 13, 10));
  Object.defineProperty(setup.context, 'args', { get() { return ++reads === 1 ? ['-q'] : ['-q', '/extra']; } });
  assert.equal((await setup.run({ limits: { maxArguments: 1, maxArgumentBytes: 64 } })).exitCode, 0);
  assert.equal(reads, 1);
  assert.deepEqual(Buffer.concat(setup.chunks), Buffer.from('A\n'));
  assert.deepEqual(await setup.context.fs.readFile('/extra'), Uint8Array.of(66, 13, 10));
});

test('an owned argument carrier remains bound to the captured array identity', async () => {
  const setup = fixture();
  const carrier = createCommandArguments(['-q']);
  let reads = 0;
  Object.defineProperty(setup.context, 'args', { get() { reads++; return carrier.args; } });
  Object.assign(setup.context, { argumentValues: carrier });
  assert.equal((await setup.run()).exitCode, 0);
  assert.equal(reads, 1);
});

test('mismatched argument carrier is rejected without input', async () => {
  const setup = fixture();
  Object.assign(setup.context, { argumentValues: createCommandArguments([]) });
  await assert.rejects(setup.run(), { name: 'TypeError', message: 'Command argument identity does not match its carrier' });
  assert.equal(setup.pulls, 0);
});

for (const boundary of ['stdout', 'ownedOutput', 'consumerClosed'] as const) {
  test(`initial ${boundary} snapshot is the actual destination`, async () => {
    const setup = fixture();
    const live = new AbortController(), closed = new AbortController(); closed.abort(false);
    let reads = 0, initial = 0, replacement = 0;
    const capability = { consumerClosed: live.signal, async write() { assert.equal(this, capability); initial++; } };
    const other = { consumerClosed: closed.signal, async write() { replacement++; } };
    const sink: ByteSink = { async write() { assert.fail('opaque route'); }, ownedOutput: capability };
    if (boundary === 'stdout') Object.defineProperty(setup.context, 'stdout', { get() { return ++reads === 1 ? sink : { async write() {}, ownedOutput: other }; } });
    else {
      Object.assign(setup.context, { stdout: sink });
      if (boundary === 'ownedOutput') Object.defineProperty(sink, 'ownedOutput', { get() { return ++reads === 1 ? capability : other; } });
      else Object.defineProperty(capability, 'consumerClosed', { get() { assert.equal(this, capability); return ++reads === 1 ? live.signal : closed.signal; } });
    }
    assert.equal((await setup.run()).exitCode, 0);
    assert.equal(reads, 1); assert.equal(initial, 1); assert.equal(replacement, 0);
  });
}

for (const reason of [false, 0, '', null]) {
  for (const boundary of ['args', 'argumentValues', 'argument-index', 'stdout', 'ownedOutput'] as const) {
    test(`${boundary} cancellation prevents subsequent getter admission: ${JSON.stringify(reason)}`, async () => {
      const setup = fixture();
      let later = 0;
      if (boundary === 'args') {
        const args = ['-q'];
        Object.defineProperty(args, '0', { get() { later++; return '-q'; } });
        Object.defineProperty(setup.context, 'args', { get() { setup.caller.abort(reason); return args; } });
      } else if (boundary === 'argumentValues') {
        Object.defineProperty(setup.context, 'argumentValues', { get() { setup.caller.abort(reason); return undefined; } });
        let reads = 0;
        Object.defineProperty(setup.context, 'args', { get() { if (++reads > 1) later++; return []; } });
      } else if (boundary === 'argument-index') {
        const args = ['-q', '-q'];
        Object.defineProperty(args, '0', { get() { setup.caller.abort(reason); return '-q'; } });
        Object.defineProperty(args, '1', { get() { later++; return '-q'; } });
        Object.assign(setup.context, { args });
      } else if (boundary === 'stdout') Object.defineProperty(setup.context, 'stdout', { get() {
        setup.caller.abort(reason); return { async write() { later++; }, get ownedOutput() { later++; return undefined; } };
      } });
      else Object.defineProperty(setup.context.stdout, 'ownedOutput', { get() {
        setup.caller.abort(reason); return { get consumerClosed() { later++; return new AbortController().signal; }, async write() { later++; } };
      } });
      await assert.rejects(setup.run(), error => Object.is(error, reason));
      assert.equal(later, 0); assert.equal(setup.pulls, 0);
    });
  }
}

for (const reason of [false, 0, '', null, 'registered-close']) {
  for (const done of [false, true]) {
    test(`done getter ${done} ${JSON.stringify(reason)} blocks value admission and retains iterator cleanup`, async () => {
      const setup = fixture();
      let values = 0, returns = 0, closure: Promise<void> | undefined;
      const iterator = {
        async next() { return { get done() {
          if (reason === 'registered-close') closure = setup.close();
          else setup.caller.abort(reason);
          return done;
        }, get value() { values++; return Uint8Array.of(65); } }; },
        async return() { assert.equal(this, iterator); returns++; return { done: true as const, value: undefined }; },
      };
      Object.assign(setup.context, { stdin: { [Symbol.asyncIterator]() { return iterator; } } });
      try {
        await assert.rejects(setup.run(), error => reason === 'registered-close' ? error instanceof Error : Object.is(error, reason));
        assert.equal(values, 0); assert.equal(returns, 1);
        assert.equal(setup.chunks.length, 0);
      } finally { await closure; }
    });
  }
}

for (const reason of [false, 0, '', null, 'registered-close']) {
  test(`fallback size getter ${JSON.stringify(reason)} blocks readFile getter`, async () => {
    const setup = fixture();
    const memory = setup.context.fs;
    await memory.writeFile('/input', Uint8Array.of(65, 13, 10));
    let reads = 0, closure: Promise<void> | undefined;
    const view = new Proxy(memory, { get(target, key) {
      if (key === 'capabilitiesFor' || key === 'readStream') return undefined;
      if (key === 'capabilities') return { ...target.capabilities, streamingRead: false };
      if (key === 'readFile') { reads++; return target.readFile.bind(target); }
      if (key === 'lstat') return async (...args: Parameters<typeof memory.lstat>) => {
        const stat = await memory.lstat(...args);
        if (args[0] !== '/input') return stat;
        return { ...stat, get size() {
          if (reason === 'registered-close') closure = setup.close();
          else setup.caller.abort(reason);
          return stat.size;
        } };
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    Object.assign(setup.context, { args: ['-q', '-n', '/input', '/output'], fs: view });
    try {
      await assert.rejects(setup.run(), error => reason === 'registered-close' ? error instanceof Error : Object.is(error, reason));
      assert.equal(reads, 0);
      assert.deepEqual(await memory.readFile('/input'), Uint8Array.of(65, 13, 10));
      assert.deepEqual((await memory.readdir('/')).map(entry => entry.name), ['input']);
    } finally { await closure; }
  });
}

for (const command of [createDos2unixCommand, createUnix2dosCommand]) {
  test(`actual Shell CPU checkpoint during ${command().name} stops before next input pull`, async context => {
    let now = 0, pulls = 0, closed = false;
    context.mock.method(performance, 'now', () => now);
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(lineEndingCommands());
    const stdin = { async *[Symbol.asyncIterator]() {
      try { now = 10; yield new Uint8Array(10000).fill(65); pulls++; yield Uint8Array.of(66); }
      finally { closed = true; }
    } };
    try {
      await assert.rejects(shell.exec(command().name, { stdin, limits: { maxCpuMs: 5 } }), error => error instanceof ShellLimitError && error.limit === 'maxCpuMs');
      assert.equal(pulls, 0); assert.equal(closed, true);
    } finally { await shell.dispose(); }
  });
}

for (const boundary of ['args', 'argumentValues', 'argument-index'] as const) {
  test(`registered close from ${boundary} blocks remaining argument admission`, async () => {
    const setup = fixture();
    let first = 0, second = 0, carriers = 0, closure: Promise<void> | undefined;
    const args = ['-q', '-q'];
    Object.defineProperty(args, '0', { get() {
      first++; if (boundary === 'argument-index') closure = setup.close(); return '-q';
    } });
    Object.defineProperty(args, '1', { get() { second++; return '-q'; } });
    Object.defineProperty(setup.context, 'args', { get() {
      if (boundary === 'args') closure = setup.close(); return args;
    } });
    Object.defineProperty(setup.context, 'argumentValues', { get() {
      carriers++; if (boundary === 'argumentValues') closure = setup.close(); return undefined;
    } });
    try {
      await assert.rejects(setup.run(), error => error instanceof Error);
      assert.equal(first, boundary === 'argument-index' ? 1 : 0);
      assert.equal(second, 0); assert.equal(carriers, boundary === 'args' ? 0 : 1);
      assert.equal(setup.pulls, 0); assert.equal(setup.chunks.length, 0);
      assert.equal(setup.caller.signal.aborted, false);
    } finally { await closure; }
  });
}
