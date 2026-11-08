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

it.each([false, true])('preserves streamed axes for exporters (axis-aware: %s)', async sourceAxes => {
  let axisReads = 0;
  const axis = { index: 4, sizePoints: 17, hidden: true };
  const engine = createEngine({ codecs: [{ id: 'input', description: '', extensions: [], async readSource() { throw Error('reread'); },
    async readWorkbookSource() { return { metadata: { sheets: [{ id: 's', name: 'Data', cells: [], rows: [], columns: [] }] },
      async *cells() { yield { row: 0, column: 0, value: { kind: 'number' as const, value: 7 } }; },
      async *axes(_id: string, kind: 'rows' | 'columns') { axisReads++; if (kind === 'rows') yield axis; } }; }
  }, { id: 'output', description: '', extensions: [], ...(sourceAxes ? { sourceAxes: true as const } : {}),
    async *writeStream() { throw Error('source required'); yield new Uint8Array(); },
    async *writeWorkbookSource(source) {
      expect(Object.isFrozen(source.metadata)).toBe(true);
      expect(Object.isFrozen(source.metadata.sheets[0]!.rows)).toBe(true);
      expect(source.metadata.sheets[0]!.rows).toEqual(sourceAxes ? [] : [axis]);
      if (sourceAxes) {
        const rows = []; for await (const row of source.axes!('s', 'rows')) rows.push(row);
        expect(rows).toEqual([axis]);
      } else expect(source.axes).toBeUndefined();
      yield Uint8Array.of(7);
    }
  }] });
  try { await engine.convert({ input: { kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, importType: 'input', exportType: 'output',
    destination: { kind: 'stream', sink: { async write(bytes) { expect(bytes).toEqual(Uint8Array.of(7)); } } } }, { signal: new AbortController().signal }); }
  finally { await engine.dispose(); }
  expect(axisReads).toBe(sourceAxes ? 3 : 4);
});

it('materializes source axes for a buffering output binding', async () => {
  const axis = { index: 2, sizePoints: 17 };
  const engine = createEngine({ filesystem: { async read() { return []; }, async write(_uri, bytes) { expect(bytes).toEqual(Uint8Array.of(7)); } },
    codecs: [{ id: 'input', description: '', extensions: [], async readSource() { throw Error('reread'); },
      async readWorkbookSource() { return { metadata: { sheets: [{ id: 's', name: 'Data', cells: [], rows: [], columns: [] }] },
        async *cells() { yield { row: 0, column: 0, value: { kind: 'number' as const, value: 7 } }; },
        async *axes(_id: string, kind: 'rows' | 'columns') { if (kind === 'rows') yield axis; } }; }
    }, { id: 'output', description: '', extensions: [], sourceAxes: true,
      async *writeWorkbookSource() { throw Error('requires streaming output'); yield new Uint8Array(); },
      async write(book) { expect(book.sheets[0]!.rows).toEqual([axis]); expect(book.sheets[0]!.cells).toHaveLength(1); return Uint8Array.of(7); }
    }] });
  try { await engine.convert({ input: { kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, importType: 'input', exportType: 'output',
    destination: { kind: 'resource', uri: '/output' } }, { signal: new AbortController().signal }); }
  finally { await engine.dispose(); }
});
