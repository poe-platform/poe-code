import { expect, test, vi } from 'vitest';
import { run, defaultLimits, type InvocationContext } from './engine.js';
import { utf8Codec } from './codecs/utf8.js';
import reference from '../../../docs/csvkit/in2csv-reference.json' with { type: 'json' };

vi.mock('@e965/xlsx', async importOriginal => ({
  ...await importOriginal<typeof import('@e965/xlsx')>(),
  read() { throw new Error('SheetJS workbook reader is unavailable'); },
  CFB: { read() { throw new Error('SheetJS container helper is unavailable'); } }
}));

test('XLS reading uses owned BIFF and container readers and ignores BIFF8 overrides', async () => {
  const bytes = Uint8Array.from(Buffer.from(reference.binary['dummy.xls'], 'base64'));
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
  const status = await run({ command: 'in2csv', settings: { filetype: 'xls', input_path: 'dummy.xls', encoding_xls: 'INVALID' } }, context);
  expect({ stdout, stderr, status }).toEqual({ stdout: 'a,b,c\n1.0,2.0,3.0\n', stderr: '', status: 0 });
});
