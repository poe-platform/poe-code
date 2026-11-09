import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { createFoldCommand as familyFold } from './family.js';
import { settings } from 'safe-bash-text-stream-engine/stream-inspection/shared';
const encoder = new TextEncoder();
function fixture(args: readonly string[], input = '') {
  const stdout: number[] = [], stderr: number[] = [], cleanups: (() => void | Promise<void>)[] = [];
  const carrier = createCommandArguments(args);
  const context = {
    command: 'fold', args: carrier.args, argumentValues: carrier, cwd: '/', env: {},
    signal: new AbortController().signal,
    stdin: (async function* () { yield encoder.encode(input); })(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(...bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(...bytes); } },
    registerCleanup(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
    fs: {},
  } as unknown as CommandContext;
  return { context, stdout, stderr, cleanups };
}

test('agent family breaks after Unicode blanks without changing separator bytes', async () => {
  for (const cp of [0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2008, 0x2009, 0x200a, 0x205f, 0x3000]) {
    const blank = String.fromCodePoint(cp);
    for (const mode of ['', '-c', '-b']) {
      const width = mode === '-b' ? encoder.encode(blank).length + 2 : mode === '-c' || cp !== 0x3000 ? 3 : 4;
      for (const chunkSize of [1, 64]) {
        const f = fixture([...(mode ? [mode] : []), '-s', `-w${width}`]);
        const input = encoder.encode(`a${blank}bcd`);
        const context = { ...f.context, stdin: (async function* () {
          for (let offset = 0; offset < input.length; offset += chunkSize) yield input.subarray(offset, offset + chunkSize);
        })() };
        assert.equal((await familyFold(settings({})).execute(context)).exitCode, 0);
        assert.deepEqual(f.stdout, [...encoder.encode(`a${blank}\nbcd`)], `U+${cp.toString(16)} ${mode} chunk ${chunkSize}`);
        assert.equal(f.stderr.length, 0);
        await Promise.all(f.cleanups.map(cleanup => cleanup()));
      }
    }
  }
});

test('agent family preserves retained suffixes and excludes nonbreaking blanks', async () => {
  for (const [input, output] of [
    ['a\u2003bc\u2003defgh', 'a\u2003\nbc\u2003\ndefg\nh'],
    ['a\u2003b\u2007cdef', 'a\u2003\nb\u2007cd\nef'],
    ['ab\u00a0cd', 'ab\u00a0c\nd'],
    ['ab\u2007cd', 'ab\u2007c\nd'],
  ]) {
    const f = fixture(['-sw4'], input);
    assert.equal((await familyFold(settings({})).execute(f.context)).exitCode, 0);
    assert.deepEqual(f.stdout, [...encoder.encode(output)]);
    assert.equal(f.stderr.length, 0);
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});

test('agent family keeps C locale byte wrapping at encoded Unicode blanks', async () => {
  for (const blank of ['\u2003', '\u3000']) {
    const f = fixture(['-sw5'], `a${blank}bcd`);
    assert.equal((await familyFold(settings({})).execute({ ...f.context, env: { LC_ALL: 'C' } })).exitCode, 0);
    assert.deepEqual(f.stdout, [...encoder.encode(`a${blank}b\ncd`)]);
    assert.equal(f.stderr.length, 0);
    await Promise.all(f.cleanups.map(cleanup => cleanup()));
  }
});
