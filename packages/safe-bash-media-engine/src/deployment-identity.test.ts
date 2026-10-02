import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

// Review changes to native policy, build recipes and inventory interpretation
// together with compatibility evidence. These source pins do not admit an image
// or qualify installed provider enforcement. Executable and SDK pins are separate.
it.each([
  ['Dockerfile', '2c8ccffeaa2d4674f59475bd419230d219209e94318259c6b177f9479d9f7b01'],
  ['container-lock.json', 'e8afb6612b0544a7ebed537c46af8040f0a96f6bb297a78d82b32afa07571044'],
  ['container.mjs', '96b660ba3e07b5caa54c1f7ef4035a33831b66c45102840f26093615e29d56af'],
  ['inventory.mjs', '86b6b95e7bfb3cfa0f8fc1e2fe43e8d3f8fe3db8c734bc0675c4921669765b14'],
  ['start.mjs', '5cb9f1c2d7673694aa63cc72e4d82d0d24d552d49f14c1a4a1211d2eacc841d8'],
])('requires reviewed deployment identity for %s', async (name, digest) => {
  const bytes = await readFile(new URL('../server/' + name, import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
  // Exercise rejection with an in-memory mutation; never edit native fixtures.
  const changed = Buffer.from(bytes);
  changed[0] = changed[0]! ^ 1;
  expect(createHash('sha256').update(changed).digest('hex')).not.toBe(digest);
});
