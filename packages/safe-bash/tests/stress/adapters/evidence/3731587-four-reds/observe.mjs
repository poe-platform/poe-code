import assert from 'node:assert/strict';
import { FsError } from './archive/src/contracts/errors.ts';
import { createS3Transport, MockS3Client, S3FileSystem, S3RenameError } from './archive/src/fs/s3/index.ts';
import { WebDavFileSystem } from './archive/src/fs/webdav/index.ts';
import { MockDav } from './archive/tests/fs/webdav/mock.ts';
import { PropertyDav, withLoopbackDav } from './archive/tests/fs/webdav/property-fixture.ts';

const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);
const rows = [];
const bucket = 'classification';
const errorCode = async action => {
  try { await action(); return { status: 'resolved' }; }
  catch (error) {
    assert.ok(error instanceof FsError);
    return { status: 'rejected', name: error.name, code: error.code, path: error.path, syscall: error.syscall, message: error.message, ...(error instanceof S3RenameError ? { phase: error.phase, copiedKeys: error.copiedKeys, deletedKeys: error.deletedKeys } : {}) };
  }
};
const expectCode = async (action, code) => {
  const result = await errorCode(action);
  assert.equal(result.code, code);
  return result;
};
const s3 = (capabilities, options = {}) => {
  const mock = new MockS3Client({ buckets: [bucket] });
  const transport = capabilities === undefined ? mock : createS3Transport(mock, capabilities);
  return { mock, fs: new S3FileSystem({ transport, bucket, ...options }) };
};
const mutations = requests => requests.filter(request => ['putObject', 'copyObject', 'deleteObject', 'putObjectStream'].includes(request.operation));

{
  const { mock, fs } = s3();
  await fs.writeFile('/mode', bytes, { mode: 0o600 });
  const created = await mock.headObject({ Bucket: bucket, Key: 'mode' });
  await fs.writeFile('/zero', bytes, { mode: 0 });
  await fs.mkdir('/private', { mode: 0o700 });
  const reopened = new S3FileSystem({ transport: mock, bucket });
  assert.deepEqual(await reopened.readFile('/zero'), bytes);
  const before = mock.requests.length;
  const chmod = await expectCode(() => fs.chmod('/mode', 0o644), 'ENOTSUP');
  assert.equal(mock.requests.length, before);
  const execute = await expectCode(() => fs.access('/mode', 1), 'EACCES');
  await fs.writeFile('/mode', new Uint8Array([255]), { mode: 0o644 });
  assert.equal((await reopened.stat('/mode')).mode & 0o7777, 0o600);
  assert.deepEqual(await reopened.readFile('/mode'), new Uint8Array([255]));
  rows.push({ case: 's3-mode-observation-not-contract-approval', permissions: fs.capabilities.permissions, creationMetadata: created.Metadata, zeroModeReadable: true, privateDirectoryMode: (await fs.stat('/private')).mode & 0o7777, replacementRetains0600: true, chmod, nextPreviouslyMaskedAssertion: execute });
}

{
  const { mock, fs } = s3();
  await fs.writeFile('/file', bytes);
  const start = mock.requests.length;
  await fs.truncate('/file', 8);
  assert.deepEqual(await fs.readFile('/file'), bytes.slice(0, 8));
  await fs.truncate('/file', 12);
  const padded = new Uint8Array([...bytes.slice(0, 8), 0, 0, 0, 0]);
  assert.deepEqual(await fs.readFile('/file'), padded);
  const invalid = await expectCode(() => fs.truncate('/file', -1), 'EINVAL');
  assert.deepEqual(await fs.readFile('/file'), padded);
  const writes = mutations(mock.requests.slice(start));
  assert.equal(writes.length, 2);
  assert.ok(writes.every(request => request.input.IfMatch));
  const limited = new S3FileSystem({ transport: mock, bucket, maxReadBytes: 12 });
  const overLimit = await expectCode(() => limited.truncate('/file', 13), 'EFBIG');
  const unsupported = new S3FileSystem({ transport: createS3Transport(mock, {}), bucket });
  const beforeUnsupported = mock.requests.length;
  const noConditionalPut = await expectCode(() => unsupported.truncate('/file', 8), 'ENOTSUP');
  assert.deepEqual(mutations(mock.requests.slice(beforeUnsupported)), []);
  assert.deepEqual(await fs.readFile('/file'), padded);
  rows.push({ case: 's3-truncate', shrinkBytes: [...bytes.slice(0, 8)], growBytes: [...padded], writes: writes.map(request => ({ operation: request.operation, IfMatch: request.input.IfMatch })), invalid, overLimit, noConditionalPut });
}

