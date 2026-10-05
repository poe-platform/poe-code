import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedPresentationSettings } from './retained-presentation-settings.js';
import { readPresentationSettings } from './presentation-settings.js';
import { resourceContext } from './resource-limits.js';
import { readSelectionIndex } from './selectors.js';
import { openPackageArchive } from './retained-package.js';
import { streamJson } from './retained-output.js';
import { settingsFixture } from '../tests/fixtures/settings.js';
async function collect(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks).toString(); }
for (const mode of ['plain', 'strict', 'namespace', 'rebound', 'absent', 'large-numeric', 'safe-numeric', 'unsafe-numeric', 'numeric', 'numbering', 'duplicate', 'loop', 'modes', 'wrong-type', 'wrong-root']) it(`preserves settings SDK parity: ${mode}`, async () => {
  const { bytes } = settingsFixture(mode), context = resourceContext({}), fingerprint = (await readSelectionIndex(bytes, context)).fingerprint, fs = createMemoryFileSystem();
  const settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const archive = await openPackageArchive({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); } }, settings);
  try {
    const expected = await readPresentationSettings(bytes, context).then(value => ({ value }), error => ({ error }));
    const pending = openRetainedPresentationSettings(archive, fingerprint, settings);
    if ('error' in expected) await expect(pending).rejects.toMatchObject({ code: expected.error.code, message: expected.error.message, phase: expected.error.phase });
    else { const view = await pending; expect(await collect(streamJson(view.settings()))).toBe(JSON.stringify(expected.value)); expect(Object.is(view.settings().slideNumberStart, -0)).toBe(true); await view.close(); expect(() => view.settings()).toThrow(); }
  } finally { await archive.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
