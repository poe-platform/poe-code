import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

// Review changes to native policy, build recipes and inventory interpretation
// together with compatibility evidence. These source pins do not admit an image
// or qualify installed provider enforcement. Executable and SDK pins are separate.
it.each([
  ['Dockerfile.dockerignore', '089e8084590ade295362c924d5c51d5af5499dd057ad6c8ac52a0b0b9c4ba3d1'],
  ['Dockerfile', 'fbf78b29e30a8d8aa563347d2d57d9ddab08b24dcd9f05dde7134a7f05c8eaff'],
  ['container-lock.json', '180816e2c9c99e0416a247db61ec3ee173c862faca8b3d673b27a147685c11ad'],
  ['container.mjs', '82cad7d23dedd6a8af6e4e7ebe0288e23b31ae7ee6723254df77c8068d940396'],
  ['inventory.mjs', '5687c988ded1b59034240960e72f57df5f241172999e196ce41e85620c1d8370'],
  ['start.mjs', '5cb9f1c2d7673694aa63cc72e4d82d0d24d552d49f14c1a4a1211d2eacc841d8'],
])('requires reviewed deployment identity for %s', async (name, digest) => {
  const bytes = await readFile(new URL('../server/' + name, import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
  // Exercise rejection with an in-memory mutation; never edit native fixtures.
  const changed = Buffer.from(bytes);
  changed[0] = changed[0]! ^ 1;
  expect(createHash('sha256').update(changed).digest('hex')).not.toBe(digest);
});