for (const [label, capabilities] of [['copy', undefined], ['conditional-put', { conditionalPut: true, conditionalDelete: true }]]) {
  const { mock, fs } = s3(capabilities);
  await fs.writeFile('/source', bytes);
  const start = mock.requests.length;
  await fs.rename('/source', '/dest');
  const requests = mutations(mock.requests.slice(start));
  assert.equal(fs.capabilities.atomicRename, false);
  assert.deepEqual(await fs.readFile('/dest'), bytes);
  const source = await expectCode(() => fs.stat('/source'), 'ENOENT');
  assert.equal(requests[0].input.IfNoneMatch, '*');
  assert.ok(requests.at(-1).input.IfMatch);
  if (label === 'copy') assert.ok(requests[0].input.CopySourceIfMatch);
  rows.push({ case: `s3-rename-${label}`, atomicRename: false, destinationBytes: [...bytes], source, requests });
}

for (const [label, capabilities, options] of [
  ['explicit-disable', undefined, { allowNonAtomicRename: false }],
  ['missing-delete', { conditionalPut: true }, {}],
  ['missing-publication', { conditionalDelete: true }, {}],
]) {
  const { mock, fs } = s3(capabilities, options);
  await fs.writeFile('/source', bytes);
  const start = mock.requests.length;
  const result = await expectCode(() => fs.rename('/source', '/dest'), 'ENOTSUP');
  assert.equal(mock.requests.length, start);
  assert.deepEqual(await fs.readFile('/source'), bytes);
  await expectCode(() => fs.stat('/dest'), 'ENOENT');
  rows.push({ case: `s3-rename-${label}`, result, requestsDuringRename: 0, sourceBytesPreserved: true, destinationAbsent: true, atomicRename: fs.capabilities.atomicRename });
}

{
  const mock = new MockDav();
  mock.files.set('/file', bytes);
  const statuses = [];
  const fs = new WebDavFileSystem({ baseUrl: 'https://example.test/dav/', fetch: async (url, init) => {
    const response = await mock.fetch(url, init);
    statuses.push({ method: init.method, status: response.status });
    return response;
  } });
  const before = await fs.stat('/file');
  const result = await expectCode(() => fs.utimes('/file', 10000, 20000), 'ENOTSUP');
  assert.deepEqual(mock.files.get('/file'), bytes);
  assert.deepEqual(await fs.stat('/file'), before);
  assert.ok(statuses.some(entry => entry.method === 'PROPPATCH' && entry.status === 501));
  rows.push({ case: 'webdav-old-fixture', timestamps: fs.capabilities.timestamps, result, statuses, bytesAndMetadataPreserved: true });
}

{
  const mock = new PropertyDav();
  mock.base.files.set('/file', bytes);
  await withLoopbackDav(mock.fetch, async baseUrl => {
    const fs = new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch });
    await fs.utimes('/file', 10000, 20000);
    const reopened = new WebDavFileSystem({ baseUrl, fetch: globalThis.fetch });
    const stat = await reopened.stat('/file');
    assert.equal(stat.atimeMs, 10000);
    assert.equal(stat.mtimeMs, 20000);
    assert.deepEqual(await reopened.readFile('/file'), bytes);
    const patch = mock.base.requests.find(request => request.init.method === 'PROPPATCH');
    assert.equal(patch.headers.get('If-Match'), mock.base.etag('/file'));
    assert.ok(!String(patch.init.body).includes('getlastmodified'));
    rows.push({ case: 'webdav-existing-property-fixture-loopback', atimeMs: stat.atimeMs, mtimeMs: stat.mtimeMs, newInstanceReadsPersistentProperty: true, bytesPreserved: true, ifMatch: patch.headers.get('If-Match'), payload: patch.init.body });
  });
}

for (const [status, code] of [[403, 'EACCES'], [423, 'EBUSY'], [507, 'ENOSPC']]) {
  const mock = new PropertyDav();
  mock.base.files.set('/file', bytes);
  mock.propertyStatus = status;
  const fs = new WebDavFileSystem({ baseUrl: 'https://example.test/dav/', fetch: mock.fetch });
  const result = await expectCode(() => fs.utimes('/file', 1, 2), code);
  assert.equal(mock.properties.size, 0);
  assert.deepEqual(mock.base.files.get('/file'), bytes);
  rows.push({ case: 'webdav-property-rejection', propertyStatus: status, result, priorBytesPreserved: true });
}

{
  const mock = new PropertyDav();
  mock.base.files.set('/file', bytes);
  const fs = new WebDavFileSystem({ baseUrl: 'https://example.test/dav/', fetch: async (url, init) => {
    const response = await mock.fetch(url, init);
    if (init.method === 'PROPPATCH') throw new Error('response lost after server commit');
    return response;
  } });
  const result = await expectCode(() => fs.utimes('/file', 1, 2), 'EIO');
  assert.ok(mock.properties.has('/file'));
  const reopened = new WebDavFileSystem({ baseUrl: 'https://example.test/dav/', fetch: mock.fetch });
  assert.equal((await reopened.stat('/file')).mtimeMs, 2);
  assert.deepEqual(mock.base.files.get('/file'), bytes);
  rows.push({ case: 'webdav-response-loss-after-effect', result, propertyMutationPersists: true, bytesPreserved: true });
}

console.log(JSON.stringify({ observations: rows.length, rows }, null, 2));
