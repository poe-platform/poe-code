import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedText } from './retained-text.js';
import { readTextRuns } from './text-runs.js';
import { streamJson } from './retained-output.js';
import { resourceContext } from './resource-limits.js';
import { storedArchive } from '../tests/fixtures/archive.js';
import { fixture, read, xml, tree } from '../tests/fixtures/validation.js';
async function collected(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks).toString(); }
for (const malformed of [false, true]) for (const options of [{}, { paragraph: 0 }, { paragraph: 1 }, { run: 0 }, { run: 1 }, { run: 8 }, { paragraph: -1 }, { run: 0.5 }]) it(`retains selected run formatting ${malformed} ${JSON.stringify(options)}`, async () => {
  const content = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text"/></p:nvSpPr><p:txBody><a:p><a:r><a:rPr sz="1250"><a:latin typeface="${'Large😀'.repeat(5000)}"/></a:rPr><a:t>text</a:t></a:r><a:br><a:rPr b="${malformed ? 'invalid' : 'true'}"/></a:br></a:p><a:p><a:fld id="clock" type="date"><a:rPr spc="-0"/></a:fld></a:p></p:txBody></p:sp>`;
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', content)) }), reader = read(volume);
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, value]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(value!) })));
  const fs = createMemoryFileSystem(); fs.readFile = async () => { throw new Error('whole-file read forbidden'); };
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
  let expected, error;
  try { expected = await readTextRuns(bytes, options, resourceContext({})); } catch (failure) { error = failure; }
  const pending = openRetainedText(archive, expected?.[0]?.location.fingerprint ?? 'a'.repeat(64), options, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, 'runs');
  if (error) await expect(pending).rejects.toMatchObject({ message: (error as Error).message });
  else { const result = await pending; expect(JSON.parse(await collected(streamJson(result.runs())))).toEqual(JSON.parse(JSON.stringify(expected))); expect(result.runCount).toBe(expected!.length); await result.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
