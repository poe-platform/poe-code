import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { buildSelectionIndex } from './selectors.js';
import { openRetainedSelectionRecords } from './retained-selection.js';
import { openRetainedSlideInventory } from './retained-slide-inventory.js';
import { fixture, read, xml, tree, rels } from '../tests/fixtures/validation.js';
async function all<T>(source: AsyncIterable<T>) { const result = []; for await (const value of source) result.push(value); return result; }
function archive(changes: Record<string, string | null>) {
  const reader = read(fixture(changes));
  return { reader, async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
}
for (const value of [undefined, 'true', 'false', '1', '0', '  true  ', '', 'yes', 'TRUE', 'tr ue']) it(`matches slide visibility admission for ${JSON.stringify(value)}`, async () => {
  const input = archive({ 'slide.xml': xml('sld', tree()).replace('<p:sld ', value === undefined ? '<p:sld ' : `<p:sld show="${value}" `) });
  const fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, fingerprint = 'a'.repeat(64);
  let expected, error;
  try { expected = buildSelectionIndex(input.reader, fingerprint).inventory; } catch (caught) { error = caught; }
  const records = await openRetainedSelectionRecords(input, fingerprint, settings);
  if (error) await expect(openRetainedSlideInventory(input, records, settings)).rejects.toMatchObject({ code: (error as { code: string }).code });
  else {
    const inventory = await openRetainedSlideInventory(input, records, settings);
    expect(await all(inventory.slides())).toEqual(expected!.slides);
    expect(await all(inventory.handoutMasters())).toEqual(expected!.handoutMasters);
    expect(inventory.counts).toEqual({ slides: expected!.counts.slides, slideShapes: expected!.counts.slideShapes });
    await inventory.close(); await expect(inventory.slides().next()).rejects.toMatchObject({ code: 'invalid-handle' });
  }
  expect((await all(records.records('slide'))).length).toBe(1);
  await records.close(); expect(await fs.readdir('/')).toEqual([]);
});
for (const changes of [
  { '_rels/slide.xml.rels': rels([['one', 'slideLayout', 'layout.xml'], ['two', 'slideLayout', 'layout.xml']]) },
  { '_rels/master.xml.rels': rels([['one', 'theme', 'opaque.xml'], ['two', 'theme', 'opaque.xml']]) },
  { '_rels/slide.xml.rels': rels([['one', 'slideLayout', 'missing.xml']]) },
  { '_rels/slide.xml.rels': rels([['one', 'slideLayout', 'https://example.org/', 'External']]) }
]) it('preserves inheritance ambiguity and absent-target behavior', async () => {
  const input = archive(changes), fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, fingerprint = 'a'.repeat(64);
  let expected, error; try { expected = buildSelectionIndex(input.reader, fingerprint).inventory; } catch (caught) { error = caught; }
  const records = await openRetainedSelectionRecords(input, fingerprint, settings);
  if (error) await expect(openRetainedSlideInventory(input, records, settings)).rejects.toMatchObject({ code: (error as { code: string }).code });
  else { const inventory = await openRetainedSlideInventory(input, records, settings); expect(await all(inventory.slides())).toEqual(expected!.slides); await inventory.close(); }
  await records.close(); expect(await fs.readdir('/')).toEqual([]);
});

it('counts nested shapes for each slide and preserves handout list order and duplicates', async () => {
  const input = archive({
    'main.xml': xml('presentation', '<p:sldIdLst><p:sldId id="256" r:id="slide"/><p:sldId id="257" r:id="other"/></p:sldIdLst><p:handoutMasterIdLst><p:handoutMasterId r:id="second"/><p:handoutMasterId r:id="first"/><p:handoutMasterId r:id="second"/></p:handoutMasterIdLst>'),
    '_rels/main.xml.rels': rels([['slide', 'slide', 'slide.xml'], ['other', 'slide', 'other.xml'], ['first', 'handoutMaster', 'first.xml'], ['second', 'handoutMaster', 'second.xml']]),
    'slide.xml': xml('sld', tree('2', '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="Group"/></p:nvGrpSpPr><p:sp><p:nvSpPr><p:cNvPr id="4" name="Nested"/></p:nvSpPr></p:sp></p:grpSp>')),
    'other.xml': xml('sld', tree()), 'first.xml': xml('handoutMaster', tree()), 'second.xml': xml('handoutMaster', tree())
  }), fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, fingerprint = 'a'.repeat(64);
  const expected = buildSelectionIndex(input.reader, fingerprint).inventory, records = await openRetainedSelectionRecords(input, fingerprint, settings);
  const inventory = await openRetainedSlideInventory(input, records, settings);
  expect(await all(inventory.slides())).toEqual(expected.slides);
  expect(inventory.counts).toEqual({ slides: expected.counts.slides, slideShapes: expected.counts.slideShapes });
  expect(await all(inventory.handoutMasters())).toEqual(['/second.xml', '/first.xml', '/second.xml']);
  await records.close(); expect(await all(inventory.handoutMasters())).toEqual(expected.handoutMasters);
  await inventory.close(); expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['missing-id', 'missing-part', 'wrong-type', 'external'] as const) it(`rejects invalid handout references: ${mode}`, async () => {
  const input = archive({
    'main.xml': xml('presentation', `<p:handoutMasterIdLst><p:handoutMasterId${mode === 'missing-id' ? '' : ' r:id="handout"'}/></p:handoutMasterIdLst>`),
    '_rels/main.xml.rels': rels([['handout', mode === 'wrong-type' ? 'image' : 'handoutMaster', mode === 'missing-part' ? 'missing.xml' : mode === 'external' ? 'https://example.org/' : 'handout.xml', ...(mode === 'external' ? ['External'] : [])]]),
    'handout.xml': xml('handoutMaster', tree())
  }), fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, fingerprint = 'a'.repeat(64);
  expect(() => buildSelectionIndex(input.reader, fingerprint)).toThrowError(expect.objectContaining({ code: 'invalid-opc' }));
  const records = await openRetainedSelectionRecords(input, fingerprint, settings);
  await expect(openRetainedSlideInventory(input, records, settings)).rejects.toMatchObject({ code: 'invalid-opc' });
  await records.close(); expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['success', 'read', 'write', 'cancel'] as const) it(`spills ordered slides and long handout IDs with bounded IO: ${mode}`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), open = fs.open!.bind(fs);
  let active = false, written = 0, pending = 0, peak = 0, handles = 0;
  fs.readFile = async () => { throw new Error('payload-wide reads forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); handles++; return new Proxy(handle, { get(target, key) {
    if (key === 'read' && active && mode === 'read') return async () => { throw new Error('injected read failure'); };
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
      if (active && mode === 'write') throw new Error('injected write failure');
      if (active && mode === 'cancel') controller.abort();
      const length = parameters[0].length; if (active) written += length;
      pending += length; peak = Math.max(peak, pending);
      try { await Promise.resolve(); return await handle.write(...parameters); } finally { pending -= length; }
    };
    if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { handles--; return handle.close(...parameters); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const id = 'h'.repeat(32768), names = Array.from({ length: 32 }, (_, n) => `slide-${String(n).padStart(2, '0')}-${'x'.repeat(160)}.xml`);
  const changes: Record<string, string> = {
    'main.xml': xml('presentation', '<p:sldIdLst>' + names.map((_, n) => `<p:sldId id="${n + 256}" r:id="r${n}"/>`).join('') + `</p:sldIdLst><p:handoutMasterIdLst><p:handoutMasterId r:id="${id}"/></p:handoutMasterIdLst>`),
    '_rels/main.xml.rels': rels([...names.map((name, n) => [`r${n}`, 'slide', name]), [id, 'handoutMaster', 'handout.xml']]),
    'handout.xml': xml('handoutMaster', tree())
  };
  for (const name of names) changes[name] = xml('sld', tree());
  const input = archive(changes), sourceRead = input.read;
  input.read = async function* (part: string) {
    const chunk = new Uint8Array(1024);
    for await (const bytes of sourceRead(part)) for (let offset = 0; offset < bytes.length; offset += chunk.length) {
      const length = Math.min(chunk.length, bytes.length - offset); chunk.set(bytes.subarray(offset, offset + length)); yield chunk.subarray(0, length); chunk.fill(255);
    }
  };
  const settings = { signal: controller.signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, records = await openRetainedSelectionRecords(input, 'a'.repeat(64), settings);
  active = true;
  const admission = openRetainedSlideInventory(input, records, settings);
  if (mode !== 'success') await expect(admission).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : 'io-failure' });
  else {
    const inventory = await admission; let count = 0;
    for await (const slide of inventory.slides()) { await Promise.resolve(); expect(slide.part).toBe('/' + names[count++]); expect(slide.shapeCount).toBe(1); }
    expect(inventory.counts).toEqual({ slides: 32, slideShapes: 32 }); expect(count).toBe(32);
    expect(await all(inventory.handoutMasters())).toEqual(['/handout.xml']);
    expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384);
    await inventory.close();
  }
  active = false; await records.close(); expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
