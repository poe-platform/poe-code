import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedText } from './retained-text.js';
import { streamJson } from './retained-output.js';
import { readFields } from './fields.js';
import { readSelectionIndex } from './selectors.js';
import { resourceContext } from './resource-limits.js';
import { fixture, read, xml, tree } from '../tests/fixtures/validation.js';
import { storedArchive } from '../tests/fixtures/archive.js';
async function collect(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks).toString(); }
for (const type of ['slidenum', 'datetime', ...Array.from({ length: 13 }, (_, n) => `datetime${n + 1}`), 'footer', 'header', 'other', '', null]) it(`retains field kind, cache and original inline position: ${type}`, async () => {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Field"/></p:nvSpPr><p:txBody><a:p/><a:p><a:pPr/><a:r><a:t>Before</a:t></a:r><a:br/><a:fld id="id &amp; 😀"${type === null ? '' : ` type="${type}"`}><a:t>Cached <![CDATA[<&]]><a:span>nested</a:span></a:t></a:fld><a:endParaRPr/></a:p></p:txBody></p:sp>`)) });
  const reader = read(volume), bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, value]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(value!) }))), context = resourceContext({});
  const fingerprint = (await readSelectionIndex(bytes, context)).fingerprint, fs = createMemoryFileSystem();
  const result = await openRetainedText({ async *parts() { yield* reader.names; }, async has(part) { return reader.has(part); }, async byteLength(part) { return reader.get(part).length; }, async *read(part) { yield reader.get(part); } }, fingerprint, {}, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  expect(JSON.parse(await collect(streamJson(result.fields())))).toEqual(await readFields(bytes, {}, context));
  expect(result.fieldCount).toBe(1); await result.close(); expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['compatibility', 'mixed-namespaces', 'strict', 'table'] as const) it(`preserves original field caches and projected inline positions: ${mode}`, async () => {
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main', strict = 'http://purl.oclc.org/ooxml/drawingml/main';
  let paragraph = `<a:r><a:t>Before</a:t></a:r><a:fld id="field" type="footer"><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="a"><a:t>Projected</a:t></mc:Choice><mc:Fallback><a:t>Fallback</a:t></mc:Fallback></mc:AlternateContent><a:t>Original</a:t></a:fld>`;
  if (mode === 'mixed-namespaces') paragraph = `<s:br xmlns:s="${strict}"/><s:fld xmlns:s="${strict}" id="foreign"/><a:br/>${paragraph}<a:fld/>`;
  let content = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Field"/></p:nvSpPr><p:txBody><a:p>${paragraph}</a:p></p:txBody></p:sp>`;
  if (mode === 'table') content = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3"/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="${a}/table"><a:tbl><a:tr><a:tc><a:txBody><a:p>${paragraph}</a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:fld/></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', content)) });
  if (mode === 'strict') for (const [path, source] of Object.entries(volume.toJSON())) volume.writeFileSync(path, source!.split('http://schemas.openxmlformats.org/presentationml/2006/main').join('http://purl.oclc.org/ooxml/presentationml/main').split(a).join(strict).split('http://schemas.openxmlformats.org/officeDocument/2006/relationships').join('http://purl.oclc.org/ooxml/officeDocument/relationships'));
  const reader = read(volume), bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, value]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(value!) }))), context = resourceContext({});
  const fingerprint = (await readSelectionIndex(bytes, context)).fingerprint, fs = createMemoryFileSystem();
  const result = await openRetainedText({ async *parts() { yield* reader.names; }, async has(part) { return reader.has(part); }, async byteLength(part) { return reader.get(part).length; }, async *read(part) { yield reader.get(part); } }, fingerprint, {}, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  const fields = JSON.parse(await collect(streamJson(result.fields())));
  expect(fields).toEqual(await readFields(bytes, {}, context)); expect(fields[0].cachedText).toBe('Original');
  expect(result.fieldCount).toBe(fields.length); await result.close(); expect(await fs.readdir('/')).toEqual([]);
});
