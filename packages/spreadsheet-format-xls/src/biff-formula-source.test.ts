import { expect, it } from 'vitest';
import { createEngine, defaultSsconvertLimits } from '@poe-code/spreadsheet-engine';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { Binary } from './biff-binary.js';
import { createBiffWriter, readBiff } from './biff.js';

it.each([7, 8] as const)('replays BIFF%i formula auxiliary records without retained payload arrays', async revision => {
  const context = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const array = `{${Array.from({ length: 32 }, () => Array<number>(32).fill(1).join(',')).join(';')}}`;
  const bytes = await createBiffWriter(revision)({
    names: [{ name: 'ArrayName', expression: `=SUM(${array})` }],
    sheets: [{ id: 's', name: 'Data', cells: [
      { row: 0, column: 0, formula: `=SUM(${array})`, value: { kind: 'number', value: 1024 } },
      { row: 1, column: 0, formula: '=ArrayName', value: { kind: 'number', value: 1024 } }
    ] }]
  }, [], context);
  const expected = await readBiff(bytes, context);
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(257);
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{
    id: 'fixture', description: 'fixture', extensions: [], async readSource(input, context) { return readBiff(input, context); }
  }] });
  const push = Array.prototype.push;
  Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
    if (items.some(item => item instanceof Binary)) throw new Error('resident formula continuation array');
    if (items.some(item => item && typeof item === 'object' && 'tokens' in item && item.tokens instanceof Uint8Array && item.tokens.length > 8))
      throw new Error('resident pending formula tokens');
    return push.apply(this, items);
  };
  try {
    const actual = await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(at, count) {
      const length = Math.min(count, borrowed.length, bytes.length - at);
      borrowed.set(bytes.subarray(at, at + length)); return borrowed.subarray(0, length);
    } } }, { importType: 'fixture' }, { signal: context.signal });
    expect(actual).toEqual(expected);
  } finally { Array.prototype.push = push; await engine.dispose(); }
  expect(await fs.readdir('/')).toEqual([]);
});

it('decodes interleaved cached areas, arrays and label lists from reused asynchronous windows', async () => {
  const { biffFormulaExtrasSource } = await import('./biff-formula-extras.js');
  const bytes = Uint8Array.from([
    1, 0, 1, 0, 2, 0, 0, 0, 0, 0,
    0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 240, 63,
    2, 0, 0, 0, 9, 0, 2, 0, 0, 0, 0, 0
  ]);
  const context = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const borrowed = new Uint8Array(3), charges: number[] = []; let at = 0, pending = 0;
  const extras = biffFormulaExtrasSource(async () => {
    expect(++pending).toBe(1); await Promise.resolve(); borrowed.fill(0);
    const length = Math.min(borrowed.length, bytes.length - at);
    borrowed.set(bytes.subarray(at, at + length)); at += length; pending--;
    return length ? new Binary(borrowed.subarray(0, length)) : undefined;
  }, 8, 1252, context, amount => charges.push(amount));
  expect(at).toBe(0);
  await extras.readMemory(); expect(at).toBe(12);
  expect(await extras.readArray()).toBe('{1}');
  expect(await extras.readLabels()).toEqual({ relative: false, cells: [{ row: 9, column: 2 }, { row: 0, column: 0 }] });
  expect(at).toBe(bytes.length); expect(charges).toEqual([8, 1, 4, 4]);
});

it.each(['read', 'abort', 'truncated'] as const)('preserves %s failures during formula auxiliary replay', async mode => {
  const { biffFormulaExtrasSource } = await import('./biff-formula-extras.js');
  const controller = new AbortController(), failure = new Error('formula replay failed'); let reads = 0;
  const context = { limits: defaultSsconvertLimits, signal: controller.signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const extras = biffFormulaExtrasSource(async () => {
    if (++reads === 1) return new Binary(Uint8Array.of(0, 0, 0));
    if (mode === 'read') throw failure;
    if (mode === 'abort') controller.abort(failure);
    return undefined;
  }, 8, 1252, context);
  if (mode === 'truncated') await expect(extras.readArray()).rejects.toThrow('truncated');
  else await expect(extras.readArray()).rejects.toBe(failure);
  expect(reads).toBe(2);
});

it('checks cancellation after an asynchronous name translation before committing it', async () => {
  const { BiffNameBindings } = await import('./biff-name-bindings.js');
  const controller = new AbortController(), failure = new Error('name translation cancelled');
  const context = { limits: defaultSsconvertLimits, signal: controller.signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const bindings = new BiffNameBindings(context, []);
  await expect(bindings.defineAsync(1, 'Name', undefined, async () => {
    await Promise.resolve(); controller.abort(failure); return '=1';
  })).rejects.toBe(failure);
});

it('preserves synchronous name binding and replays asynchronous definitions with the same captured identity', async () => {
  const { BiffNameBindings } = await import('./biff-name-bindings.js');
  const { translateBiffFormula, translateBiffFormulaSource } = await import('./biff-formulas.js');
  const context = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const sync = new BiffNameBindings(context, []), asyncBindings = new BiffNameBindings(context, []);
  const formulaContext = { revision: 8, codepage: 1252, row: 0, column: 0, names: ['Alias', 'Target', 'Target'], externalSheets: [], limit: 10000 };
  const declarations = [
    { name: 'Alias', tokens: Uint8Array.of(0x23, 2, 0, 0, 0) },
    { name: 'Target', tokens: Uint8Array.of(0x1e, 7, 0) },
    { name: 'Target', tokens: Uint8Array.of(0x1e, 9, 0) }
  ];
  let syncCalls = 0, asyncCalls = 0;
  for (const [index, declaration] of declarations.entries()) {
    sync.define(index + 1, declaration.name, undefined, resolveName => {
      syncCalls++; return translateBiffFormula(declaration.tokens, { ...formulaContext, resolveName });
    });
    await asyncBindings.defineAsync(index + 1, declaration.name, undefined, async resolveName => {
      asyncCalls++; await Promise.resolve(); return translateBiffFormulaSource(declaration.tokens, { ...formulaContext, resolveName });
    });
  }
  const finalized = sync.finish(); expect(asyncBindings.finish()).toEqual(finalized);
  for (const index of finalized.indices) expect(await asyncBindings.expressionAsync(index)).toBe(sync.expression(index));
  expect(syncCalls).toBe(3 + finalized.indices.length); expect(asyncCalls).toBe(syncCalls);
});
