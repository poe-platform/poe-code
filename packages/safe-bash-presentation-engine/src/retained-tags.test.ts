import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { readTags, type TagOptions } from './tags.js';
import { openRetainedTags } from './retained-tags.js';
import { readSelectionIndex } from './selectors.js';
import { streamJson } from './retained-output.js';
import { resourceContext } from './resource-limits.js';
import { tagFixture } from '../tests/fixtures/tags.js';
import { read } from '../tests/fixtures/validation.js';
async function collect(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks).toString(); }
for (const mode of ['plain', 'strict', 'empty', 'absent', 'duplicate', 'invalid-root', 'missing-value']) for (const scope of ['slides', 'presentation'] as const) it(`retains ${scope} tags with exact SDK parity: ${mode}`, async () => {
  const { volume, bytes } = tagFixture(mode), reader = read(volume), context = resourceContext({}), fingerprint = (await readSelectionIndex(bytes, context)).fingerprint;
  const fs = createMemoryFileSystem(), query: TagOptions = { scope }, expected = await readTags(bytes, query, context).then(value => ({ value }), error => ({ error }));
  const pending = openRetainedTags({ async *parts() { yield* reader.names; }, async has(part) { return reader.has(part); }, async byteLength(part) { return reader.get(part).length; }, async *read(part) { yield reader.get(part); } }, fingerprint, query, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  if ('error' in expected) await expect(pending).rejects.toMatchObject({ code: expected.error.code, message: expected.error.message, phase: expected.error.phase });
  else { const view = await pending; expect(JSON.parse(await collect(streamJson(view.records())))).toEqual(expected.value); await view.close(); await expect(view.records().next()).rejects.toMatchObject({ code: 'invalid-handle' }); }
  expect(await fs.readdir('/')).toEqual([]);
});

for (const scenario of ['token', 'reordered-token', 'stale-token', 'wrong-scope', 'missing-tag', 'slide', 'missing-slide', 'invalid-kind', 'presentation-token', 'presentation-all']) it(`preserves tag selection semantics: ${scenario}`, async () => {
  const { volume, bytes } = tagFixture('duplicate'), reader = read(volume), context = resourceContext({}), index = await readSelectionIndex(bytes, context), fs = createMemoryFileSystem();
  const tags = await readTags(bytes, { scope: scenario === 'presentation-token' ? 'presentation' : 'slides' }, context), location = tags[0]!.location;
  let query: TagOptions = { selection: { token: tags[0]!.selector } };
  if (scenario === 'reordered-token') query = { selection: { token: JSON.stringify(Object.fromEntries(Object.entries(location).reverse())) } };
  if (scenario === 'stale-token') query = { selection: { token: JSON.stringify({ ...location, fingerprint: '0'.repeat(64) }) } };
  if (scenario === 'wrong-scope') query = { scope: 'presentation', selection: { token: tags[0]!.selector } };
  if (scenario === 'missing-tag') query = { selection: { token: JSON.stringify({ ...location, objectId: 'tag:/tags.xml:99' }) } };
  if (scenario === 'slide') query = { selection: { kind: 'slide', position: { coordinateSystem: 'one-based', value: 1 } } };
  if (scenario === 'missing-slide') query = { selection: { kind: 'slide', position: { coordinateSystem: 'one-based', value: 99 } } };
  if (scenario === 'invalid-kind') query = { selection: { kind: 'part', all: true } };
  if (scenario === 'presentation-all') query = { scope: 'presentation', selection: { all: true } };
  const expected = await readTags(bytes, query, context).then(value => ({ value }), error => ({ error }));
  const pending = openRetainedTags({ async *parts() { yield* reader.names; }, async has(part) { return reader.has(part); }, async byteLength(part) { return reader.get(part).length; }, async *read(part) { yield reader.get(part); } }, index.fingerprint, query, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  if ('error' in expected) await expect(pending).rejects.toMatchObject({ code: expected.error.code, message: expected.error.message, phase: expected.error.phase });
  else { const view = await pending; expect(JSON.parse(await collect(streamJson(view.records())))).toEqual(expected.value); await view.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
