import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8Codec, pythonCodecs } from '@poe-code/csvkit';
import reference from '../../../../docs/csvkit/json-input-operation-reference.json' with { type: 'json' };
import nativeReference from '../../../../docs/csvkit/in2csv-json-native-reference.json' with { type: 'json' };
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { csvkitCommands } from '../../src/commands/csvkit/index.js';

const options = {
  codecs: [utf8Codec, ...pythonCodecs],
  locale: { profile: 'C', timezone: 'UTC', formatNumber: () => { throw new Error('unqualified locale'); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";

// Nested flattening is disputed by the requested semantics. Empty-object rows
// have a separate differential below with injected deployment warning provenance.
const measuredCases = [0, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const measuredNativeCases = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const observations = [
  ...measuredCases.map(index => ({ label: `ordered input ${index}`, item: reference.cases[index]! })),
  ...measuredNativeCases.map(index => ({ label: `native typed input ${index}`, item: nativeReference.cases[index]! }))
];
for (const { label, item } of observations) {
  test(`in2csv JSON independent shell differential ${label}, reused byte chunks and preserved named input`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = new TextEncoder().encode(item.stdin);
    await fs.writeFile('/input.json', bytes);
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    const expected = { stdout: item.stdout, stderr: item.stderr, status: item.status };
    try {
      const command = ['in2csv', ...item.argv.map(quote)].join(' ');
      const source = { async *[Symbol.asyncIterator]() {
        const chunk = new Uint8Array(1);
        yield new Uint8Array();
        for (const byte of bytes) { chunk[0] = byte; yield chunk; }
        chunk[0] = 0;
      } };
      const streamed = await shell.exec(command, { stdin: source });
      assert.deepEqual({ stdout: streamed.stdout, stderr: streamed.stderr, status: streamed.exitCode }, expected);
      const named = await shell.exec(command + ' -- /input.json');
      assert.deepEqual({ stdout: named.stdout, stderr: named.stderr, status: named.exitCode }, expected);
      assert.deepEqual(await fs.readFile('/input.json'), bytes);
      assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['input.json']);
    } finally { await shell.dispose(); }
  });
}

test('in2csv JSON original empty-object rows retain the injected Agate Table warning identity', async () => {
  const item = reference.cases[5]!;
  const fromObjectPath = item.stderr.slice(0, item.stderr.indexOf(':93:'));
  assert.ok(fromObjectPath.endsWith('/agate/table/from_object.py'));
  const utilsPath = fromObjectPath.slice(0, fromObjectPath.lastIndexOf('/table/')) + '/utils.py';
  const fs = new MemoryFileSystem();
  const bytes = new TextEncoder().encode(item.stdin);
  await fs.writeFile('/empty.json', bytes);
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, columnWarnings: { utilsPath } }));
  try {
    const command = ['in2csv', ...item.argv.map(quote)].join(' ');
    for (const named of [false, true]) {
      const result = await shell.exec(command + (named ? ' /empty.json' : ''), { stdin: item.stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: item.stdout, stderr: item.stderr, status: item.status
      });
    }
    assert.deepEqual(await fs.readFile('/empty.json'), bytes);
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['empty.json']);
  } finally { await shell.dispose(); }
});

for (const [separator, diagnostic] of [
  ['\n', 'Expecting value: line 2 column 1 (char 1)'],
  ['\r\n', 'Expecting value: line 2 column 1 (char 2)'],
  ['\r', 'Extra data: line 1 column 16 (char 15)']
]) test(`in2csv NDJSON borrowed-stdin physical lines ${JSON.stringify(separator)} fail before publishing a typed table`, async () => {
  const fs = new MemoryFileSystem();
  const input = '{"a":"first"}' + separator + separator + '{"a":"last"}';
  await fs.writeFile('/input.ndjson', new TextEncoder().encode(input));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec('in2csv -f ndjson', { stdin: input });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: '', stderr: `JSONDecodeError: ${diagnostic}\n`, status: 1
    });
    const named = await shell.exec('in2csv -f ndjson /input.ndjson');
    assert.deepEqual({ stdout: named.stdout, stderr: named.stderr, status: named.exitCode }, {
      stdout: '', stderr: 'JSONDecodeError: Expecting value: line 2 column 1 (char 1)\n', status: 1
    });
    assert.deepEqual(await fs.readFile('/input.ndjson'), new TextEncoder().encode(input));
  } finally { await shell.dispose(); }
});

test('in2csv JSON BOM rejection retains the CPython JSON decoder diagnostic', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const format of ['json', 'ndjson']) {
      const result = await shell.exec(`in2csv -f ${format} -e utf-8`, { stdin: '\uFEFF[{"a":"value"}]' });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: '', stderr: 'JSONDecodeError: Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)\n', status: 1
      });
    }
  } finally { await shell.dispose(); }
});
