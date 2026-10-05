import { expect, it } from 'vitest';
import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { propertyRange } from './biff-property-range.js';
import { stageWideBiffProperty } from './biff-property-transcode.js';

function fixture(mode = '', text = '\ufeff' + 'a'.repeat(8190) + '😀漢'.repeat(10000)) {
  const controller = new AbortController(), failure = new Error(mode), encoded = new TextEncoder().encode(text);
  const input = new Uint8Array(encoded.length + 9), header = new DataView(input.buffer);
  header.setUint32(0, 30, true); header.setUint32(4, encoded.length + 1, true); input.set(encoded, 8);
  const state = { opened: 0, closed: 0, passes: 0, reads: 0 }, borrowed = new Uint8Array(257);
  const cleanups: (() => void | Promise<void>)[] = [], writes: Uint8Array[] = [];
  const context: CapabilityContext = { signal: controller.signal, own(fn) { cleanups.push(fn); },
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { inputBytes: 1e6, outputBytes: 1e6, cells: 1, sheets: 1, operations: 10 },
    createWorkingStorage() {
      state.opened++; const data = new Uint8Array(1e6);
      return { allocate() { return 0; }, async write(at, bytes) {
        expect(bytes.length).toBeLessThanOrEqual(16384); writes.push(bytes); await Promise.resolve();
        if (mode === 'write') throw failure;
        if (mode === 'abort') controller.abort(failure);
        data.set(bytes, at);
      }, async read(at, size) { return data.subarray(at, at + size); }, async close() { state.closed++; } };
    }
  };
  const source = propertyRange({ size: input.length, async read(at, count) {
    state.reads++; expect(count).toBeLessThanOrEqual(8192);
    if (at === 8) {
      state.passes++;
      if (mode === 'first-read' && state.passes === 1 || mode === 'second-read' && state.passes === 2) throw failure;
    }
    const part = input.subarray(at, at + Math.min(count, borrowed.length)); borrowed.set(part); return borrowed.subarray(0, part.length);
  } }, context);
  return { text, input, source, context, state, failure, cleanups, writes };
}
it('preserves BOM, surrogate pairs and multibyte boundaries across two borrowed-read passes', async () => {
  const f = fixture(), result = await stageWideBiffProperty(f.source, f.context, () => {}, length => length);
  const expected = new Uint8Array(8 + (f.text.length + 1) * 2), view = new DataView(expected.buffer);
  view.setUint32(0, 31, true); view.setUint32(4, f.text.length + 1, true);
  for (let i = 0; i < f.text.length; i++) view.setUint16(8 + i * 2, f.text.charCodeAt(i), true);
  expect(result.size).toBe(expected.length);
  for (let at = 0; at < result.size;) { const bytes = await result.read(at, result.size); expect(bytes).toEqual(expected.subarray(at, at + bytes.length)); at += bytes.length; }
  expect(f.state.passes).toBe(2); expect(f.state.reads).toBeGreaterThan(100);
  await result.close(); for (const close of f.cleanups) await close(); expect(f.state.closed).toBe(1);
  expect(f.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it.each(['first-read', 'second-read', 'write', 'abort'])('cleans temporary output on %s failure', async mode => {
  const f = fixture(mode);
  await expect(stageWideBiffProperty(f.source, f.context, () => {}, length => length)).rejects.toBe(f.failure);
  for (const close of f.cleanups) await close();
  expect(f.state.closed).toBe(f.state.opened); expect(f.state.opened).toBe(mode === 'first-read' ? 0 : 1);
  expect(f.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it('rejects truncated UTF-8 before allocating output storage', async () => {
  const f = fixture('', 'ok'); f.input[9] = 0xc2;
  await expect(stageWideBiffProperty(f.source, f.context, () => {}, length => length)).rejects.toThrow();
  expect(f.state.opened).toBe(0);
});
it('admits the expanded UTF-16 size before opening output storage', async () => {
  const f = fixture('', 'a'.repeat(9000));
  await expect(stageWideBiffProperty(f.source, f.context, () => {}, length => {
    if (length > 16000) throw f.failure; return length;
  })).rejects.toBe(f.failure);
  expect(f.state.opened).toBe(0);
});
