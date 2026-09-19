import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Volume } from 'memfs';
import { execute, run, defaultLimits } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import type { CsvkitContext } from './contracts.js';
import reference from '../../../docs/csvkit/in2csv-workbook-package-reference.json' with { type: 'json' };

for (const item of reference.cases) for (const sdk of [false, true]) test(`OOXML relationship-selected workbook: ${item.argv.join(' ')} (${sdk ? 'SDK' : 'argv'})`, async () => {
  const volume = new Volume(); volume.mkdirSync('/work');
  const filename = `${item.name}.xlsx`;
  volume.writeFileSync(`/work/${filename}`, Buffer.from(reference.binary[item.name as keyof typeof reference.binary], 'base64'));
  let stdout = ''; let stderr = '';
  const context: CsvkitContext = {
    argv: new OwnedArguments(item.argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: '/work',
    fs: {
      readFile: async path => Uint8Array.from(volume.readFileSync(path) as Buffer),
      writeFile: async (path, bytes) => { volume.writeFileSync(path, bytes); }
    },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    codecs: [utf8Codec], compression: [], databases: [], env: {},
    locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' }, clock: { now: () => 0 },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    limits: defaultLimits, signal: new AbortController().signal, registerCleanup() {}
  };
  const status = sdk ? await run({ command: 'in2csv', settings: {
    filetype: 'xlsx', input_path: filename, names_only: item.argv.includes('-n'),
    write_sheets: item.argv.includes('--write-sheets') ? '-' : null
  } }, context) : await execute('in2csv', context);
  const effects = Object.fromEntries(volume.readdirSync('/work').filter(name => String(name).endsWith('.csv')).map(name => [
    String(name), (volume.readFileSync(`/work/${String(name)}`) as Buffer).toString('base64')
  ]));
  assert.deepEqual({ stdout, stderr, status, effects }, {
    stdout: item.stdout, stderr: item.stderr, status: item.status, effects: item.effects
  });
});
