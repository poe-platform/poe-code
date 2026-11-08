// Explicit source-only suite: XAN is not publicly exported or registered by default.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Shell } from '../../src/shell/index.ts';
import { createMemoryFileSystem } from '../../src/fs/memory/index.ts';
import { xanCommands } from '../../src/commands/xan/index.ts';
async function run(options, data = 'name,n\nAda,1\nGrace,2\n') {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/data', new TextEncoder().encode(data));
  const shell = new Shell({fs, cwd:'/'}).use(xanCommands());
  try { return await shell.exec(`xan slice ${options} data`); }
  finally { await shell.dispose(); }
}
for (const [options, stdout] of [
  ['--byte-offset=7', 'name,n\nAda,1\nGrace,2\n'],
  ['-B7', 'name,n\nAda,1\nGrace,2\n'],
  ['--end-byte=14', 'name,n\nAda,1\nGrace,2\n'],
  ['--raw -B7 --end-byte=14', 'name,n\nAda,1\nG'],
  ['--start-condition \'n == "1"\'', 'name,n\nAda,1\nGrace,2\n'],
  ['-S \'n == "2"\'', 'name,n\nGrace,2\n'],
  ['--end-condition \'n == "2"\'', 'name,n\nAda,1\n'],
  ['-E \'n == "1"\'', 'name,n\n'],
  ['-S \'n == "2"\' -l1', 'name,n\nGrace,2\n'],
  ['-B13', 'name,n\nGrace,2\n'],
  ['-n --raw -B7 --end-byte=14', 'Ada,1\nG'],
]) test(options, async () => {
  const result = await run(options);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, stdout);
});
test('raw bytes preserve CSV spelling and UTF-8 byte boundaries', async () => {
  assert.equal((await run('--raw -B4 --end-byte=10', 'a,b\n"é",2\n')).stdout, 'a,b\n"é",2');
});
for (const options of ['--raw', '-B14 --end-byte=7', '-I0 -S \'n == "1"\'', '-S \'missing == "1"\'', '-Bno'])
  test(`reject ${options}`, async () => assert.equal((await run(options)).exitCode, 1));
test('numeric conditions and row ranges apply after the start match', async () => {
  const result = await run('-S "n >= 2" -s1 -l1', 'name,n\nA,1\nB,2\nC,3\nD,4\n');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'name,n\nC,3\n');
});
test('no-header raw mode never parses the CSV payload', async () => {
  const result = await run('-n --raw -B0 --end-byte=5', 'a"b,c\n');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'a"b,c');
});
test('raw mode enforces its invocation output budget', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/data', new TextEncoder().encode('x'.repeat(100)));
  const shell = new Shell({fs,cwd:'/'}).use(xanCommands({limits:{maxOutputBytes:10}}));
  try {
    const result = await shell.exec('xan slice -n --raw -B0 --end-byte=100 data');
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
  } finally { await shell.dispose(); }
});
test('byte slicing works across one-byte producer chunks and closes streams', async () => {
  const fs = createMemoryFileSystem();
  const data = new TextEncoder().encode('name,n\nAda,1\nGrace,2\n');
  await fs.writeFile('/data', data);
  let closed = 0;
  fs.readStream = () => (async function* () {
    try { for (const byte of data) yield new Uint8Array([byte]); }
    finally { closed++; }
  })();
  const shell = new Shell({fs,cwd:'/'}).use(xanCommands());
  try {
    const result = await shell.exec('xan slice --raw -B7 --end-byte=14 data');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'name,n\nAda,1\nG');
    assert.equal(closed, 2);
  } finally { await shell.dispose(); }
});
