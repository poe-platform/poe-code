import { expect, test } from 'vitest';
import { createZipCodec, type ZipLimits } from '@poe-code/office-package';
import { defaultLimits, type InvocationContext } from './engine.js';
import { in2csv } from './commands/in2csv.js';
import { Runtime } from './runtime.js';
import { readCachedXlsx } from '@poe-code/xlsx-ast';
import { formatA1 } from '@poe-code/spreadsheet-ast';

const limits: ZipLimits = {
  maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 10, maxPathBytes: 1000, maxDepth: 100, maxPaxBytes: 1000,
  maxTextBytes: 1000000, chunkSize: 512
};
const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

async function read(sheet: string, overrides: Partial<InvocationContext> = {}, namesOnly = false, chunkSize = limits.chunkSize) {
  const context: InvocationContext = {
    cwd: '/work', fs: { readFile: async () => { throw new Error('unexpected read'); }, writeFile: async () => { throw new Error('unexpected write'); } },
    stdin: (async function* () {})(), stdinIsDefault: true,
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [], compression: [], databases: [],
    locale: { profile: 'C', timezone: 'UTC', formatNumber: String }, clock: { now: () => 0 },
    limits: defaultLimits, signal: new AbortController().signal, registerCleanup() {}, ...overrides
  };
  const codec = createZipCodec();
  const parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/book.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/book.xml': `<workbook xmlns="${namespace}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dates" r:id="data"/></sheets></workbook>`,
    'xl/_rels/book.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="data" Target="worksheets/dates.xml"/></Relationships>',
    'xl/worksheets/dates.xml': sheet
  };
  const entries = [];
  for (const [name, source] of Object.entries(parts)) entries.push(await codec.makeZipEntry(name, new TextEncoder().encode(source), {
    modified: new Date('2020-01-01T00:00:00Z'), mode: 0o100644, directory: false, symlink: false, compression: 'store'
  }, limits, new AbortController().signal));
  const runtime = new Runtime(context, in2csv, {});
  try {
    const book = await readCachedXlsx({ archive: { entries, comment: new Uint8Array() }, codec,
      limits: { ...limits, chunkSize, maxDepth: context.limits.maxNestingDepth }, signal: context.signal,
      maxXmlNodes: context.limits.maxWork, work: runtime.step, retain: bytes => runtime.retain(bytes), namesOnly });
    return new Map(book.sheets.flatMap(sheet => {
      const dates = new Map(sheet.cells.flatMap(cell => cell.type === 'd' && typeof cell.value === 'string'
        ? [[formatA1(cell.row, cell.column), cell.value] as const] : []));
      return dates.size ? [[sheet.name, dates] as const] : [];
    }));
  }
  finally { await runtime.close(); }
}

test('workbook XML preserves ISO text, namespace identity and implicit coordinates across chunks', async () => {
  const result = await read(`<s:worksheet xmlns:s="${namespace}" xmlns:foreign="urn:other"><!--${"x".repeat(350)}--><s:sheetData><s:row r="2"><s:c r="B2" t="d"><s:v>2026-09-<![CDATA[29T12:30]]>&#58;00Z</s:v></s:c><s:c t="d"><s:v>13:45:00</s:v></s:c><foreign:c t="d"><foreign:v>wrong</foreign:v></foreign:c></s:row></s:sheetData></s:worksheet>`);
  expect(result.get('Dates')).toEqual(new Map([['B2', '2026-09-29T12:30:00Z'], ['C2', '13:45:00']]));
});

test('workbook XML enforces the invocation nesting limit', async () => {
  await expect(read(`<worksheet xmlns="${namespace}">${'<nested>'.repeat(8)}${'</nested>'.repeat(8)}</worksheet>`, {
    limits: { ...defaultLimits, maxNestingDepth: 6 }
  })).rejects.toThrow('XML resource limit exceeded');
});

test('workbook XML refuses DTD declarations', async () => {
  await expect(read(`<!DOCTYPE worksheet><worksheet xmlns="${namespace}"/>`)).rejects.toThrow('DTD and entity declarations are forbidden');
});

test('workbook XML charges parsing work for long element text', async () => {
  await expect(read(`<worksheet xmlns="${namespace}"><ignored>${'x'.repeat(32768)}</ignored></worksheet>`, {
    limits: { ...defaultLimits, maxWork: 64 }
  }, false, 65536)).rejects.toThrow();
});

test('workbook XML charges retained nodes even for empty elements', async () => {
  await expect(read(`<worksheet xmlns="${namespace}">${'<x/>'.repeat(256)}</worksheet>`, {
    limits: { ...defaultLimits, maxRetainedBytes: 64000 }
  })).rejects.toThrow('retained byte budget exceeded');
});

test('names-only reads do not parse worksheet bodies', async () => {
  expect(await read('<malformed', {}, true)).toEqual(new Map());
});

test.each([false, null, new SyntaxError('caller cancellation')])('workbook XML preserves cancellation reason %s', async reason => {
  const controller = new AbortController(); controller.abort(reason);
  await expect(read(`<worksheet xmlns="${namespace}"/>`, { signal: controller.signal })).rejects.toBe(reason);
});
