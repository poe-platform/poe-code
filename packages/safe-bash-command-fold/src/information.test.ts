import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCommandArguments, type CommandContext, type CommandDefinition } from 'safe-bash-contracts/command';
import { settings } from 'safe-bash-text-stream-engine/stream-inspection/shared';
import { createFoldCommand } from './command.js';
import { createFoldCommand as familyFold } from './family.js';

async function run(command: CommandDefinition, args: readonly string[], env: Record<string, string> = {}, input?: string) {
  const stdout: number[] = [], stderr: number[] = [];
  const carrier = createCommandArguments(args);
  const source = (path: string) => {
    assert.notEqual(input, undefined, `unexpected input read: ${path}`);
    return (async function* () { yield new TextEncoder().encode(input); })();
  };
  const context = {
    command: 'fold', args: carrier.args, argumentValues: carrier, env, cwd: '/vfs',
    signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { return source('-')[Symbol.asyncIterator](); } },
    stdout: { async write(bytes: Uint8Array) { stdout.push(...bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(...bytes); } },
    fs: {
      capabilities: { streamingRead: true },
      async stat() { return { type: 'file' }; },
      readStream: source,
    },
  } as unknown as CommandContext;
  const result = await command.execute(context);
  return { exitCode: result.exitCode, stdout: new TextDecoder().decode(Uint8Array.from(stdout)), stderr: new TextDecoder().decode(Uint8Array.from(stderr)) };
}

for (const [route, command] of [['standalone', createFoldCommand()], ['aggregate', familyFold(settings({}))]] as const) {
  for (const option of ['help', 'version']) {
    test(`${route} fold accepts information prefixes with other arguments without reading input`, async () => {
      const expected = await run(command, [`--${option}`]);
      assert.equal(expected.exitCode, 0);
      assert.equal(expected.stderr, '');
      assert.ok(expected.stdout.includes(option === 'help' ? 'Usage: fold' : 'fold'));
      for (let length = 1; length <= option.length; length++) {
        const prefix = `--${option.slice(0, length)}`;
        for (const args of [[prefix], ['-w2', prefix], [prefix, 'unused'], ['unused', prefix], [prefix, '--unknown'], ['-sc', '--wid', '2', prefix], ['-b12', prefix]]) {
          assert.deepEqual(await run(command, args), expected, args.join(' '));
        }
      }
    });
  }

  test(`${route} fold preserves information option order and preceding errors`, async () => {
    for (const [first, second, full] of [['--hel', '--ver', '--help'], ['--ver', '--hel', '--version']]) {
      assert.deepEqual(await run(command, [first!, second!]), await run(command, [full!]));
    }
    for (const args of [['--unknown', '--help'], ['-q', '--hel'], ['--helpful', '--ver'], ['--hel=yes', '--version'], ['--ver=', '--help'], ['-w', '--help'], ['--wid', '--ver'], ['-w0', '--help'], ['-wbad', '--ver'], ['-12b', '--help']]) {
      const result = await run(command, args);
      assert.equal(result.exitCode, 1, args.join(' '));
      assert.equal(result.stdout, '', args.join(' '));
      assert.notEqual(result.stderr, '', args.join(' '));
    }
  });

  test(`${route} fold respects -- and POSIX operand boundaries`, async () => {
    for (const option of ['--help', '--hel', '--version', '--ver']) {
      assert.deepEqual(await run(command, ['--', option], {}, 'literal\n'), { exitCode: 0, stdout: 'literal\n', stderr: '' });
      for (const value of ['', '1']) {
        const env = { POSIXLY_CORRECT: value };
        assert.deepEqual(await run(command, ['-w2', 'file', option], env, 'abc\n'), { exitCode: 0, stdout: 'ab\nc\nab\nc\n', stderr: '' });
        assert.deepEqual(await run(command, ['-', option], env, 'literal\n'), { exitCode: 0, stdout: 'literal\nliteral\n', stderr: '' });
        assert.deepEqual(await run(command, ['-w', '2', option, 'unused'], env), await run(command, [option]));
      }
    }
  });
}
