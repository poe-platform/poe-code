import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { createFoldCommand } from './command.js';
import { createFoldCommand as familyFold } from './family.js';
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
  } as unknown as CommandContext;
  return { context, stdout, stderr, cleanups };
}
for (const [label, input, width, columns, characters, bytes] of [
  ['wide glyph', '界\bxyz', 3, '界\bxyz', '界\bxyz', '界\n\bxy\nz'],
  ['combining mark', 'a\u0301\bxyz', 3, 'a\u0301\bxy\nz', 'a\u0301\bxy\nz', 'a\u0301\n\bxy\nz'],
  ['ASCII after wide glyph', '界a\bxyz', 3, '界a\bx\nyz', '界a\bxy\nz', '界\na\bx\nyz'],
  ['repeated backspaces', '界\b\bxyz', 3, '界\b\bxyz', '界\b\bxyz', '界\n\b\bx\nyz'],
  ['tab preserves glyph width', '界\t\bABCDE', 7, '界\n\t\bA\nBCDE', '界\n\t\b\nABCDE', '界\t\bAB\nCDE'],
  ['newline preserves glyph width', '界\n\t\bABCDE', 7, '界\n\t\bA\nBCDE', '界\n\t\b\nABCDE', '界\n\t\bABCDE'],
] as const) {
  test(`aggregate and explicit fold backspace width: ${label}`, async () => {
    for (const [flag, expected] of [['', columns], ['-c', characters], ['-b', bytes]] as const) {
      for (const chunkSize of [1, 64]) {
        for (const command of [familyFold(settings({})), createFoldCommand()]) {
          const f = fixture([...(flag ? [flag] : []), `-w${width}`]);
          const source = encoder.encode(input);
          const context = { ...f.context, stdin: (async function* () {
            for (let offset = 0; offset < source.length; offset += chunkSize) yield source.subarray(offset, offset + chunkSize);
          })() };
          assert.equal((await command.execute(context)).exitCode, 0);
          assert.deepEqual(Uint8Array.from(f.stdout), encoder.encode(expected), `${flag} chunk=${chunkSize}`);
          assert.equal(f.stderr.length, 0);
          await Promise.all(f.cleanups.map(cleanup => cleanup()));
        }
      }
    }
  });
}

for (const [input, width, expected] of [
  ['界\bxyz', 3, '界\bxyz'],
  ['a\u0301\bxyz', 3, 'a\u0301\bxy\nz'],
  ['a 界\bxyzz', 4, 'a \n界\bxyzz'],
  ['a a\u0301\bxyzz', 4, 'a \na\u0301\bxyz\nz'],
] as const) {
  test(`aggregate fold rescans backspace widths with -s: ${JSON.stringify(input)}`, async () => {
    for (const command of [familyFold(settings({})), createFoldCommand()]) {
      const f = fixture(['-s', `-w${width}`], input);
      assert.equal((await command.execute(f.context)).exitCode, 0);
      assert.deepEqual(Uint8Array.from(f.stdout), encoder.encode(expected));
      assert.equal(f.stderr.length, 0);
      await Promise.all(f.cleanups.map(cleanup => cleanup()));
    }
  });
}
