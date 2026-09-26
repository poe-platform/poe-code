import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8Codec, pythonCodecs } from 'safe-bash-command-csvkit';
import reference from '../../../../docs/csvkit/in2csv-reference.json' with { type: 'json' };
import userReference from '../../../../docs/csvkit/in2csv-user-edge-reference.json' with { type: 'json' };
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { csvkitCommands } from '../../src/commands/csvkit/index.js';
import { FsError } from '../../src/contracts/index.js';

const options = {
  codecs: [utf8Codec, ...pythonCodecs],
  locale: { profile: 'C', timezone: 'UTC', formatNumber: () => { throw new Error('unmeasured locale formatting'); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";
const workbook = () => Uint8Array.from(Buffer.from(reference.binary['book.xlsx'], 'base64'));

const observations = [
  ...reference.cases.map(item => ({ ...item, binaries: Object.fromEntries(Object.entries(item.binaries).map(([name, key]) => [name, reference.binary[key as keyof typeof reference.binary]])) })),
  ...userReference.cases.map(item => ({ ...item, effects: {} }))
];
for (const [index, item] of observations.entries()) {
  test(`in2csv user shell frozen observation ${index}: ${item.argv.join(' ')}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/work');
    const originals = new Map<string, Uint8Array>();
    for (const [name, content] of Object.entries(item.files)) originals.set(name, new TextEncoder().encode(content));
    for (const [name, base64] of Object.entries(item.binaries)) originals.set(name, Uint8Array.from(Buffer.from(base64, 'base64')));
    for (const [name, bytes] of originals) await fs.writeFile(`/work/${name}`, bytes);
    const shell = new Shell({ fs, cwd: '/work' }).use(csvkitCommands(options));
    try {
      const stdin = 'stdinBase64' in item && item.stdinBase64 ? Uint8Array.from(Buffer.from(item.stdinBase64, 'base64')) : item.stdin;
      const result = await shell.exec(['in2csv', ...item.argv.map(quote)].join(' '), { stdin });
      const effects: Record<string, string> = {};
      for (const [name, bytes] of originals) assert.deepEqual(await fs.readFile(`/work/${name}`), bytes);
      for (const entry of await fs.readdir('/work')) {
        const bytes = await fs.readFile(`/work/${entry.name}`);
        if (!originals.has(entry.name)) effects[entry.name] = Buffer.from(bytes).toString('base64');
      }
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode, effects },
        { stdout: item.stdout, stderr: item.stderr, status: item.status, effects: item.effects });
    } finally { await shell.dispose(); }
  });
}

test('in2csv user workbook selector failure validates every sheet before truncating any side file', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/book.xlsx', workbook());
  const previous = new TextEncoder().encode('previous contents');
  await fs.writeFile('/book_0.csv', previous);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("in2csv --write-sheets First,Missing /book.xlsx");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
      { stdout: 'n,text\n3,second\n', stderr: "KeyError: 'Worksheet Missing does not exist.'\n", status: 1 });
    assert.deepEqual(await fs.readFile('/book_0.csv'), previous);
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['book.xlsx', 'book_0.csv']);
  } finally { await shell.dispose(); }
});

test('in2csv user side-file directory collision preserves prior exports and existing directory', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/book.xlsx', workbook());
  await fs.mkdir('/book_1.csv');
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec('in2csv --write-sheets - /book.xlsx');
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
      { stdout: 'n,text\n3,second\n', stderr: "IsADirectoryError: [Errno 21] Is a directory: '/book_1.csv'\n", status: 1 });
    assert.deepEqual(await fs.readFile('/book_0.csv'), new TextEncoder().encode('n,text\n2.5,é\n'));
    assert.deepEqual(await fs.readdir('/book_1.csv'), []);
    assert.deepEqual(await fs.readFile('/book.xlsx'), workbook());
  } finally { await shell.dispose(); }
});

test('in2csv user named workbook reopens after stdout and preserves files when reopening fails', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/book.xlsx', workbook());
  const previous = new TextEncoder().encode('existing export');
  await fs.writeFile('/book_0.csv', previous);
  const read = fs.readStream!.bind(fs);
  let opens = 0;
  Object.assign(fs, { readStream(path: string, settings: Parameters<typeof read>[1]) {
    if (path === '/book.xlsx' && ++opens === 2) throw new FsError('EACCES', { syscall: 'readStream', path });
    return read(path, settings);
  } });
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec('in2csv --write-sheets - /book.xlsx');
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
      { stdout: 'n,text\n3,second\n', stderr: "PermissionError: [Errno 13] Permission denied: '/book.xlsx'\n", status: 1 });
    assert.equal(opens, 2);
    assert.deepEqual(await fs.readFile('/book_0.csv'), previous);
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['book.xlsx', 'book_0.csv']);
  } finally { await shell.dispose(); }
});
