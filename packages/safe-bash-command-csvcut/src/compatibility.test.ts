import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandArguments, type CommandContext } from 'safe-bash-contracts/command';
import { csvcut, type CsvcutInvocation } from './command.js';

// Literal controls derived from the supplied upstream contract, not candidate helpers.
const controls: readonly [string, string[], CsvcutInvocation, string, string][] = [
  ['duplicate-blank-exact', ['-c', 'id,,x-y,id'], { include: 'id,,x-y,id' }, 'id,,id,x-y\nA,B,C,D\n', 'id,,x-y,id\nA,B,D,A\n'],
  ['numeric-position', ['-c2,1,2'], { include: '2,1,2' }, '2,1\nx,y\n', '1,2,1\ny,x,y\n'],
  ['quoted-unicode-crlf', ['-c2,1'], { include: '2,1' }, '\ufeffa,b\r\n"é,😀","x\r\ny"\r\n', 'b,a\n"x\n\ny","é,😀"\n'],
  ['tabs-override', ['-d;', '-t', '-c2'], { include: '2', dialect: { delimiter: ';', tabs: true } }, 'a\tb\nx\ty\n', 'b\ny\n'],
  ['width-pad-discard', ['-c3,1,3'], { include: '3,1,3' }, 'a,b,c\nshort\nx,y,z,excess\n', 'c,a,c\n,short,\nz,x,z\n'],
  ['empty-after-projection', ['-xc1'], { include: '1', deleteEmptyRows: true }, 'a,b\n,keep\n ,\n0,\n,\n', 'a\n \n0\n'],
  ['zero-columns', ['-C1,2'], { exclude: '1,2' }, 'a,b\nx,y\n,\n', '\n\n\n'],
  ['unknown-exclusions', ['-Cmissing,999'], { exclude: 'missing,999' }, 'a,b\nx,y\n', 'a,b\nx,y\n'],
  ['physical-skip', ['-K2'], { dialect: { skipLines: 2 } }, 'ignored\nignored\na,b\nx,y\n', 'a,b\nx,y\n'],
  ['names-zero', ['-n', '--zero'], { names: true, zero: true }, ',id,id\n', '  0: \n  1: id\n  2: id\n'],
  ['empty-input', [], {}, '', '\n'],
  ['open-range', ['-c2-'], { include: '2-' }, 'a,b,c\nx,y,z\n', 'b,c\ny,z\n'],
  ['zero-open-start', ['--zero', '-c:1'], { zero: true, include: ':1' }, 'a,b,c\nx,y,z\n', 'b\ny\n'],
  ['generated-names', ['-H', '-c26-29'], { headerless: true, include: '26-29' }, '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29\n', 'z,aa,bb,cc\n26,27,28,29\n'],
  ['permissive-quoted-eof', [], {}, 'a\n"unfinished', 'a\nunfinished\n'],
  ['python39-nul-deviation', ['-c1'], { include: '1' }, 'a\nx\0y\n', 'a\nx\0y\n'],
  ['embedded-crlf-no-bom', [], {}, 'a\n"x\r\ny"\n', 'a\n"x\n\ny"\n'],
];

async function invoke(args: string[], input: string, split: number, options?: CsvcutInvocation) {
  const carrier = createCommandArguments(args), bytes = new TextEncoder().encode(input);
  const output: number[] = [], errors: number[] = [], cleanups: (() => Promise<void>)[] = [];
  let retired = 0, acquired = 0;
  const context = {
    command: 'csvcut', args: carrier.args, argumentValues: carrier, cwd: '/',
    env: { PYTHONIOENCODING: 'ascii' }, signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() {
      assert.ok(cleanups.length); acquired++;
      const chunks = [bytes.subarray(0, split), new Uint8Array(), bytes.subarray(split)];
      let index = 0;
      return { async next() { return index < chunks.length ? { done: false, value: chunks[index++]! } : { done: true, value: undefined }; },
        async return() { retired++; return { done: true, value: undefined }; } };
    } },
    stdout: { async write(chunk: Uint8Array) { output.push(...chunk); } },
    stderr: { async write(chunk: Uint8Array) { errors.push(...chunk); } },
    fs: {}, registerCleanup(cleanup: () => Promise<void>) { cleanups.push(cleanup); },
  } as unknown as CommandContext;
  const result = await csvcut(context, options);
  for (const cleanup of cleanups) { await cleanup(); await cleanup(); }
  assert.equal(retired, acquired);
  return { status: result.exitCode, output: new TextDecoder().decode(new Uint8Array(output)), error: new TextDecoder().decode(new Uint8Array(errors)), acquired };
}

for (const [name, args, options, input, expected] of controls) test(name, async () => {
  for (let split = 0; split <= new TextEncoder().encode(input).length; split++) {
    for (const sdk of [false, true]) {
      const result = await invoke(sdk ? [] : args, input, split, sdk ? options : undefined);
      assert.equal(result.status, 0); assert.equal(result.output, expected); assert.equal(result.error, '');
    }
  }
});

test('negative selector, grammar and explicit capability controls', async () => {
  for (const [args, status, acquisition] of [
    [['-c', ' id'], 1, 1], [['-c', 'missing'], 1, 1], [['-C', '1-99'], 1, 1],
    [['-nH'], 1, 0], [['--ignore-unknown-columns'], 2, 0], [['-c'], 2, 0],
    [['-u1'], 1, 0], [['-e', 'latin1'], 1, 0], [['--snifflimit', '10'], 2, 0],
    [['--zero', '-c1-'], 1, 1],
  ] as const) {
    const result = await invoke([...args], 'id,value\nx,y\n', 1);
    assert.equal(result.status, status); assert.equal(result.output, '');
    assert.equal(result.acquired, acquisition); assert.ok(result.error.length);
  }
  const empty = await invoke(['-n'], '', 0);
  assert.equal(empty.status, 1); assert.equal(empty.output, '');
});
