import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { buildSelectionIndex } from './selectors.js';
import { openRetainedSelectionRecords } from './retained-selection.js';
import { fixture, read, xml, tree } from '../tests/fixtures/validation.js';
const fingerprint = 'a'.repeat(64);
async function text(source: AsyncIterable<Uint8Array>) { const decoder = new TextDecoder(); let result = ''; for await (const chunk of source) result += decoder.decode(chunk, { stream: true }); return result + decoder.decode(); }
for (const changes of [
  {},
  { 'slide.xml': xml('sld', tree('2', '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="Group"/></p:nvGrpSpPr><p:sp><p:nvSpPr><p:cNvPr id="4" name="Nested"/></p:nvSpPr></p:sp></p:grpSp>')) },
  { 'slide.xml': xml('sld', tree('0002', '<p:extLst><p:ext uri="urn:test"><x:opaque xmlns:x="urn:test"><p:sp/></x:opaque></p:ext></p:extLst>')) }
]) it('retains ordered slide, part and drawing selections with exact tokens and scopes', async () => {
  const reader = read(fixture(changes)), fs = createMemoryFileSystem();
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
  const expected = buildSelectionIndex(reader, fingerprint);
  const result = await openRetainedSelectionRecords(archive, fingerprint, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  for (const [kind, records] of [['slide', expected.slides], ['part', expected.parts], ['object', expected.objects]] as const) {
    const actual = []; for await (const record of result.records(kind)) actual.push({ ...record, name: await text(record.name()) });
    expect(actual).toEqual(records);
  }
  await result.close(); expect(await fs.readdir('/')).toEqual([]);
  await expect(result.records('object').next()).rejects.toMatchObject({ code: 'invalid-handle' });
});
it('rejects duplicate normalized shape IDs and retires caller storage', async () => {
  const reader = read(fixture({ 'slide.xml': xml('sld', tree('2', '<p:sp><p:nvSpPr><p:cNvPr id="+0002"/></p:nvSpPr></p:sp>')) }));
  const fs = createMemoryFileSystem(), archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
  expect(() => buildSelectionIndex(reader, fingerprint)).toThrowError(expect.objectContaining({ code: 'invalid-opc' }));
  await expect(openRetainedSelectionRecords(archive, fingerprint, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } })).rejects.toMatchObject({ code: 'invalid-opc' });
  expect(await fs.readdir('/')).toEqual([]);
});

