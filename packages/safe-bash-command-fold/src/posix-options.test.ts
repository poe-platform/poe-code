import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { FsError } from 'safe-bash-contracts/errors';
import { createFoldCommand } from './command.js';
import { createFoldCommand as createFamilyFoldCommand } from './family.js';
import { settings } from 'safe-bash-text-stream-engine/stream-inspection/shared';

const encoder = new TextEncoder();
function fixture(args: readonly string[], input = '', files: Record<string, string> = {}) {
  const stdout: number[] = [], stderr: number[] = [];
  const carrier = createCommandArguments(args);
  const context = {
    command: 'fold', args: carrier.args, argumentValues: carrier, cwd: '/vfs', env: {},
    signal: new AbortController().signal,
    stdin: (async function* () { yield encoder.encode(input); })(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(...bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(...bytes); } },
    fs: {
      capabilities: { streamingRead: true },
      async stat(path: string) {
        if (!(path in files)) throw new FsError('ENOENT', { path });
        return { type: 'file' };
      },
      async *readStream(path: string) {
        if (!(path in files)) throw new FsError('ENOENT', { path });
        yield encoder.encode(files[path]);
      },
    },
  } as unknown as CommandContext;
  return { context, stdout, stderr, text: () => new TextDecoder().decode(Uint8Array.from(stdout)) };
}

for (const [route, command] of [
  ['standalone', createFoldCommand()],
  ['aggregate', createFamilyFoldCommand(settings({}))],
] as const) {
  for (const posix of ['1', '']) {
    for (const operand of ['a', '-']) {
      for (const file of ['-w2', '-2', '--width=2', '--help', '--version', '--']) {
        test(`${route} fold reads ${file} after ${operand} with POSIXLY_CORRECT=${JSON.stringify(posix)}`, async () => {
          const f = fixture([operand, file], 'abcde', { '/vfs/a': 'abcde', [`/vfs/${file}`]: 'FILE\n' });
          const result = await command.execute({ ...f.context, env: { POSIXLY_CORRECT: posix } });
          assert.equal(result.exitCode, 0);
          assert.deepEqual(f.stdout, [...encoder.encode('abcdeFILE\n')]);
          assert.deepEqual(f.stderr, []);
        });
      }
    }
  }
  for (const env of [{}, { POSIXLY_CORRECT: '1' }, { POSIXLY_CORRECT: '' }]) {
    test(`${route} fold preserves width values and operand boundaries with ${JSON.stringify(env)}`, async () => {
      for (const prefix of [['-w', '2'], ['--width', '2'], ['-sw', '2'], ['-2']]) {
        for (const boundary of env.POSIXLY_CORRECT === undefined ? [['--']] : [[], ['--']]) {
          const f = fixture([...prefix, ...boundary, 'a', '-w2', '--help'], '', {
            '/vfs/a': 'abcde', '/vfs/-w2': 'XY', '/vfs/--help': 'Z\n',
          });
          const result = await command.execute({ ...f.context, env });
          assert.equal(result.exitCode, 0);
          assert.equal(f.text(), 'ab\ncd\neXYZ\n');
          assert.deepEqual(f.stderr, []);
        }
      }
    });
  }
  test(`${route} fold permutes options when POSIXLY_CORRECT is unset`, async () => {
    for (const option of ['-w2', '-2', '--width=2']) {
      const f = fixture(['a', option], '', { '/vfs/a': 'abcde' });
      assert.equal((await command.execute(f.context)).exitCode, 0);
      assert.equal(f.text(), 'ab\ncd\ne');
      assert.deepEqual(f.stderr, []);
    }
  });
}
