import { expect, it, vi } from 'vitest';
import { createEngine } from './engine.js';
import type { Workbook } from '@poe-code/spreadsheet-ast';

it('accepts a completed formula workbook from a source importer without rereading or skipping load evaluation', async () => {
  const readSource = vi.fn(async (): Promise<Workbook> => { throw Error('duplicate import'); });
  const diagnostic = vi.fn(), writeSource = vi.fn(async function* () { throw Error('formula source path'); yield new Uint8Array(); });
  const engine = createEngine({ codecs: [{ id: 'input', description: '', extensions: [], readSource,
    async readWorkbookSource(_input, context) {
      await context.diagnostic?.({ severity: 'warning', code: 'fixture', message: 'once' });
      return { sheets: [{ id: 's', name: 'Data', cells: [{ row: 0, column: 0, value: { kind: 'blank' }, formula: '=1+1', formulaDirty: true }] }] };
    }
  }, { id: 'output', description: '', extensions: [], writeWorkbookSource: writeSource,
    async *writeStream(book) { expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: 'number', value: 2 }); yield Uint8Array.of(50); }
  }] });
  const result: number[] = [];
  try { await engine.convert({ input: { kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, importType: 'input', exportType: 'output',
    destination: { kind: 'stream', sink: { async write(bytes) { result.push(...bytes); } } } }, { signal: new AbortController().signal, diagnostic }); }
  finally { await engine.dispose(); }
  expect(result).toEqual([50]); expect(readSource).not.toHaveBeenCalled(); expect(writeSource).not.toHaveBeenCalled(); expect(diagnostic).toHaveBeenCalledOnce();
});

it('checks cancellation before retaining a completed importer workbook', async () => {
  const controller = new AbortController(), reason = Error('cancel import'), sheets = vi.fn((): never => { throw Error('retained after cancellation'); });
  const engine = createEngine({ codecs: [{ id: 'input', description: '', extensions: [], async readSource() { throw Error('reread'); },
    async readWorkbookSource() { controller.abort(reason); return { get sheets() { return sheets(); } }; }
  }, { id: 'output', description: '', extensions: [], async *writeStream() { yield new Uint8Array(); }, async *writeWorkbookSource() { yield new Uint8Array(); } }] });
  try { await expect(engine.convert({ input: { kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, importType: 'input', exportType: 'output',
    destination: { kind: 'stream', sink: { async write() {} } } }, { signal: controller.signal })).rejects.toBe(reason); }
  finally { await engine.dispose(); }
  expect(sheets).not.toHaveBeenCalled();
});
