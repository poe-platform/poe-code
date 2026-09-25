import { expect, test, vi } from 'vitest';
import { createS3NamespaceFileSystem, type S3NamespaceOptions } from '../src/fs/s3/namespace.js';

const root = { ino: 1, revision: 1, type: 'directory', mode: 493, time: 0, bytes: [] };
const manifest = () => ({ version: 1, identity: 'namespace', nextInode: 2, nodes: { '/': root } });

function transport(chunks: string[]) {
  let reads = 0;
  let closed = false;
  const client = {
    capabilities: { conditionalPut: true, streamingRead: true },
    async getObjectStream() {
      return { ETag: '"strong"', Body: (async function* () {
        try { for (const chunk of chunks) { reads++; yield new TextEncoder().encode(chunk); } }
        finally { closed = true; }
      })() };
    },
  } as unknown as S3NamespaceOptions['client'];
  return { client, reads: () => reads, closed: () => closed };
}

test.each([
  '{"version":1,"identity":"namespace","nextInode":2,"nodes":[',
  '{"version":1,"identity":"namespace","nextInode":2,"nodes":{"/":{ "bytes":[{',
  '{"version":1,"identity":"namespace","nextInode":2,"nodes":{"/":{"unknown":',
])('rejects invalid graph before consuming its remaining objects: %s', async prefix => {
  const source = transport([prefix, '{},'.repeat(100_000), '{}]}']);
  await expect(createS3NamespaceFileSystem({ client: source.client, bucket: 'bucket', key: 'manifest' })).rejects.toMatchObject({ code: 'EIO' });
  expect(source.reads()).toBe(1);
  expect(source.closed()).toBe(true);
});

test('admits entry and byte quotas before consuming the rest of the graph', async () => {
  for (const [prefix, limits] of [
    ['{"version":1,"identity":"namespace","nextInode":3,"nodes":{"/":' + JSON.stringify(root) + ',"/extra":', { maxEntries: 1 }],
    ['{"version":1,"identity":"namespace","nextInode":3,"nodes":{"/file":{"bytes":[0,0,', { maxBytes: 1 }],
  ] as const) {
    const source = transport([prefix, '0,'.repeat(100_000)]);
    await expect(createS3NamespaceFileSystem({ client: source.client, bucket: 'bucket', key: 'manifest', ...limits })).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(source.reads()).toBe(1);
    expect(source.closed()).toBe(true);
  }
});

test('accepts valid manifests across every token boundary and on later reads', async () => {
  const source = transport([...JSON.stringify(manifest())]);
  const fs = await createS3NamespaceFileSystem({ client: source.client, bucket: 'bucket', key: 'manifest' });
  expect((await fs.stat('/')).type).toBe('directory');
});

test.each([
  JSON.stringify(manifest()).replace('"version":1', '"version":1,"version":1'),
  JSON.stringify(manifest()).slice(0, -1) + ',}',
  JSON.stringify(manifest()) + '{}',
])('rejects duplicate fields and malformed JSON: %s', async text => {
  const source = transport([text]);
  await expect(createS3NamespaceFileSystem({ client: source.client, bucket: 'bucket', key: 'manifest' })).rejects.toMatchObject({ code: 'EIO' });
});

test('preserves UTF-8, escaped keys, numeric content and per-file read bounds', async () => {
  const text = JSON.stringify({ ...manifest(), nextInode: 4, nodes: {
    '/': root,
    '/é': { ...root, ino: 2, type: 'file', bytes: [0, 128, 255], time: 1.5e10 },
    '/other': { ...root, ino: 3, type: 'file', bytes: [1] },
  } }).replace('/other', '/o\\u0074her');
  const source = transport([]);
  source.client.getObjectStream = async () => ({ ETag: '"strong"', Body: (async function* () {
    for (const byte of new TextEncoder().encode(text)) yield Uint8Array.of(byte);
  })() });
  const fs = await createS3NamespaceFileSystem({ client: source.client, bucket: 'bucket', key: 'manifest' });
  expect(await fs.readFile('/é', { maxBytes: 3 })).toEqual(Uint8Array.of(0, 128, 255));
  expect(await fs.readFile('/other', { maxBytes: 1 })).toEqual(Uint8Array.of(1));
});

test.each(['01', '+1', 'NaN', '256', '-1', '1.1', 'null', 'true', '"0"', '[]', '{}'])('rejects invalid byte token %s', async token => {
  const source = transport(['{"nodes":{"/file":{"bytes":[' + token + ',', '0]}}}']);
  await expect(createS3NamespaceFileSystem({ client: source.client, bucket: 'bucket', key: 'manifest' })).rejects.toMatchObject({ code: 'EIO' });
  expect(source.reads()).toBe(1);
});

test('never sends a container token to JSON.parse until graph admission completes', async () => {
  const source = transport(['{"version":1,"identity":"namespace","nextInode":2,"nodes":[', '{}] }']);
  const parse = vi.spyOn(JSON, 'parse');
  try {
    await expect(createS3NamespaceFileSystem({ client: source.client, bucket: 'bucket', key: 'manifest' })).rejects.toMatchObject({ code: 'EIO' });
    expect(parse.mock.calls.some(([text]) => text.startsWith('{') || text.startsWith('['))).toBe(false);
  } finally { parse.mockRestore(); }
});

test('rejects a compact byte array within the wire limit before graph allocation', async () => {
  const prefix = '{"version":1,"identity":"namespace","nextInode":3,"nodes":{"/file":{"bytes":[';
  const source = transport([prefix + '0,'.repeat(1100), '0]}}}']);
  const parse = vi.spyOn(JSON, 'parse');
  try {
    await expect(createS3NamespaceFileSystem({ client: source.client, bucket: 'bucket', key: 'manifest', maxManifestBytes: 4096 })).rejects.toMatchObject({ code: 'EFBIG' });
    expect(source.reads()).toBe(1);
    expect(source.closed()).toBe(true);
    expect(parse.mock.calls.some(([text]) => text.startsWith('{') || text.startsWith('['))).toBe(false);
  } finally { parse.mockRestore(); }
});

test('defaults to a 4 MiB manifest byte cap', async () => {
  const source = transport([' '.repeat(4 * 1024 * 1024 + 1)]);
  await expect(createS3NamespaceFileSystem({ client: source.client, bucket: 'bucket', key: 'manifest' })).rejects.toMatchObject({ code: 'EFBIG' });
  expect(source.closed()).toBe(true);
});

test('applies graph admission after initialization too', async () => {
  const chunks = [JSON.stringify(manifest())];
  const source = transport(chunks);
  const fs = await createS3NamespaceFileSystem({ client: source.client, bucket: 'bucket', key: 'manifest' });
  chunks.splice(0, 1, '{"nodes":[', '{}'.repeat(100_000));
  await expect(fs.stat('/')).rejects.toMatchObject({ code: 'EIO' });
  expect(source.reads()).toBe(2);
});
