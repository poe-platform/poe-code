import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { createFoldCommand, fold } from './command.js';
import { FoldError } from './contracts.js';
import { createFoldEngine } from './engine.js';
import { createFoldCommand as createAggregateFoldCommand } from './family.js';
import { settings } from 'safe-bash-text-stream-engine/stream-inspection/shared';
const encoder = new TextEncoder();
function fixture(args: readonly string[], input = '') {
  const stdout: number[] = [], stderr: number[] = [], cleanups: (() => void | Promise<void>)[] = [];
  const carrier = createCommandArguments(args);
  const context = {
    command: 'fold', args: carrier.args, argumentValues: carrier, cwd: '/vfs', env: {},
    signal: new AbortController().signal,
    stdin: (async function* () { yield encoder.encode(input); })(),
    stdout: { async write(bytes: Uint8Array) { await Promise.resolve(); for (const byte of bytes) stdout.push(byte); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(...bytes); } },
    registerCleanup(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
    fs: {},
  } as unknown as CommandContext;
  return { context, stdout, stderr, cleanups };
}
// GNU coreutils 9.10 uses a 256 KiB line buffer. Flushing forgets prior
// blanks without resetting the column or adding a newline.
for (const route of ['standalone', 'sdk', 'aggregate'] as const) {
  for (const width of [8191, 8192, 8193, 262143, 262144, 262145]) {
    test(`${route} fold preserves GNU word breaks at width ${width}`, async () => {
      for (const ending of ['', '\n']) {
        const input = 'x ' + 'a'.repeat(width) + ending;
        const expected = width < 262144
          ? 'x \n' + 'a'.repeat(width) + ending
          : 'x ' + 'a'.repeat(width - 2) + '\naa' + ending;
        for (const chunkSize of [4093, input.length]) {
          const f = fixture([`-sw${width}`]);
          const bytes = encoder.encode(input);
          const context = { ...f.context, stdin: (async function* () {
            for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, offset + chunkSize);
          })() };
          const result = route === 'sdk'
            ? await fold(context, { width, spaces: true })
            : await (route === 'aggregate' ? createAggregateFoldCommand(settings({})) : createFoldCommand()).execute(context);
          assert.equal(result.exitCode, 0);
          assert.equal(f.stdout.indexOf(10), width < 262144 ? 2 : width);
          assert.equal(Buffer.compare(Buffer.from(f.stdout), Buffer.from(expected)), 0, `chunk ${chunkSize}, final LF ${Boolean(ending)}`);
          assert.equal(f.stderr.length, 0);
          if ('accounting' in result) {
            const usage = (result as Awaited<ReturnType<typeof fold>>).accounting;
            assert.equal(usage.inputBytes, bytes.length);
            assert.equal(usage.decodedBytes, bytes.length);
            assert.equal(usage.outputBytes, encoder.encode(expected).length);
            assert.equal(usage.retainedBytes, 0);
          }
          await Promise.all(f.cleanups.map(cleanup => cleanup()));
        }
      }
    });
  }
}

for (const route of ['standalone', 'aggregate'] as const) {
  test(`${route} flushes encoded scalars without reordering lines or resetting columns`, async () => {
    const prefix = 'x \r' + '\u0301'.repeat(131071);
    const input = 'ok\n' + prefix + 'abcd';
    const f = fixture(['-sw3'], input);
    const command = route === 'aggregate' ? createAggregateFoldCommand(settings({})) : createFoldCommand();
    assert.equal((await command.execute(f.context)).exitCode, 0);
    assert.equal(Buffer.compare(Buffer.from(f.stdout), Buffer.from('ok\n' + prefix + 'abc\nd')), 0);
    assert.equal(f.stderr.length, 0);
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  });

  test(`${route} charges output limits across finite buffer flushes`, async () => {
    const input = 'x ' + 'a'.repeat(262144);
    for (const maximum of [input.length, input.length + 1]) {
      const f = fixture(['-sw262144'], input);
      const command = route === 'aggregate'
        ? createAggregateFoldCommand(settings({ limits: { maxOutputBytes: maximum } }))
        : createFoldCommand({ limits: { outputBytes: maximum } });
      if (maximum === input.length && route === 'standalone') {
        await assert.rejects(command.execute(f.context) as Promise<unknown>, error => error instanceof FoldError && error.code === 'LIMIT');
      } else {
        assert.equal((await command.execute(f.context)).exitCode, maximum === input.length ? 1 : 0);
      }
      assert.ok(f.stdout.length <= maximum);
      if (maximum > input.length) assert.equal(f.stdout.length, maximum);
      await Promise.all(f.cleanups.map(cleanup => cleanup()));
    }
  });
}

test('engine admission reserves the released line buffer and decoder', () => {
  const options = { width: 80, mode: 'columns', spaces: true, files: [] } as const;
  for (const retainedBytes of [8196, 262147]) {
    assert.throws(() => createFoldEngine(options, 'C', { retainedBytes }), error => error instanceof FoldError && error.code === 'LIMIT');
  }
  const engine = createFoldEngine(options, 'C', { retainedBytes: 262148 });
  engine.dispose();
});
