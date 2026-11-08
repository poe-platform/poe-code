import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { readMemberships } from './memberships.js';
import { openRetainedMemberships } from './retained-memberships.js';
import { resourceContext } from './resource-limits.js';
import { openPackageArchive } from './retained-package.js';
import { streamJson } from './retained-output.js';
import { membershipFixture } from '../tests/fixtures/memberships.js';
async function collect(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks).toString(); }
for (const kind of ['sections', 'shows'] as const) for (const mode of ['plain', 'strict', 'empty', 'absent', 'duplicate', 'bad-id', 'missing-name', 'missing-slide', 'repeated-slide', 'foreign', 'multiple', 'max-id', 'overflow-id', 'zero-id', 'missing-members', 'extension-identity', 'extension-content', 'member-attributes']) it(`preserves ${kind} SDK parity: ${mode}`, async () => {
  const { bytes } = membershipFixture(kind, mode), context = resourceContext({}), fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const archive = await openPackageArchive({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); } }, settings);
  try {
    const expected = await readMemberships(bytes, kind, context).then(value => ({ value }), error => ({ error })), pending = openRetainedMemberships(archive, kind, settings);
    if ('error' in expected) await expect(pending).rejects.toMatchObject({ code: expected.error.code, message: expected.error.message, phase: expected.error.phase });
    else { const view = await pending; async function* records() { for await (const record of view.records()) yield { id: record.id, name: record.name, position: record.position, slides: record.slides() }; }
      expect(await collect(streamJson(records()))).toBe(JSON.stringify(expected.value)); await view.close(); await expect(view.records().next()).rejects.toMatchObject({ code: 'invalid-handle' });
    }
  } finally { await archive.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
