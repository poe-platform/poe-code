import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockS3Client } from '../../../../safe-fs/src/fs/s3/mock.js';
import { createS3NamespaceFileSystem } from '../../../../safe-fs/src/fs/s3/namespace.js';

const options = { bucket: 'owned', key: 'namespace.json' };
const bytes = (value: string) => new TextEncoder().encode(value);

test('S3 namespace refuses a transport without verified conditional writes', async () => {
  const client = new MockS3Client({ buckets: ['owned'] });
  Object.defineProperty(client, 'capabilities', { value: { streamingRead: true } });
  await assert.rejects(createS3NamespaceFileSystem({ ...options, client }), { code: 'ENOTSUP' });
  assert.equal(client.requests.length, 0);
});

test('S3 namespace persists explicit directories and binary files using only its manifest key', async () => {
  const client = new MockS3Client({ buckets: ['owned'] });
  const first = await createS3NamespaceFileSystem({ ...options, client });
  await first.mkdir('/temporary');
  const descriptor = await first.open!('/temporary/file', { access: 'readwrite', creation: 'exclusive' });
  await descriptor.write(new Uint8Array([0, 255, 42]), 0);
  await descriptor.close();
  const second = await createS3NamespaceFileSystem({ ...options, client });
  assert.deepEqual(await second.readFile('/temporary/file'), new Uint8Array([0, 255, 42]));
  assert.deepEqual(await second.readdir('/temporary'), [{ name: 'file', type: 'file' }]);
  assert.ok(client.requests.every(request => ['getObject', 'putObject'].includes(request.operation)));
  assert.ok(client.requests.every(request => 'Key' in request.input && request.input.Key === options.key));
});

test('S3 namespace cleanup refuses a replaced directory and preserves its new contents', async () => {
  const client = new MockS3Client({ buckets: ['owned'] });
  const first = await createS3NamespaceFileSystem({ ...options, client });
  const second = await createS3NamespaceFileSystem({ ...options, client });
  await first.mkdir('/temporary');
  await first.writeFile('/temporary/owned', bytes('old'));
  const expected = await first.lstat('/temporary');
  const parent = await first.stat('/');
  await second.rename('/temporary', '/moved');
  await second.mkdir('/temporary');
  await second.writeFile('/temporary/unrelated', bytes('keep'));
  await assert.rejects(first.removeTreeConditional!('/temporary', { expected, parent }), { code: 'EAGAIN' });
  assert.deepEqual(await second.readFile('/temporary/unrelated'), bytes('keep'));
  assert.deepEqual(await second.readFile('/moved/owned'), bytes('old'));
});

test('S3 namespace cleanup removes the owned subtree in one conditional mutation', async () => {
  const client = new MockS3Client({ buckets: ['owned'] });
  const fs = await createS3NamespaceFileSystem({ ...options, client });
  await fs.mkdir('/temporary/child', { recursive: true });
  await fs.writeFile('/temporary/child/owned', bytes('owned'));
  await fs.writeFile('/sibling', bytes('keep'));
  const expected = await fs.lstat('/temporary');
  const parent = await fs.stat('/');
  const before = client.requests.filter(request => request.operation === 'putObject').length;
  await fs.removeTreeConditional!('/temporary', { expected, parent });
  assert.equal(client.requests.filter(request => request.operation === 'putObject').length - before, 1);
  assert.deepEqual(await fs.readdir('/'), [{ name: 'sibling', type: 'file' }]);
  assert.deepEqual(await fs.readFile('/sibling'), bytes('keep'));
});

test('independent S3 namespace clients preserve concurrent mutations', async () => {
  const client = new MockS3Client({ buckets: ['owned'] });
  const first = await createS3NamespaceFileSystem({ ...options, client });
  const second = await createS3NamespaceFileSystem({ ...options, client });
  await Promise.all([first.writeFile('/one', bytes('one')), second.writeFile('/two', bytes('two'))]);
  assert.deepEqual(await first.readFile('/one'), bytes('one'));
  assert.deepEqual(await first.readFile('/two'), bytes('two'));
});

