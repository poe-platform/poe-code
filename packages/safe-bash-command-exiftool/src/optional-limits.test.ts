import assert from 'node:assert/strict';
import test from 'node:test';
import { Resources, exiftoolLimits } from './resources.js';
import { createExiftoolArguments } from './sdk.js';
import { encodeJsonScalar } from './scalar.js';

test('omitted ExifTool quotas are unlimited and individual quotas stay independent', () => {
  for (const limit of Object.values(exiftoolLimits)) assert.equal(limit, Infinity);
  const resources = new Resources({ signal: new AbortController().signal, maxOutputBytes: 0 });
  resources.admit('input', 16_777_217);
  assert.throws(() => resources.admit('output', 1), /budget/);
});
test('ExifTool SDK admits omitted argument and file quotas', () => {
  const files = Array.from({ length: 4097 }, (_, index) => `file${index}.png`);
  const engine = { signal: new AbortController().signal };
  assert.ok(createExiftoolArguments({ files }, engine));
  assert.throws(() => createExiftoolArguments({ files }, { ...engine, maxArguments: 4096 }), /argument count/);
  assert.throws(() => createExiftoolArguments({ files }, { ...engine, maxFiles: 64 }), /file count/);
});
test('ExifTool scalar accepts unlimited resolved quotas', () => {
  assert.equal(encodeJsonScalar('hello', exiftoolLimits), '"hello"');
  assert.throws(() => encodeJsonScalar('hello', { maxOutputBytes: 1 }), /output/);
});

test('ExifTool staging collision retries have only an explicit quota', async () => {
  const { Publication } = await import('./publication.js');
  const { FsError } = await import('safe-bash-contracts/errors');
  const parent = { type: 'directory', mode: 0o755 };
  for (const maximum of [undefined, 32, 64]) {
    let attempts = 0, published = false;
    const context = { signal: new AbortController().signal, fs: {
      async stat() { return parent; }, capabilities: { atomicFileStaging: true },
      async createStagedFile() { if (++attempts <= 32) throw new FsError('EEXIST', { syscall: 'mkdir' }); return {}; },
      async publishStagedFile() { published = true; }, async removeStagedFile() {},
    } } as unknown as import('safe-bash-contracts/command').CommandContext;
    const publication = new Publication(context, maximum);
    try {
      const pending = publication.publish('/output.png', new Uint8Array(), null, false);
      if (maximum === 32) { await assert.rejects(pending, /collision limit/); assert.equal(published, false); }
      else { await pending; assert.equal(attempts, 33); assert.equal(published, true); }
    } finally { await publication.close(); }
  }
});
