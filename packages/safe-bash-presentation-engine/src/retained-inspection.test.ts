import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { buildSelectionIndex } from './selectors.js';
import { stageRetainedInspection } from './retained-inspection.js';
import { fixture, read, xml, tree } from '../tests/fixtures/validation.js';
const fingerprint = 'a'.repeat(64);
for (const json of [true, false]) it(`stages complete inspection with buffered byte parity, JSON ${json}`, async () => {
  const reader = read(fixture({ 'slide.xml': xml('sld', tree('2', '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Quote &quot; 😀"/></p:nvSpPr><p:txBody><a:p><a:r><a:rPr lang="en-US"/><a:t>Text</a:t></a:r></a:p></p:txBody></p:sp>')) })), fs = createMemoryFileSystem();
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
  const index = buildSelectionIndex(reader, fingerprint), records = index.slides;
  const expected = json ? JSON.stringify({ version: 1, operation: 'inspect', ok: true, data: { fingerprint, records, inventory: index.inventory }, warnings: [], errors: [], affected: 0, locations: records.map(record => record.location) }) + '\n' : records.map(record => `${record.kind} ${record.position} ${JSON.stringify(record.name)} id=${JSON.stringify(record.id)} owner=${JSON.stringify(record.part)}\n`).join('');
  const staged = await stageRetainedInspection(archive, fingerprint, {}, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, { json, maxOutputBytes: 1000000 });
  let actual = ''; const decoder = new TextDecoder();
  await staged.write({ async write(bytes) { actual += decoder.decode(bytes, { stream: true }); } }); actual += decoder.decode();
  expect(actual).toBe(expected); await staged.close(); expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['valid', 'duplicate-override', 'must-understand', 'diagram'] as const) it(`admits complete style contexts and diagram metadata: ${mode}`, async () => {
  const { rels } = await import('../tests/fixtures/validation.js');
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const reader = read(fixture({
    'slide.xml': xml('sld', tree('2', '<p:sp><p:nvSpPr><p:cNvPr id="3"/></p:nvSpPr><p:txBody><a:p><a:r><a:rPr><a:latin typeface="+mj-lt"/></a:rPr></a:r></a:p></p:txBody></p:sp>')),
    '_rels/slide.xml.rels': rels([['layout', 'slideLayout', 'layout.xml'], ['override', 'themeOverride', 'override.xml'], ...(mode === 'duplicate-override' ? [['other', 'themeOverride', 'override.xml']] : [])]),
    'override.xml': `<a:themeOverride xmlns:a="${a}"${mode === 'must-understand' ? ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:unsupported" mc:MustUnderstand="x"' : ''}><a:fontScheme><a:majorFont><a:latin typeface="Override Font"/></a:majorFont></a:fontScheme></a:themeOverride>`,
    ...(mode === 'diagram' ? { 'data.xml': '<data/>', '_rels/opaque.xml.rels': rels([['diagram', 'diagramData', 'data.xml']]), '_rels/data.xml.rels': rels([['missing', 'image', 'missing.bin']]) } : {})
  })), fs = createMemoryFileSystem();
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
  let expected, failure; try { expected = buildSelectionIndex(reader, fingerprint); } catch (error) { failure = error; }
  const admission = stageRetainedInspection(archive, fingerprint, {}, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, { json: true, maxOutputBytes: 1000000 });
  if (failure) await expect(admission).rejects.toMatchObject({ code: (failure as { code: string }).code });
  else {
    const staged = await admission, chunks: Uint8Array[] = []; await staged.write({ async write(bytes) { chunks.push(new Uint8Array(bytes)); } });
    expect(JSON.parse(Buffer.concat(chunks).toString()).data.inventory).toEqual(expected!.inventory); await staged.close();
  }
  expect(await fs.readdir('/')).toEqual([]);
});
