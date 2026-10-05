import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedText } from './retained-text.js';
import { readTextParagraphs } from './text-paragraphs.js';
import { streamJson } from './retained-output.js';
import { resourceContext } from './resource-limits.js';
import { storedArchive } from '../tests/fixtures/archive.js';
import { fixture, read, xml, tree } from '../tests/fixtures/validation.js';
async function collected(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks).toString(); }
for (const kind of ['shape', 'table', 'group']) for (const malformed of [false, true]) for (const options of [{}, { paragraph: 0 }, { paragraph: 1 }, { paragraph: 8 }, { paragraph: -1 }, { paragraph: 0.5 }]) it(`retains selected paragraph formatting ${kind} ${malformed} ${JSON.stringify(options)}`, async () => {
  let content = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text"/></p:nvSpPr><p:txBody><a:p><a:pPr marL="12700"><a:buChar char="${'Large😀'.repeat(5000)}"/><a:tabLst><a:tab pos="12700" algn="ctr"/></a:tabLst></a:pPr><a:r><a:t>Text</a:t></a:r></a:p><a:p><a:pPr rtl="${malformed ? 'invalid' : 'true'}"/></a:p></p:txBody></p:sp>`;
  if (kind === 'group') content = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="Group"/></p:nvGrpSpPr>${content}</p:grpSp>`;
  if (kind === 'table') content = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/main/table"><a:tbl><a:tr><a:tc><a:txBody>${content.split('<p:txBody>')[1]!.split('</p:txBody>')[0]}</a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', content)) }), reader = read(volume);
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, value]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(value!) })));
  const fs = createMemoryFileSystem(); fs.readFile = async () => { throw new Error('whole-file read forbidden'); };
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
  let expected, error;
  try { expected = await readTextParagraphs(bytes, options, resourceContext({})); } catch (failure) { error = failure; }
  const pending = openRetainedText(archive, expected?.[0]?.location.fingerprint ?? 'a'.repeat(64), options, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, 'paragraphs');
  if (error) await expect(pending).rejects.toMatchObject({ message: (error as Error).message });
  else { const result = await pending; expect(JSON.parse(await collected(streamJson(result.paragraphFormats())))).toEqual(JSON.parse(JSON.stringify(expected))); expect(result.paragraphCount).toBe(expected!.length); await result.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
