import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedText } from './retained-text.js';
import { streamJson } from './retained-output.js';
import type { ReadPresentationTextOptions } from './text-reading.js';
import { readTextFrames } from './text-frames.js';
import { readSelectionIndex } from './selectors.js';
import { resourceContext } from './resource-limits.js';
import { storedArchive } from '../tests/fixtures/archive.js';
import { fixture, read, xml, tree } from '../tests/fixtures/validation.js';
const shape = (id: number, body: string, name = 'Text') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/></p:nvSpPr><p:txBody>${body}</p:txBody></p:sp>`;
const run = (text: string) => `<a:r><a:t>${text}</a:t></a:r>`;
const archiveOf = (reader: ReturnType<typeof read>) => ({ async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } });
async function collected(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks).toString(); }
for (const mode of ['plain', 'groups', 'table', 'compatibility', 'strict'] as const) it(`retains frame formatting with buffered parity: ${mode}`, async () => {
  let content = shape(3, `<a:bodyPr anchor="dist" wrap="square" rot="-60000"><a:spAutoFit/></a:bodyPr><a:p>${run('港 &amp; 😀')}<a:br/><a:fld id="clock" type="date"><a:t>Yesterday</a:t></a:fld></a:p><a:p/>`);
  if (mode === 'groups') content = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="8" name="Group"/></p:nvGrpSpPr>${content}${shape(4, `<a:p>${run('Last')}</a:p>`)}</p:grpSp>`;
  if (mode === 'table') content = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3"/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/main/table"><a:tbl><a:tr><a:tc><a:txBody><a:p>${run('Cell')}</a:p></a:txBody></a:tc><a:tc><a:txBody><a:p/></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  if (mode === 'compatibility') content = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:unknown"><mc:Choice Requires="x">${shape(4, '<a:p/>')}</mc:Choice><mc:Fallback>${content}</mc:Fallback></mc:AlternateContent>`;
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', content)) });
  if (mode === 'strict') for (const [path, source] of Object.entries(volume.toJSON())) volume.writeFileSync(path, source!.split('http://schemas.openxmlformats.org/presentationml/2006/main').join('http://purl.oclc.org/ooxml/presentationml/main').split('http://schemas.openxmlformats.org/drawingml/2006/main').join('http://purl.oclc.org/ooxml/drawingml/main').split('http://schemas.openxmlformats.org/officeDocument/2006/relationships').join('http://purl.oclc.org/ooxml/officeDocument/relationships'));
  const reader = read(volume), bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, value]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(value!) }))), context = resourceContext({});
  const index = await readSelectionIndex(bytes, context);
  const options: ReadPresentationTextOptions[] = [{}, { scope: 'layouts' }, { scope: 'masters' }, { select: { kind: 'slide', position: { coordinateSystem: 'one-based', value: 1 } } }, { select: { token: index.objects.find(value => value.id === '3')!.token } }];
  for (const option of options) {
    const fs = createMemoryFileSystem(), expected = await readTextFrames(bytes, option, context);
    const result = await openRetainedText(archiveOf(reader), index.fingerprint, option, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, 'frames');
    expect(JSON.parse(await collected(streamJson(result.frames())))).toEqual(expected);
    expect(result.frameCount).toBe(expected.length); await result.close(); expect(await fs.readdir('/')).toEqual([]);
  }
});


it('retains signed zero and ignores projected body properties just like native frame reads', async () => {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', shape(3, `<a:bodyPr lIns="-0"/><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="a"><a:bodyPr wrap="bad"/></mc:Choice><mc:Fallback/></mc:AlternateContent><a:p/>`))) });
  const reader = read(volume), fs = createMemoryFileSystem();
  const result = await openRetainedText(archiveOf(reader), 'a'.repeat(64), {}, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, 'frames');
  for await (const frame of result.frames()) { expect(Object.is(frame.formatting.marginLeft, -0)).toBe(true); expect(frame.formatting.wrap).toBe(null); }
  await result.close(); await expect(result.frames().next()).rejects.toMatchObject({ code: 'invalid-handle' }); expect(await fs.readdir('/')).toEqual([]);
});
