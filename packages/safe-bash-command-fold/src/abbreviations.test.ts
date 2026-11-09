import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { settings } from 'safe-bash-text-stream-engine/stream-inspection/shared';
import { createFoldCommand } from './command.js';
import { createFoldCommand as createAggregateFoldCommand } from './family.js';

const encoder = new TextEncoder();
function fixture(args: readonly string[], input: string) {
  const stdout: number[] = [], stderr: number[] = [], cleanups: (() => void | Promise<void>)[] = [];
  const carrier = createCommandArguments(args);
  const context = {
    command: 'fold', args: carrier.args, argumentValues: carrier, cwd: '/vfs', env: {},
    signal: new AbortController().signal,
    stdin: (async function* () { yield encoder.encode(input); })(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(...bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(...bytes); } },
    registerCleanup(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
  } as unknown as CommandContext;
  return { context, stdout, stderr, cleanups };
}

for (const [route, command] of [
  ['aggregate', createAggregateFoldCommand(settings({}))],
  ['standalone', createFoldCommand()],
] as const) {
  test(`${route} fold accepts every width prefix with attached and separate arguments`, async () => {
    for (const option of ['--w', '--wi', '--wid', '--widt', '--width']) {
      for (const args of [[`${option}=2`], [option, '3']]) {
        const f = fixture(args, 'abcde');
        try {
          assert.equal((await command.execute(f.context)).exitCode, 0, args.join(' '));
          assert.deepEqual(Uint8Array.from(f.stdout), encoder.encode(args.length === 1 ? 'ab\ncd\ne' : 'abc\nde'));
          assert.equal(f.stderr.length, 0);
        } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
      }
    }
  });
  test(`${route} fold accepts every byte, space and character prefix`, async () => {
    for (const [options, input, output] of [
      [['--b', '--by', '--byt', '--byte', '--bytes'], 'ééé', 'é\né\né'],
      [['--s', '--sp', '--spa', '--spac', '--space', '--spaces'], ' abc', ' \nab\nc'],
      [['--c', '--ch', '--cha', '--char', '--chara', '--charac', '--charact', '--characte', '--character', '--characters'], '界界界', '界界\n界'],
    ] as const) {
      for (const option of options) {
        const f = fixture([option, '-w2'], input);
        try {
          assert.equal((await command.execute(f.context)).exitCode, 0, option);
          assert.deepEqual(Uint8Array.from(f.stdout), encoder.encode(output));
          assert.equal(f.stderr.length, 0);
        } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
      }
    }
  });
  test(`${route} fold rejects unknown long options and arguments on abbreviated flags`, async () => {
    for (const option of ['--unknown', '--widths=2', '--spacesx', '--bytesx', '--=2', '--byt=1', '--space=1', '--char=1']) {
      const f = fixture([option], 'abcde');
      try {
        assert.equal((await command.execute(f.context)).exitCode, 1, option);
        assert.equal(f.stdout.length, 0);
        assert.ok(f.stderr.length > 0);
      } finally { await Promise.all(f.cleanups.map(cleanup => cleanup())); }
    }
  });
}
