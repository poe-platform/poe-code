import { expect, test, vi } from 'vitest';
import { run, defaultLimits, type InvocationContext } from './engine.js';
import { utf8Codec } from './codecs/utf8.js';
import reference from '../../../docs/csvkit/in2csv-reference.json' with { type: 'json' };

vi.mock('@e965/xlsx', async importOriginal => ({
  ...await importOriginal<typeof import('@e965/xlsx')>(),
  read: vi.fn(() => { throw new Error('XLSX must use the owned reader'); })
}));

test('in2csv reads XLSX through the owned reader without invoking SheetJS', async () => {
  const bytes = Uint8Array.from(Buffer.from(reference.binary['book.xlsx'], 'base64'));
  let stdout = '', stderr = '';
  const context: InvocationContext = {
    cwd: '/work', fs: { readFile: async () => bytes, writeFile: async () => { throw new Error('unexpected write'); } },
    stdin: (async function* () {})(), stdinIsDefault: true,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [], locale: { profile: 'C', timezone: 'UTC', formatNumber: String },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal, registerCleanup() {}
  };
  const status = await run({ command: 'in2csv', settings: { filetype: 'xlsx', input_path: 'book.xlsx' } }, context);
  expect({ stdout, stderr, status }).toEqual({ stdout: 'n,text\n3,second\n', stderr: '', status: 0 });
});
