import { expect, it } from 'vitest';
import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { BiffStagedOutput } from './biff-staged-output.js';
import { BiffOutput } from './biff-write-binary.js';

function fixture() {
  const failure = new Error('backing failure'), controller = new AbortController(), cleanups: (() => void | Promise<void>)[] = [];
  const state = { closed: 0, pending: 0, mode: '', hold: undefined as (() => Promise<void>) | undefined };
  const bytes = new Uint8Array(200000), borrowed = new Uint8Array(16384); let end = 31;
  const context: CapabilityContext = { signal: controller.signal, own(fn) { cleanups.push(fn); }, environment: { env: {}, locale: 'C', timezone: 'UTC' },
    limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 5000, sheets: 10, operations: 100 }, createWorkingStorage() {
      if (state.mode === 'acquire') throw failure;
      return { allocate(length) { if (state.mode === 'allocate') throw failure; const at = end; end += length; return at; },
        async write(at, value) {
          expect(++state.pending).toBe(1); expect(value.length).toBeLessThanOrEqual(16384);
          try { await state.hold?.(); if (state.mode === 'write') throw failure; bytes.set(value, at); } finally { state.pending--; }
        },
        async read(at, length) {
          expect(length).toBeLessThanOrEqual(16384); if (state.mode === 'read') throw failure;
          if (state.mode === 'abort') controller.abort(failure);
          borrowed.set(bytes.subarray(at, at + length)); return borrowed.subarray(0, state.mode === 'short' ? length - 1 : length);
        },
        async close() { expect(state.pending).toBe(0); state.closed++; if (state.mode === 'close') throw failure; }
      };
    } };
  return { context, state, failure, cleanups, controller };
}
it('serializes record continuations, patches and concurrent owned ranges', async () => {
  const { context, state } = fixture(), output = new BiffStagedOutput(context, 100), expected = new BiffOutput(context, 100);
  const payload = new Uint8Array(12000).fill(7);
  const [first, second] = await Promise.all([output.record(1, new Uint8Array(100)), output.continuedRecord(2, payload)]);
  expect(first).toBe(expected.record(1, new Uint8Array(100)));
  expect(second).toBe(expected.continuedRecord(2, payload));
  const bytes = expected.finish(), patch = new Uint8Array([1, 2, 3, 4]); bytes.set(patch, 2);
  await output.patch(2, patch);
  const [a, b] = await Promise.all([output.read(0, output.size), output.read(100, 80)]);
  expect(a).toEqual(bytes); expect(b).toEqual(bytes.subarray(100, 180)); b.fill(0); expect(a).toEqual(bytes);
  await output.close(); await output.close(); expect(state.closed).toBe(1);
  await expect(output.read(0, 1)).rejects.toThrow('closed'); await expect(output.record(1)).rejects.toThrow('closed');
});
it.each(['write', 'read', 'short', 'abort'])('retires storage after %s failure', async mode => {
  const { context, state, failure } = fixture(), output = new BiffStagedOutput(context, 8224);
  await output.record(1, new Uint8Array(8000)); state.mode = mode;
  const reading = output.read(0, 20);
  if (mode === 'short') await expect(reading).rejects.toThrow('Truncated'); else await expect(reading).rejects.toBe(failure);
  await output.close(); expect(state.closed).toBe(1);
});
it.each(['acquire', 'allocate'])('owns partial %s acquisition', async mode => {
  const { context, state, failure, cleanups } = fixture(); state.mode = mode;
  expect(() => new BiffStagedOutput(context, 8224)).toThrow(failure);
  for (const close of cleanups) await close(); expect(state.closed).toBe(mode === 'acquire' ? 0 : 1);
});
it('waits for an in-flight write before cleanup and revokes queued work', async () => {
  const { context, state } = fixture(), output = new BiffStagedOutput(context, 8224);
  let resume!: () => void, entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  state.hold = () => { entered(); return new Promise<void>(resolve => { resume = resolve; }); };
  await output.record(1, new Uint8Array(8224));
  const pending = output.record(2, new Uint8Array(8224)); await writing;
  const closing = output.close(); expect(state.closed).toBe(0); resume();
  await expect(pending).rejects.toThrow('closed'); await closing; expect(state.closed).toBe(1);
});
it('preserves close failures and validates budgets before allocation', async () => {
  const { context, state, failure } = fixture(), output = new BiffStagedOutput({ ...context, limits: { ...context.limits, outputBytes: 8 } }, 5);
  await expect(output.record(1, new Uint8Array(6))).rejects.toThrow('too large');
  await output.record(1, new Uint8Array(4)); await expect(output.record(1)).rejects.toThrow('limit');
  state.mode = 'close'; await expect(output.close()).rejects.toBe(failure); expect(state.closed).toBe(1);
});