test('S3 namespace limits and cancellation leave the committed tree unchanged', async () => {
  const client = new MockS3Client({ buckets: ['owned'] });
  const fs = await createS3NamespaceFileSystem({ ...options, client, maxBytes: 3 });
  await fs.writeFile('/keep', bytes('abc'));
  await assert.rejects(fs.writeFile('/too-large', bytes('x')), { code: 'ENOSPC' });
  const controller = new AbortController();
  controller.abort(new Error('cancel namespace mutation'));
  await assert.rejects(fs.unlink!('/keep', { signal: controller.signal }), error => error === controller.signal.reason);
  assert.deepEqual(await fs.readFile('/keep'), bytes('abc'));
  assert.deepEqual(await fs.readdir('/'), [{ name: 'keep', type: 'file' }]);
});

test('S3 namespace descriptor publication cannot overwrite a replacement', async () => {
  const client = new MockS3Client({ buckets: ['owned'] });
  const fs = await createS3NamespaceFileSystem({ ...options, client });
  await fs.writeFile('/file', bytes('old'));
  const descriptor = await fs.open!('/file', { access: 'readwrite' });
  await descriptor.write(bytes('new'), 0);
  await fs.unlink!('/file');
  await fs.writeFile('/file', bytes('keep'));
  await assert.rejects(descriptor.sync(false), { code: 'EAGAIN' });
  await assert.rejects(descriptor.close());
  assert.deepEqual(await fs.readFile('/file'), bytes('keep'));
});

test('S3 namespace admits the serialized manifest budget before allocating its JSON', async context => {
  const client = new MockS3Client({ buckets: ['owned'] });
  const stringify = JSON.stringify;
  let serializations = 0;
  context.mock.method(JSON, 'stringify', ((value: any, ...args: any[]) => {
    if (value?.version === 1 && value.nodes) serializations++;
    return (stringify as (...args: any[]) => string)(value, ...args);
  }) as typeof JSON.stringify);
  await assert.rejects(createS3NamespaceFileSystem({ ...options, client, maxManifestBytes: 128 }), { code: 'EFBIG' });
  assert.equal(serializations, 0);
});

test('S3 namespace write flags retain exclusive-create and append semantics', async () => {
  const client = new MockS3Client({ buckets: ['owned'] });
  const fs = await createS3NamespaceFileSystem({ ...options, client });
  await fs.writeFile('/file', bytes('one'), { flag: 'wx' });
  await assert.rejects(fs.writeFile('/file', bytes('replace'), { flag: 'wx' }), { code: 'EEXIST' });
  await assert.rejects(fs.writeFile('/file', bytes('append'), { flag: 'ax' }), { code: 'EEXIST' });
  await fs.writeFile('/file', bytes('two'), { flag: 'a' });
  assert.deepEqual(await fs.readFile('/file'), bytes('onetwo'));
  await assert.rejects(fs.writeFile('/file', bytes('invalid'), { flag: 'invalid' as any }), { code: 'EINVAL' });
  await assert.rejects(fs.writeFile('/file', 'not bytes' as any), { code: 'EINVAL' });
});

test('S3 namespace refuses invalid descriptor configuration before initialization effects', async () => {
  for (const invalid of [{ maxOpenFiles: 0 }, { maxFileBytes: 0 }, { chunkBytes: 1048577 }, { maxStagedBytes: 0 }, { maxStagedPages: 0 }]) {
    const client = new MockS3Client({ buckets: ['owned'] });
    await assert.rejects(createS3NamespaceFileSystem({ ...options, client, ...invalid }));
    assert.equal(client.requests.length, 0);
  }
});

test('S3 namespace refuses unaccounted schema fields rather than serializing them on mutation', async () => {
  for (const extra of ['manifest', 'node']) {
    const client = new MockS3Client({ buckets: ['owned'] });
    await createS3NamespaceFileSystem({ ...options, client });
    const object = { Bucket: options.bucket, Key: options.key };
    const stored = await client.getObject(object);
    const value = JSON.parse(new TextDecoder().decode(stored.Body as Uint8Array));
    if (extra === 'manifest') value.unaccounted = 'not part of the encoding budget';
    else value.nodes['/'].unaccounted = 'not part of the encoding budget';
    await client.putObject({ ...object, Body: bytes(JSON.stringify(value)), IfMatch: stored.ETag! });
    await assert.rejects(createS3NamespaceFileSystem({ ...options, client }), { code: 'EIO' });
  }
});
