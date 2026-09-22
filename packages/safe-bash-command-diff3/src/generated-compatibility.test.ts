import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCommandArguments, type CommandContext, type CommandResult } from 'safe-bash-contracts/command';
import { createDiff3Command, diff3 } from './command.js';
import { generatedControls } from './generated-controls.js';
import type { Diff3RunOptions } from './command.js';

// Independently map the captured inventory; do not derive SDK options from the
// CLI parser under test. Expected bytes were produced only by the manual oracle.
const modes: Record<string, Omit<Diff3RunOptions, 'files'>> = {
  '': {}, '-m': { merge: true }, '-mE': { merge: true, selector: 'E' },
  '-e': { selector: 'e' }, '-x': { selector: 'x' }, '-X': { selector: 'X' }, '-3': { selector: '3' },
  '-A': { selector: 'A' }, '-E': { selector: 'E' },
};
const paths = ['ours', 'base', 'theirs'];
const hex = (bytes: readonly number[]) => bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');

for (const [sample, control] of generatedControls.entries()) {
  test(`independent GNU 3.12 triple ${sample}: CLI/SDK bytes, status and effects`, async () => {
    for (const expected of control.results) {
      const options = modes[expected.args[0] ?? ''];
      assert.ok(options);
      assert.ok(expected.args.length === 0 || expected.args.length === 1 || (expected.args.length === 3 && expected.args[1] === '-L'));
      for (const sdk of [false, true]) {
        const files = control.inputs.map(bytes => Uint8Array.from(bytes));
        const stdout: number[] = [], stderr: number[] = [];
        const cleanups: (() => void | Promise<void>)[] = [];
        let opened = 0, closed = 0;
        const signal = new AbortController().signal;
        const carrier = createCommandArguments([...expected.args, ...paths]);
        const context = {
          command: 'diff3', args: carrier.args, argumentValues: carrier, cwd: '/vfs', env: {}, signal,
          stdin: { [Symbol.asyncIterator]() { assert.fail('No stdin authority for file operands'); } },
          stdout: { async write(bytes: Uint8Array) { stdout.push(...bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr.push(...bytes); } },
          registerCleanup(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
          fs: { readStream(path: string, readOptions: { signal: AbortSignal }) {
            assert.ok(cleanups.length, 'cleanup precedes acquisition');
            assert.ok(readOptions.signal instanceof AbortSignal);
            const index = paths.findIndex(file => path === `/vfs/${file}`);
            assert.ok(index >= 0, 'VFS authority is limited to the three supplied operands');
            opened++;
            return (async function* () {
              const scratch = new Uint8Array(1);
              try {
                for (const byte of files[index]!) {
                  readOptions.signal.throwIfAborted(); scratch[0] = byte; yield scratch;
                }
              } finally { scratch.fill(0); closed++; }
            })();
          } },
        } as unknown as CommandContext;
        const result: CommandResult = sdk
          ? await diff3(context, { files: paths, ...options, ...(expected.args.length === 3 ? { labels: [expected.args[2]!] } : {}) })
          : await createDiff3Command().execute(context);
        assert.equal(result.exitCode, expected.status);
        assert.equal(hex(stdout), expected.stdout);
        assert.equal(hex(stderr), expected.stderr);
        assert.equal(opened, 3); assert.equal(closed, opened);
        for (const cleanup of cleanups) { await cleanup(); await cleanup(); }
        assert.deepEqual(files.map(bytes => Array.from(bytes)), control.inputs);
        if (sdk) {
          const accounting = (result as Awaited<ReturnType<typeof diff3>>).accounting;
          assert.equal(accounting.retainedBytes, 0);
          assert.equal(accounting.graphCells, 0);
          assert.equal(accounting.tokens, 0);
        }
      }
    }
  });
}
