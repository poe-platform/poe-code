import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

// Review changes to native policy, build recipes and inventory interpretation
// together with compatibility evidence. These source pins do not admit an image
// or qualify installed provider enforcement. Executable and SDK pins are separate.
it.each([
  ['Dockerfile', 'fe28f39e09fe43f16f0f9fa8d584d56008606fc560316c405e59a0cba0d0b881'],
  ['container-lock.json', 'e8afb6612b0544a7ebed537c46af8040f0a96f6bb297a78d82b32afa07571044'],
  ['container.mjs', '96b660ba3e07b5caa54c1f7ef4035a33831b66c45102840f26093615e29d56af'],
  ['inventory.mjs', 'b7c3629f680f3791c4f1a2246c141353293b61b5c28998dc6d62b811c520cdab'],
  ['start.mjs', '5cb9f1c2d7673694aa63cc72e4d82d0d24d552d49f14c1a4a1211d2eacc841d8'],
])('requires reviewed deployment identity for %s', async (name, digest) => {
  const bytes = await readFile(new URL('../server/' + name, import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
  // Exercise rejection with an in-memory mutation; never edit native fixtures.
  const changed = Buffer.from(bytes);
  changed[0] = changed[0]! ^ 1;
  expect(createHash('sha256').update(changed).digest('hex')).not.toBe(digest);
});
