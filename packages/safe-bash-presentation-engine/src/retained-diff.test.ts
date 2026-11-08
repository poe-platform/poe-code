import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPresentation } from './creation.js';
import { comparePresentations } from './diff.js';
import { openRetainedDiff } from './retained-diff.js';
import { streamJson } from './retained-output.js';
import { resourceContext } from './resource-limits.js';
async function collect(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks).toString(); }
const source = (bytes: Uint8Array) => ({ size: bytes.length, async read(offset: number, length: number) { return bytes.slice(offset, offset + length); } });
for (const mode of ['structural', 'raw', 'text', 'media', 'relationships'] as const) it(`retains ${mode} comparison with exact SDK output and lifetime`, async () => {
  const context = resourceContext({}), fs = createMemoryFileSystem();
  const left = await createPresentation({ slides: [{ shapes: [{ text: 'Before <&😀', name: 'One', x: 0, y: 0, width: 1, height: 1 }] }] }, context);
  const right = await createPresentation({ slides: [{ shapes: [{ text: 'After', name: 'One', x: 0, y: 0, width: 1, height: 1 }] }, {}] }, context);
  const expected = await comparePresentations(left, right, { mode }, context);
  const view = await openRetainedDiff(source(left), source(right), { mode }, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  expect(JSON.parse(await collect(streamJson(view.data)))).toEqual(expected);
  expect(JSON.parse(await collect(streamJson(view.data)))).toEqual(expected);
  await view.close();
  await expect(collect(streamJson(view.data))).rejects.toMatchObject({ code: 'invalid-handle' });
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['raw', 'media', 'relationships'] as const) it(`preserves ${mode} ordering, duplicate media counts and streamed Unicode relationships`, async () => {
  const { fixture, rels } = await import('../tests/fixtures/validation.js');
  const { storedArchive } = await import('../tests/fixtures/archive.js');
  function deck(revised: boolean) {
    const volume = fixture({ '_rels/slide.xml.rels': rels([['layout', 'slideLayout', 'layout.xml'], ['notes', 'notesSlide', 'notes.xml'], ['image', 'image', revised ? 'copy.png' : 'image.png'], ['unicode😀<&'.replace('&', '&amp;').replace('<', '&lt;'), 'hyperlink', `https://example.com/${revised ? 'new' : 'old'}`, 'External']]) });
    const types = volume.readFileSync('/deck/[Content_Types].xml', 'utf8') as string;
    volume.writeFileSync('/deck/[Content_Types].xml', types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>'));
    volume.writeFileSync('/deck/image.png', 'same media');
    if (revised) volume.writeFileSync('/deck/copy.png', 'same media');
    volume.writeFileSync(`/deck/${revised ? 'added' : 'removed'}.xml`, '<custom/>');
    return storedArchive(Object.entries(volume.toJSON()).reverse().map(([path, text]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(text!) })));
  }
  const left = deck(false), right = deck(true), context = resourceContext({}), fs = createMemoryFileSystem();
  const expected = await comparePresentations(left, right, { mode }, context);
  const view = await openRetainedDiff(source(left), source(right), { mode }, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  expect(JSON.parse(await collect(streamJson(view.data)))).toEqual(expected); await view.close(); expect(await fs.readdir('/')).toEqual([]);
});

it('rejects oversized retained inputs before reading their payloads', async () => {
  const fs = createMemoryFileSystem(); let reads = 0;
  const oversized = { size: 100, async read() { reads++; return new Uint8Array(100); } };
  await expect(openRetainedDiff(oversized, oversized, { mode: 'raw' }, { limits: { maxBytes: 10 }, workingStorage: { fs, directory: '/' } })).rejects.toMatchObject({ code: 'resource-limit', phase: 'admit' });
  expect(reads).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
