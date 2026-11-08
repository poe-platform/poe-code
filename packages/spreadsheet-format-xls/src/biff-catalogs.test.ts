import { expect, it } from 'vitest';
import { defaultSsconvertLimits, type CapabilityContext } from '@poe-code/spreadsheet-engine';
import { createBiffCatalogs } from './biff-catalogs.js';

function fixture() {
  const controller = new AbortController(), failure = new Error('catalog storage failed');
  const cleanup: (() => void | Promise<void>)[] = [], borrowed = new Uint8Array(16384);
  const state = { acquired: 0, closed: 0, pending: 0, mode: '', acquireFailure: 0, hold: undefined as (() => Promise<void>) | undefined };
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: controller.signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own(fn) { cleanup.push(fn); },
    createWorkingStorage() {
      if (++state.acquired === state.acquireFailure) throw failure;
      const bytes = new Uint8Array(1024 * 1024); let end = 8;
      return {
        allocate(length) { const at = end; end += length; expect(end).toBeLessThan(bytes.length); return at; },
        async write(at, value) {
          expect(value.length).toBeLessThanOrEqual(16384); expect(++state.pending).toBe(1);
          try { await state.hold?.(); if (state.mode === 'write') throw failure; bytes.set(value, at); }
          finally { state.pending--; }
        },
        async read(at, length) {
          expect(length).toBeLessThanOrEqual(16384);
          if (state.mode === 'read') throw failure;
          if (state.mode === 'abort') controller.abort(failure);
          borrowed.fill(0); borrowed.set(bytes.subarray(at, at + length)); return borrowed.subarray(0, length);
        },
        async close() { expect(state.pending).toBe(0); state.closed++; if (state.mode === 'close') throw failure; }
      };
    }
  };
  return { context, state, cleanup, failure };
}

it('isolates catalog namespaces and owns records across replacements and concurrent replay', async () => {
  const { context, state } = fixture(), catalogs = createBiffCatalogs(context);
  for (let id = 0; id < 300; id++) {
    await catalogs.fonts.append({ name: `Font ${id}😀`, attributes: { Unit: 10 + id / 20, Script: -1 }, color: id, codepage: 1252 });
    await catalogs.xfs.append({ bytes: [id % 256], revision: 8 });
    await catalogs.formats.set(id, `format ${id}`);
  }
  await catalogs.formats.set(0, 'replacement\ud800');
  expect(catalogs.fonts.count).toBe(300); expect(catalogs.xfs.count).toBe(300);
  expect(await catalogs.formats.get(0)).toBe('replacement\ud800');
  for (let id = 299; id >= 0; id--) {
    const [font, xf, format] = await Promise.all([catalogs.fonts.get(id), catalogs.xfs.get(id), catalogs.formats.get(id)]);
    expect(font!.name).toBe(`Font ${id}😀`); expect(xf).toEqual({ bytes: [id % 256], revision: 8 });
    expect(format).toBe(id ? `format ${id}` : 'replacement\ud800');
    font!.attributes.Unit = 99; expect((await catalogs.fonts.get(id))!.attributes.Unit).toBe(10 + id / 20);
  }
  expect(await catalogs.fonts.get(999)).toBeUndefined();
  await expect(catalogs.xfs.get(-1)).rejects.toThrow('index');
  await catalogs.close(); await catalogs.close(); expect(state.closed).toBe(3);
  await expect(catalogs.fonts.get(0)).rejects.toThrow('closed');
});

it.each(['read', 'write', 'abort', 'close'])('retires all catalog backing after %s failure', async mode => {
  const { context, state, failure } = fixture(), catalogs = createBiffCatalogs(context);
  if (mode === 'write') {
    state.mode = mode; await expect(catalogs.formats.set(0, 'x'.repeat(20000))).rejects.toBe(failure);
  } else {
    await catalogs.formats.set(0, 'value'); state.mode = mode;
    if (mode !== 'close') await expect(catalogs.formats.get(0)).rejects.toBe(failure);
  }
  if (mode === 'close') await expect(catalogs.close()).rejects.toBeInstanceOf(AggregateError);
  else await catalogs.close();
  expect(state.closed).toBe(3);
});

it('releases partially acquired backing through the registered owner', async () => {
  const { context, state, cleanup, failure } = fixture(); state.acquireFailure = 3;
  expect(() => createBiffCatalogs(context)).toThrow(failure);
  for (const close of cleanup) await close();
  expect(state.closed).toBe(2);
});

it('waits for a pending write before closing backing handles', async () => {
  const { context, state } = fixture();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  state.hold = async () => { started(); await gate; };
  const catalogs = createBiffCatalogs(context), writing = catalogs.formats.set(0, 'x'.repeat(20000));
  const rejected = expect(writing).rejects.toThrow('closed');
  await entered; const closing = catalogs.close(); expect(state.closed).toBe(0);
  release(); await rejected; await closing; expect(state.closed).toBe(3);
});

it('keeps the explicit no-storage convenience path owned and revocable', async () => {
  const { createWorkingStorage: ignoredStorage, ...context } = fixture().context;
  const catalogs = createBiffCatalogs(context), font = { name: 'Font', attributes: { Unit: 10 }, color: 0, codepage: 1252 };
  await catalogs.fonts.append(font); font.attributes.Unit = 20;
  expect((await catalogs.fonts.get(0))!.attributes.Unit).toBe(10);
  await catalogs.close(); await expect(catalogs.fonts.get(0)).rejects.toThrow('closed');
});
