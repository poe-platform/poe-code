import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8Codec } from 'safe-bash-command-csvkit';
import reference from '../../../../docs/csvkit/in2csv-geojson-user-edge-reference.json' with { type: 'json' };
import commonFlagsReference from '../../../../docs/csvkit/in2csv-geojson-reference.json' with { type: 'json' };
import { Shell } from '../../src/shell/index.js';
import { CommandRegistry } from '../../src/contracts/index.js';
import { streamCommands } from '../../src/commands/streams.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { csvkitCommands } from '../../src/commands/csvkit/index.js';

const options = {
  codecs: [utf8Codec],
  locale: { profile: 'C', timezone: 'UTC', formatNumber: () => { throw new Error('raw GeoJSON must not infer types'); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
for (const item of reference.cases) {
  test(`in2csv GeoJSON user edge: ${item.name}`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = new TextEncoder().encode(item.stdin);
    await fs.writeFile('/input.geojson', bytes);
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    const expected = { stdout: item.stdout, stderr: item.stderr, status: item.status };
    try {
      const stdin = { async *[Symbol.asyncIterator]() {
        const borrowed = new Uint8Array(3);
        for (let offset = 0; offset < bytes.length; offset += borrowed.length) {
          const length = Math.min(borrowed.length, bytes.length - offset);
          borrowed.set(bytes.subarray(offset, offset + length));
          yield borrowed.subarray(0, length);
        }
        borrowed.fill(0);
      } };
      for (const result of [
        await shell.exec('in2csv -f geojson', { stdin }),
        await shell.exec('in2csv -f geojson /input.geojson')
      ]) assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, expected);
      assert.deepEqual(await fs.readFile('/input.geojson'), bytes);
      assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['input.geojson']);
    } finally { await shell.dispose(); }
  });
}

test('in2csv GeoJSON user workflow preserves raw cells through pipe and virtual redirection', async () => {
  const item = reference.cases.find(item => item.name === 'negative floats and exponent')!;
  const fs = new MemoryFileSystem();
  const bytes = new TextEncoder().encode(item.stdin);
  await fs.writeFile('/input.geojson', bytes);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const redirected = await shell.exec('in2csv -f geojson < /input.geojson > /converted.csv');
    assert.deepEqual({ stdout: redirected.stdout, stderr: redirected.stderr, status: redirected.exitCode }, { stdout: '', stderr: '', status: 0 });
    assert.deepEqual(await fs.readFile('/converted.csv'), new TextEncoder().encode(item.stdout));
    const piped = await shell.exec('in2csv -f geojson < /input.geojson | csvcut -c 1 > /ids.csv');
    assert.deepEqual({ stdout: piped.stdout, stderr: piped.stderr, status: piped.exitCode }, { stdout: '', stderr: '', status: 0 });
    // Measured with original in2csv and csvcut executables under the frozen profile.
    assert.deepEqual(await fs.readFile('/ids.csv'), new TextEncoder().encode('id\n-0.0\n'));
    assert.deepEqual(await fs.readFile('/input.geojson'), bytes);
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['converted.csv', 'ids.csv', 'input.geojson']);
  } finally { await shell.dispose(); }
});

test('in2csv GeoJSON cat pipeline ignores common flags and preserves virtual files', async () => {
  const item = commonFlagsReference.cases.find(item => item.name === 'ignored common flags')!;
  const fs = new MemoryFileSystem();
  const bytes = new TextEncoder().encode(item.stdin);
  await fs.writeFile('/input.geojson', bytes);
  const shell = new Shell({ fs, commands: new CommandRegistry(streamCommands()) }).use(csvkitCommands(options));
  const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";
  try {
    const result = await shell.exec('cat /input.geojson | in2csv ' + item.argv.map(quote).join(' ') + ' > /converted.csv');
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: '', stderr: item.stderr, status: item.status });
    assert.deepEqual(await fs.readFile('/converted.csv'), new TextEncoder().encode(item.stdout));
    assert.deepEqual(await fs.readFile('/input.geojson'), bytes);
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['converted.csv', 'input.geojson']);
  } finally { await shell.dispose(); }
});
