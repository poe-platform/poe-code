import { test } from "vitest";
import assert from "node:assert/strict";
import { Volume } from "memfs";
import { execute, run, defaultLimits } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import { pythonCodecs } from "./codecs/python.js";
import type { CsvkitContext } from "./contracts.js";
import { in2csv } from "./commands/in2csv.js";
import reference from "../../../docs/csvkit/in2csv-reference.json" with { type: "json" };

async function invoke(item: typeof reference.cases[number], sdk = false, overrides: Partial<CsvkitContext> = {}) {
  const volume = new Volume(); volume.mkdirSync('/work');
  for (const [name, text] of Object.entries(item.files)) volume.writeFileSync(`/work/${name}`, text);
  for (const [name, key] of Object.entries(item.binaries)) volume.writeFileSync(`/work/${name}`, Buffer.from(reference.binary[key as keyof typeof reference.binary], 'base64'));
  let stdout = ''; let stderr = ''; const cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(item.argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: '/work',
    fs: { readFile: async path => Uint8Array.from(volume.readFileSync(path) as Buffer), writeFile: async (path, bytes) => { volume.writeFileSync(path, bytes); } },
    stdin: (async function* () { yield 'stdinBase64' in item && item.stdinBase64 ? Buffer.from(item.stdinBase64, 'base64') : new TextEncoder().encode(item.stdin); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }, env: {},
    codecs: [utf8Codec, ...pythonCodecs], compression: [], databases: [], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  try {
    const status = sdk ? await run({ command: 'in2csv', settings: { filetype: 'csv', sniff_limit: 0 } }, context) : await execute('in2csv', context);
    const effects = Object.fromEntries(volume.readdirSync('/work').filter(name => !(String(name) in item.files) && !(String(name) in item.binaries)).map(name => [String(name), (volume.readFileSync(`/work/${String(name)}`) as Buffer).toString('base64')]));
    return { stdout, stderr, status, effects };
  } finally { for (const cleanup of cleanups) await cleanup(); }
}
for (const [index, item] of reference.cases.entries()) test(`in2csv frozen original differential ${index}: ${item.argv.join(' ')}`, async () => {
  assert.deepEqual(await invoke(item), { stdout: item.stdout, stderr: item.stderr, status: item.status, effects: item.effects });
});

test('GeoJSON rejects an oversized header even when there are no data rows', async () => {
  const result = await invoke({ argv: ['-f', 'geojson'], files: {}, binaries: {}, stdin: '{"type":"FeatureCollection","features":[]}', stdout: '', stderr: '', status: 78, effects: {} }, false, {
    limits: { ...defaultLimits, maxColumns: 4 }
  });
  assert.equal(result.stdout, '');
  assert.equal(result.status, 78);
  assert.equal(result.stderr, 'csvkit: unsupported or unqualified: column budget exceeded\n');
});

test('workbook main stdout drains before files and a later write failure preserves the first file', async () => {
  const item = reference.cases[22]!;
  const events: string[] = []; let first = '';
  const output = await invoke(item, false, {
    stdout: { write: async bytes => { await Promise.resolve(); events.push(new TextDecoder().decode(bytes)); } },
    fs: { readFile: async () => Buffer.from(reference.binary['book.xlsx'], 'base64'), writeFile: async (path, bytes) => {
      events.push(path);
      if (path.endsWith('_1.csv')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      first = new TextDecoder().decode(bytes);
    } }
  });
  assert.deepEqual(events, ['n,text\n', '3,second\n', '/work/book_0.csv', '/work/book_1.csv']);
  assert.equal(first, 'n,text\n2.5,é\n');
  assert.equal(output.status, 1);
  assert.equal(output.stderr, "PermissionError: [Errno 13] Permission denied: 'book_1.csv'\n");
});

test('streamed workbook caches owned bytes before producer reuse and registers cleanup before reading', async () => {
  const item = reference.cases[36]!;
  const original = Buffer.from(reference.binary['book.xlsx'], 'base64'); const shared = Uint8Array.from(original);
  let closed = 0; const cleanups: (() => Promise<void>)[] = [];
  const result = await invoke(item, false, {
    registerCleanup: cleanup => { cleanups.push(cleanup); },
    stdin: { async *[Symbol.asyncIterator]() {
      assert.ok(cleanups.length);
      try { yield shared; shared.fill(0); } finally { closed++; }
    } }
  });
  assert.deepEqual(result, { stdout: item.stdout, stderr: item.stderr, status: item.status, effects: item.effects });
  await Promise.all(cleanups.map(cleanup => cleanup())); assert.equal(closed, 1);
});

test('cancellation after main workbook output prevents side effects and closes the admitted source', async () => {
  const abort = new AbortController(); const reason = new Error('cancel workbook'); let closed = 0;
  const cleanups: (() => Promise<void>)[] = [];
  await assert.rejects(invoke(reference.cases[36]!, false, {
    signal: abort.signal, registerCleanup: cleanup => { cleanups.push(cleanup); },
    stdin: { async *[Symbol.asyncIterator]() { try { yield Buffer.from(reference.binary['book.xlsx'], 'base64'); } finally { closed++; } } },
    stdout: { write: async () => { abort.abort(reason); } },
    fs: { readFile: async () => { assert.fail('streamed workbook cannot reopen named input'); }, writeFile: async () => { assert.fail('cancelled side effect'); } }
  }), error => error === reason);
  await Promise.all(cleanups.map(cleanup => cleanup())); assert.equal(closed, 1);
});

test('side-file streaming preserves truncation and partial bytes and awaits cooperative close', async () => {
  const cleanups: (() => Promise<void>)[] = []; let file = 'old contents'; let closed = 0; let writes = 0;
  const result = await invoke(reference.cases[22]!, false, {
    registerCleanup: cleanup => { cleanups.push(cleanup); },
    fs: {
      readFile: async () => Buffer.from(reference.binary['book.xlsx'], 'base64'),
      writeFile: async () => { assert.fail('streaming side destination cannot use bulk writeFile'); },
      async openWriteFile() {
        assert.ok(cleanups.length >= 2, 'destination cleanup enrolls before truncating open'); file = '';
        return { write: async bytes => {
          if (++writes === 2) throw Object.assign(new Error('full'), { code: 'EACCES' });
          file += new TextDecoder().decode(bytes);
        }, close: async () => { await Promise.resolve(); closed++; } };
      }
    }
  });
  assert.equal(file, 'n,text\n'); assert.equal(result.status, 1);
  assert.equal(result.stderr, "PermissionError: [Errno 13] Permission denied: 'book_0.csv'\n");
  assert.equal(closed, 1); await Promise.all(cleanups.map(cleanup => cleanup())); assert.equal(closed, 1);
});

test('workbook ZIP payload expansion is validated rather than trusting declared sizes', async () => {
  const bytes = Uint8Array.from(Buffer.from(reference.binary['book.xlsx'], 'base64'));
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22; const central = view.getUint32(end + 16, true);
  const local = view.getUint32(central + 42, true);
  // Consistent lying sizes in the local and central records pass metadata
  // validation but must fail bounded payload validation before the workbook reader.
  view.setUint32(local + 22, 1, true); view.setUint32(central + 24, 1, true);
  const result = await invoke(reference.cases[15]!, false, {
    fs: { readFile: async () => bytes, writeFile: async () => { assert.fail('invalid workbook cannot write files'); } }
  });
  assert.equal(result.stdout, ''); assert.equal(result.status, 78);
  assert.ok(result.stderr.startsWith('csvkit: unsupported or unqualified: XLSX ZIP validation:'), result.stderr);
});
test('in2csv SDK reaches identical typed conversion', async () => {
  const item = reference.cases[0]!;
  assert.deepEqual(await invoke(item, true), { stdout: item.stdout, stderr: item.stderr, status: item.status, effects: item.effects });
});
test('in2csv exact inherited and redeclared flags', () => {
  const flags = in2csv.actions.flatMap(action => action.optionStrings).sort();
  assert.deepEqual(flags, '-h --help -d --delimiter -t --tabs -q --quotechar -u --quoting -b --no-doublequote -p --escapechar -z --maxfieldsize -e --encoding -L --locale -S --skipinitialspace --blanks --null-value --date-format --datetime-format --no-leading-zeroes -H --no-header-row -K --skip-lines -v --verbose -l --linenumbers --add-bom --zero -V --version -f --format -s --schema -k --key -n --names --sheet --write-sheets --use-sheet-names --reset-dimensions --encoding-xls -y --snifflimit -I --no-inference'.split(' ').sort());
  assert.equal(new Set(flags).size, flags.length);
  for (const [flag, dest] of [['-f','filetype'],['-n','names_only'],['-k','key'],['-s','schema']]) assert.equal(in2csv.actions.find(action => action.optionStrings.some(value => value === flag))?.dest, dest);
});
