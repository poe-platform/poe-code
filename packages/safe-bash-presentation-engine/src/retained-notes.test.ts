import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedNotes } from './retained-notes.js';
import { streamJson } from './retained-output.js';
import { readNotes } from './notes.js';
import { readSelectionIndex } from './selectors.js';
import { resourceContext } from './resource-limits.js';
import { fixture, read, xml, tree } from '../tests/fixtures/validation.js';
import { storedArchive } from '../tests/fixtures/archive.js';
async function collect(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks).toString(); }
for (const mode of ['plain', 'compatibility', 'foreign', 'null', 'empty', 'id-padding']) it(`retains replayable notes with SDK parity: ${mode}`, async () => {
  let text = '<a:p><a:r><a:t>First<![CDATA[<&]]><a:span>nested</a:span></a:t></a:r><a:br/><a:fld><a:t>Cached</a:t></a:fld></a:p><a:p/>';
  if (mode === 'compatibility') text = '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="a"><a:p><a:r><a:t>Projected</a:t></a:r></a:p></mc:Choice><mc:Fallback/></mc:AlternateContent>' + text;
  if (mode === 'foreign') text += '<x:p xmlns:x="urn:foreign" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x"><x:r><x:t>Ignored</x:t></x:r></x:p>';
  const content = `<p:sp><p:nvSpPr><p:cNvPr id="${mode === 'id-padding' ? '00003' : '3'}"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>${mode === 'null' ? '' : `<p:txBody>${mode === 'empty' ? '' : text}</p:txBody>`}</p:sp>`;
  const volume = fixture({ 'notes.xml': xml('notes', tree('2', content)) }), reader = read(volume);
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, value]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(value!) }))), context = resourceContext({});
  const index = await readSelectionIndex(bytes, context), fs = createMemoryFileSystem();
  const view = await openRetainedNotes({ async *parts() { yield* reader.names; }, async has(part) { return reader.has(part); }, async byteLength(part) { return reader.get(part).length; }, async *read(part) { yield reader.get(part); } }, index.fingerprint, { selection: { token: index.slides[0]!.token } }, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  expect(JSON.parse(await collect(streamJson(view.records())))).toEqual(await readNotes(bytes, {}, context));
  expect(view.count).toBe(1); const record = (await view.records().next()).value!;
  if (record.text) expect(await collect(record.text())).toBe((await readNotes(bytes, {}, context))[0]!.text);
  await view.close(); await expect(view.records().next()).rejects.toMatchObject({ code: 'invalid-handle' });
  await expect(collect(record.part())).rejects.toMatchObject({ code: 'invalid-handle' }); expect(await fs.readdir('/')).toEqual([]);
});