it('matches query admission, selection ordering, tokens and bounded ambiguity candidates before yielding', async () => {
  const reader = read(fixture({ 'slide.xml': xml('sld', tree('2', '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Lantern"/></p:nvSpPr></p:sp>')) })), fs = createMemoryFileSystem();
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
  const expected = buildSelectionIndex(reader, fingerprint), result = await openRetainedSelectionRecords(archive, fingerprint, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  const queries = [
    { kind: 'slide', all: true }, { kind: 'object', owner: '/slide.xml', all: true },
    { kind: 'object', owner: '/SLIDE.XML', id: '2' }, { kind: 'object', owner: '/slide.xml', id: '002' },
    { kind: 'object', owner: '/slide.xml', name: 'Lantern' }, { kind: 'object', owner: '/slide.xml', name: 'Lantern', all: true },
    { kind: 'object', owner: '/slide.xml', position: { coordinateSystem: 'zero-based', value: 1 } },
    { kind: 'part', scope: 'masters', part: '/MASTER.XML' }, { kind: 'part', scope: 'notes', all: true },
    { token: expected.slides[0]!.token }, { token: expected.objects[0]!.token, kind: 'object' },
    { token: expected.objects[0]!.token.replace(fingerprint, 'b'.repeat(64)) },
    {}, { kind: 'object' }, { kind: 'slide', scope: 'masters' }, { kind: 'slide', position: 0 },
    { kind: 'slide', position: { coordinateSystem: 'one-based', value: 0 } }, { kind: 'part', part: '../unsafe' },
    { kind: 'slide', name: 'missing' }, { kind: 'part', id: '@part', name: 'invalid' }, { kind: 'part', all: 'true' },
    { kind: 'slide', token: expected.slides[0]!.token, all: true }
  ];
  for (const input of queries) {
    const query = input as import('./selectors.js').SelectionQuery;
    let selected, failure;
    try { selected = expected.select(query); } catch (error) { failure = error; }
    const actual = []; let rejected = false;
    try { for await (const record of result.select(query)) actual.push({ ...record, name: await text(record.name()) }); }
    catch (error) { rejected = true; expect(actual).toEqual([]); expect(error).toMatchObject({ code: (failure as { code: string }).code, candidates: (failure as { candidates: unknown }).candidates }); }
    expect(rejected).toBe(!!failure);
    if (selected) expect(actual).toEqual(selected);
  }
  await result.close(); expect(await fs.readdir('/')).toEqual([]);
});

it('spills generated names and nested traversal frames through caller storage with bounded outstanding IO', async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs); let written = 0, pending = 0, peak = 0, handles = 0;
  fs.readFile = async () => { throw new Error('payload-wide reads forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); handles++; return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
      const length = parameters[0].length; written += length; pending += length; peak = Math.max(peak, pending);
      try { await Promise.resolve(); return await handle.write(...parameters); } finally { pending -= length; }
    };
    if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { handles--; return handle.close(...parameters); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const reader = read(fixture());
  async function* slide() {
    const encode = (value: string) => new TextEncoder().encode(value), chunk = new Uint8Array(4096);
    yield encode('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="');
    for (let n = 0; n < 8; n++) { chunk.fill(115); yield chunk; chunk.fill(255); }
    yield encode('"><p:spTree>');
    for (let n = 0; n < 64; n++) yield encode(`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${n + 1}" name="group"/></p:nvGrpSpPr>`);
    for (let n = 0; n < 8; n++) {
      yield encode(`<p:sp><p:nvSpPr><p:cNvPr id="${n + 65}" name="`);
      for (let i = 0; i < 4; i++) { chunk.fill(97 + n); yield chunk; chunk.fill(255); }
      yield encode('"/></p:nvSpPr></p:sp>');
    }
    for (let n = 0; n < 64; n++) yield encode('</p:grpSp>');
    yield encode('</p:spTree></p:cSld></p:sld>');
  }
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); },
    async byteLength(part: string) { if (part !== '/slide.xml') return reader.get(part).length; let size = 0; for await (const bytes of slide()) size += bytes.length; return size; },
    async *read(part: string) { if (part === '/slide.xml') yield* slide(); else yield reader.get(part); }
  };
  const result = await openRetainedSelectionRecords(archive, fingerprint, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  let count = 0;
  for await (const record of result.select({ kind: 'object', owner: '/slide.xml', all: true })) {
    count++;
    if (count <= 64) expect(await text(record.name())).toBe('group');
    else {
      let bytes = 0; for await (const chunk of record.name()) { await Promise.resolve(); expect(chunk.every(value => value === 97 + count - 65)).toBe(true); bytes += chunk.length; }
      expect(bytes).toBe(16384);
    }
  }
  expect(count).toBe(72); expect(written).toBeGreaterThan(163840); expect(peak).toBeLessThanOrEqual(16384); expect(handles).toBeGreaterThan(0);
  const iterator = result.select({ kind: 'slide' }), first = await iterator.next(); expect(first.done).toBe(false);
  const name = first.value!.name; await iterator.return(undefined);
  await result.close(); expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
  await expect(text(name())).rejects.toMatchObject({ code: 'invalid-handle' });
});

it.each(['cancel', 'read'] as const)('cleans all record and document storage after %s during admission', async (mode) => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), reader = read(fixture());
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; },
    async *read(part: string) { yield reader.get(part); if (part === '/slide.xml') { if (mode === 'cancel') controller.abort(); else throw new Error('injected failure'); } }
  };
  await expect(openRetainedSelectionRecords(archive, fingerprint, { signal: controller.signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } })).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : 'io-failure' });
  expect(await fs.readdir('/')).toEqual([]);
});

it('caps ambiguity candidates and snapshots a query before asynchronous reads', async () => {
  const markup = Array.from({ length: 25 }, (_, n) => `<p:sp><p:nvSpPr><p:cNvPr id="${n + 3}" name="Lantern"/></p:nvSpPr></p:sp>`).join('');
  const reader = read(fixture({ 'slide.xml': xml('sld', tree('2', markup)) })), fs = createMemoryFileSystem();
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
  const expected = buildSelectionIndex(reader, fingerprint), result = await openRetainedSelectionRecords(archive, fingerprint, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  let failure; try { expected.select({ kind: 'object', owner: '/slide.xml', name: 'Lantern' }); } catch (error) { failure = error; }
  await expect(result.select({ kind: 'object', owner: '/slide.xml', name: 'Lantern' }).next()).rejects.toMatchObject({ code: 'ambiguous-selection', candidates: (failure as { candidates: unknown }).candidates });
  expect((failure as { candidates: unknown[] }).candidates).toHaveLength(20);
  const query = { kind: 'object' as const, owner: '/slide.xml', position: { coordinateSystem: 'zero-based' as const, value: 1 } };
  const selected = result.select(query); query.position.value = 9; query.owner = '/master.xml';
  expect((await selected.next()).value).toMatchObject({ id: '3', part: '/slide.xml', position: 2 }); await selected.return(undefined);
  await result.close(); expect(await fs.readdir('/')).toEqual([]);
});
