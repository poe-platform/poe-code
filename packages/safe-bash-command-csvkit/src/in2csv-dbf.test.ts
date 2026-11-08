import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Volume } from 'memfs';
import { execute, run, defaultLimits } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import { pythonCodecs } from './codecs/python.js';
import type { CsvkitContext } from './contracts.js';
import reference from '../../../docs/csvkit/in2csv-dbf-reference.json' with { type: 'json' };
import userReference from '../../../docs/csvkit/in2csv-dbf-user-edge-reference.json' with { type: 'json' };

export async function invokeDbf(argv: string[], files: Record<string, Uint8Array>, overrides: Partial<CsvkitContext> = {}, sdk = false) {
  const volume = new Volume(); volume.mkdirSync('/work');
  for (const [name, bytes] of Object.entries(files)) volume.writeFileSync('/work/' + name, bytes);
  let stdout = ''; let stderr = ''; const cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: '/work',
    fs: { listDirectory: async path => volume.readdirSync(path).map(String), readFile: async path => Uint8Array.from(volume.readFileSync(path) as Buffer), writeFile: async () => { assert.fail('DBF cannot write files'); } },
    stdin: { [Symbol.asyncIterator]() { assert.fail('DBF cannot consume stdin'); } }, stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }, env: {},
    codecs: [utf8Codec, ...pythonCodecs], compression: [], databases: [], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  try {
    const status = sdk ? await run({ command: 'in2csv', settings: { filetype: 'dbf', input_path: 'data.dbf' } }, context) : await execute('in2csv', context);
    for (const [name, bytes] of Object.entries(files)) assert.deepEqual(volume.readFileSync('/work/' + name), Buffer.from(bytes));
    assert.deepEqual(volume.readdirSync('/work').sort(), Object.keys(files).sort());
    return { stdout, stderr, status };
  } finally { for (const cleanup of cleanups) await cleanup(); }
}

for (const item of [...reference.cases, ...userReference.cases]) test(`DBF frozen differential: ${item.name}`, async () => {
  const warningPath = item.stderr.split(':')[0];
  const result = await invokeDbf(item.argv, Object.fromEntries(Object.entries(item.files).map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')])),
    { env: reference.environment, ...(item.stderr.includes('Warning:') ? { columnWarnings: { utilsPath: warningPath! } } : {}) });
  assert.deepEqual(result, { stdout: item.stdout, stderr: item.stderr, status: item.status });
  assert.deepEqual(item.effects, { unchangedFiles: true, createdFiles: [] });
});

function logical(value: number, deleted = false): Uint8Array {
  const bytes = new Uint8Array(68); const view = new DataView(bytes.buffer);
  bytes[0] = 3; view.setUint32(4, 1, true); view.setUint16(8, 65, true); view.setUint16(10, 2, true);
  bytes[32] = 120; bytes[43] = 76; bytes[48] = 1; bytes[64] = 13;
  bytes[65] = deleted ? 42 : 32; bytes[66] = value; bytes[67] = 26; return bytes;
}

test('DBF validates illegal logical values, including deleted records loaded by dbfread', async () => {
  for (const deleted of [false, true]) assert.deepEqual(await invokeDbf(['data.dbf'], { 'data.dbf': logical(88, deleted) }),
    { stdout: '', stderr: "ValueError: Illegal value for logical field: b'X'\n", status: 1 });
});

test('DBF reads records to EOF instead of trusting header record count', async () => {
  const bytes = logical(84); new DataView(bytes.buffer).setUint32(4, 0, true);
  assert.deepEqual(await invokeDbf(['data.dbf'], { 'data.dbf': bytes }), { stdout: 'x\nTrue\n', stderr: '', status: 0 });
});

test('DBF SDK uses the same filename reader and native inference as argv dispatch', async () => {
  const files = { 'data.dbf': logical(84) };
  assert.deepEqual(await invokeDbf([], files, {}, true), await invokeDbf(['-f', 'dbf', 'data.dbf'], files));
});

test('DBF exact text filename opening precedes ignored encoding validation and binary conversion', async () => {
  assert.deepEqual(await invokeDbf(['-f', 'dbf', 'missing.dbf'], {}),
    { stdout: '', stderr: "FileNotFoundError: [Errno 2] No such file or directory: 'missing.dbf'\n", status: 1 });
  assert.deepEqual(await invokeDbf(['-e', 'bogus', 'data.dbf'], { 'data.dbf': logical(84) }),
    { stdout: '', stderr: 'LookupError: unknown encoding: bogus\n', status: 1 });
  assert.deepEqual(await invokeDbf(['-e', 'bogus', '-f', 'dbf', 'missing.dbf'], {}),
    { stdout: '', stderr: "FileNotFoundError: [Errno 2] No such file or directory: 'missing.dbf'\n", status: 1 });
});

test('DBF decoded text obeys the cumulative codepoint admission budget before output', async () => {
  assert.deepEqual(await invokeDbf(['data.dbf'], { 'data.dbf': logical(84) }, {
    limits: { ...defaultLimits, maxCodepoints: 0 }
  }), { stdout: '', stderr: 'csvkit: unsupported or unqualified: DBF codepoint budget exceeded\n', status: 78 });
});

test('DBF resolves DBT text memos by filename and applies default inference', async () => {
  const bytes = new Uint8Array(77); const view = new DataView(bytes.buffer);
  bytes[0] = 131; view.setUint32(4, 1, true); view.setUint16(8, 65, true); view.setUint16(10, 11, true);
  bytes[32] = 120; bytes[43] = 77; bytes[48] = 10; bytes[64] = 13;
  bytes[65] = 32; bytes.set(new TextEncoder().encode('         1'), 66); bytes[76] = 26;
  const memo = new Uint8Array(516); memo.set(new TextEncoder().encode('yes'), 512); memo[515] = 26;
  assert.deepEqual(await invokeDbf(['data.dbf'], { 'data.dbf': bytes, 'data.dbt': memo }), { stdout: 'x\nTrue\n', stderr: '', status: 0 });
});

test('DBF refuses memo offsets beyond the qualified exact integer range', async () => {
  const bytes = new Uint8Array(322); const view = new DataView(bytes.buffer);
  bytes[0] = 131; view.setUint32(4, 1, true); view.setUint16(8, 65, true); view.setUint16(10, 256, true);
  bytes[32] = 120; bytes[43] = 77; bytes[48] = 255; bytes[64] = 13; bytes[65] = 32;
  bytes.fill(57, 66, 321); bytes[321] = 26;
  assert.deepEqual(await invokeDbf(['data.dbf'], { 'data.dbf': bytes, 'data.dbt': new Uint8Array(512) }),
    { stdout: '', stderr: 'csvkit: unsupported or unqualified: DBF memo offset outside qualified integer range\n', status: 78 });
});
