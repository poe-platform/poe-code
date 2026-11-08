import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MountFileSystem } from '../../../../safe-fs/src/fs/mount/index.js';
import {
  createS3NamespaceFileSystem, MockS3Client, S3ServiceError,
  type S3NamespaceOptions, type S3ObjectInput, type S3PutInput, type S3RequestOptions,
} from '../../../../safe-fs/src/fs/s3/index.js';

const location = { Bucket: 'review', Key: 'namespace.json' };
const bytes = (text: string) => new TextEncoder().encode(text);

async function fixture(limits: Partial<Pick<S3NamespaceOptions, 'maxBytes' | 'maxEntries' | 'maxManifestBytes' | 'maxAttempts'>> = {}) {
  const gate: { beforePut?: (input: S3PutInput) => void | Promise<void> } = {};
  const client = new MockS3Client({
    buckets: [location.Bucket],
    async authorize(request) {
      if (request.operation !== 'putObject' || !('Body' in request.input)) return;
      const action = gate.beforePut;
      delete gate.beforePut;
      await action?.(request.input);
    },
  });
  const options = { client, bucket: location.Bucket, key: location.Key, ...limits };
  const fs = await createS3NamespaceFileSystem(options);
  return { client, fs, gate, options };
}

test('namespace review: streaming capability and method are both required before transport work', async context => {
  for (const missing of ['capability', 'method']) {
    await context.test(missing, async () => {
      const client = new MockS3Client({ buckets: [location.Bucket] });
      if (missing === 'capability') Object.defineProperty(client, 'capabilities', { value: { conditionalPut: true } });
      else Object.defineProperty(client, 'getObjectStream', { value: undefined });
      await assert.rejects(createS3NamespaceFileSystem({ client, bucket: location.Bucket, key: location.Key }), { code: 'ENOTSUP' });
      assert.equal(client.requests.length, 0);
    });
  }
});

test('namespace review: initialization losing IfNoneMatch adopts the winning namespace', async () => {
  let race = true;
  const client = new MockS3Client({
    buckets: [location.Bucket],
    async authorize(request) {
      if (!race || request.operation !== 'putObject') return;
      race = false;
      assert.ok('IfNoneMatch' in request.input && request.input.IfNoneMatch === '*');
      const winner = await createS3NamespaceFileSystem({ client, bucket: location.Bucket, key: location.Key });
      await winner.writeFile('/winner', bytes('retained'));
    },
  });
  const fs = await createS3NamespaceFileSystem({ client, bucket: location.Bucket, key: location.Key });
  assert.equal(race, false);
  assert.deepEqual(await fs.readFile('/winner'), bytes('retained'));
  await fs.writeFile('/loser', bytes('adopted'));
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name).sort(), ['loser', 'winner']);
});

test('namespace review: rmdir rechecks emptiness after a conditional PUT loses to child creation', async () => {
  const { fs, client, gate, options } = await fixture();
  const peer = await createS3NamespaceFileSystem(options);
  await fs.mkdir('/temporary');
  const start = client.requests.length;
  gate.beforePut = async input => {
    assert.ok(input.IfMatch);
    await peer.writeFile('/temporary/new', bytes('keep'));
  };
  await assert.rejects(fs.rmdir!('/temporary'), { code: 'ENOTEMPTY' });
  assert.equal(client.requests.slice(start).filter(request => request.operation === 'putObject').length, 2);
  assert.deepEqual(await fs.readFile('/temporary/new'), bytes('keep'));
});

test('namespace review: conditional tree removal rechecks target identity after a lost PUT', async () => {
  const { fs, gate, options } = await fixture();
  const peer = await createS3NamespaceFileSystem(options);
  await fs.mkdir('/temporary');
  await fs.writeFile('/temporary/old', bytes('old'));
  const expected = await fs.stat('/temporary');
  const parent = await fs.stat('/');
  gate.beforePut = async () => {
    await peer.rename('/temporary', '/moved');
    await peer.mkdir('/temporary');
    await peer.writeFile('/temporary/new', bytes('keep'));
  };
  await assert.rejects(fs.removeTreeConditional!('/temporary', { expected, parent }), { code: 'EAGAIN' });
  assert.deepEqual(await fs.readFile('/temporary/new'), bytes('keep'));
  assert.deepEqual(await fs.readFile('/moved/old'), bytes('old'));
});

test('namespace review: cleanup rejects a replaced parent even when the target inode survives', async () => {
  const { fs, gate, options } = await fixture();
  const peer = await createS3NamespaceFileSystem(options);
  await fs.mkdir('/parent/temporary', { recursive: true });
  await fs.writeFile('/parent/temporary/keep', bytes('keep'));
  const expected = await fs.stat('/parent/temporary');
  const parent = await fs.stat('/parent');
  gate.beforePut = async () => {
    await peer.rename('/parent', '/old-parent');
    await peer.mkdir('/parent');
    await peer.rename('/old-parent/temporary', '/parent/temporary');
  };
  await assert.rejects(fs.removeTreeConditional!('/parent/temporary', { expected, parent }), { code: 'EAGAIN' });
  assert.equal((await fs.stat('/parent/temporary')).ino, expected.ino);
  assert.notEqual((await fs.stat('/parent')).ino, parent.ino);
  assert.deepEqual(await fs.readFile('/parent/temporary/keep'), bytes('keep'));
});

test('namespace review: cleanup retries against current contents of the same directory', async () => {
  const { fs, gate, options } = await fixture();
  const peer = await createS3NamespaceFileSystem(options);
  await fs.mkdir('/temporary');
  const expected = await fs.stat('/temporary');
  const parent = await fs.stat('/');
  gate.beforePut = async () => {
    await peer.writeFile('/temporary/new', bytes('owned'));
    await peer.writeFile('/sibling', bytes('keep'));
  };
  await fs.removeTreeConditional!('/temporary', { expected, parent });
  await assert.rejects(fs.stat('/temporary'), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile('/sibling'), bytes('keep'));
});

test('namespace review: conditional conflict retries are bounded for both conflict statuses', async context => {
  for (const status of [409, 412]) {
    await context.test(String(status), async () => {
      const { fs, client, gate } = await fixture({ maxAttempts: 3 });
      await fs.writeFile('/keep', bytes('keep'));
      let attempts = 0;
      const reject = (input: S3PutInput) => {
        assert.ok(input.IfMatch);
        attempts++;
        gate.beforePut = reject;
        throw new S3ServiceError('Conflict', status);
      };
      gate.beforePut = reject;
      await assert.rejects(fs.unlink!('/keep'), { code: 'EAGAIN' });
      delete gate.beforePut;
      assert.equal(attempts, 3);
      assert.deepEqual(await fs.readFile('/keep'), bytes('keep'));
      assert.ok(client.requests.every(request => request.operation !== 'deleteObject'));
    });
  }
});

test('namespace review: conditional entry removal rejects a stale revision of the same inode', async () => {
  const { fs, client } = await fixture();
  await fs.writeFile('/file', bytes('old'));
  const expected = await fs.stat('/file');
  const parent = await fs.stat('/');
  await fs.writeFile('/file', bytes('keep'));
  const current = await fs.stat('/file');
  assert.equal(current.ino, expected.ino);
  assert.notEqual(current.revision, expected.revision);
  const start = client.requests.length;
  const outcome = await fs.removeEntryConditional!('/file', { expected, parent }).then(() => 'fulfilled', error => error.code);
  const remaining = await fs.readFile('/file').then(data => Array.from(data), error => error.code);
  assert.deepEqual({
    outcome, remaining, puts: client.requests.slice(start).filter(request => request.operation === 'putObject').length,
  }, { outcome: 'EAGAIN', remaining: Array.from(bytes('keep')), puts: 0 });
});

test('namespace review: tree removal refuses terminal dot without deleting the resolved directory', async () => {
  const { fs, client } = await fixture();
  await fs.mkdir('/temporary');
  await fs.writeFile('/temporary/keep', bytes('keep'));
  const expected = await fs.stat('/temporary');
  const parent = await fs.stat('/');
  const start = client.requests.length;
  const outcome = await fs.removeTreeConditional!('/temporary/.', { expected, parent }).then(() => 'fulfilled', () => 'rejected');
  const remaining = await fs.readFile('/temporary/keep').then(data => Array.from(data), error => error.code);
  assert.deepEqual({
    outcome, remaining, puts: client.requests.slice(start).filter(request => request.operation === 'putObject').length,
  }, { outcome: 'rejected', remaining: Array.from(bytes('keep')), puts: 0 });
});

test('namespace review: unknown cleanup identity is ENOTSUP, not a stale known identity', async () => {
  const { fs } = await fixture();
  await fs.mkdir('/temporary');
  const { identityScope: omitted, ...expected } = await fs.stat('/temporary');
  assert.ok(omitted);
  const parent = await fs.stat('/');
  await assert.rejects(fs.removeTreeConditional!('/temporary', { expected, parent }), { code: 'ENOTSUP' });
  assert.equal((await fs.stat('/temporary')).type, 'directory');
});

test('namespace review: root cleanup is refused even with matching observations', async () => {
  const { fs, client } = await fixture();
  await fs.writeFile('/keep', bytes('keep'));
  const expected = await fs.stat('/');
  const start = client.requests.length;
  await assert.rejects(fs.removeTreeConditional!('/', { expected, parent: expected }), { code: 'EBUSY' });
  assert.equal(client.requests.slice(start).filter(request => request.operation === 'putObject').length, 0);
  assert.deepEqual(await fs.readFile('/keep'), bytes('keep'));
});

test('namespace review: immutable descriptors retain old bytes and reject a competing same-inode publication', async () => {
  const { fs } = await fixture();
  await fs.writeFile('/file', bytes('old'));
  const first = await fs.open!('/file', { access: 'readwrite' });
  const second = await fs.open!('/file', { access: 'readwrite' });
  const before = await second.stat();
  await first.write(bytes('new'), 0);
  await first.sync(false);
  const buffer = new Uint8Array(3);
  assert.equal(await second.read(buffer, 0), 3);
  assert.deepEqual(buffer, bytes('old'));
  assert.equal((await second.stat()).ino, before.ino);
  await second.write(bytes('bad'), 0);
  await assert.rejects(second.sync(false), { code: 'EAGAIN' });
  await assert.rejects(second.close(), { code: 'EAGAIN' });
  await first.close();
  assert.deepEqual(await fs.readFile('/file'), bytes('new'));
});

test('namespace review: an open version survives tree cleanup without following a replacement path', async () => {
  const { fs } = await fixture();
  await fs.mkdir('/temporary');
  await fs.writeFile('/temporary/file', bytes('old'));
  const descriptor = await fs.open!('/temporary/file', { access: 'read' });
  const original = await descriptor.stat();
  await fs.removeTreeConditional!('/temporary', { expected: await fs.stat('/temporary'), parent: await fs.stat('/') });
  await fs.mkdir('/temporary');
  await fs.writeFile('/temporary/file', bytes('new'));
  const buffer = new Uint8Array(3);
  assert.equal(await descriptor.read(buffer, 0), 3);
  assert.deepEqual(buffer, bytes('old'));
  assert.equal((await descriptor.stat()).ino, original.ino);
  assert.notEqual((await fs.stat('/temporary/file')).ino, original.ino);
  await descriptor.close();
});

test('namespace review: descriptor publication rechecks its revision after a conditional race', async () => {
  const { fs, gate, options } = await fixture();
  const peer = await createS3NamespaceFileSystem(options);
  await fs.writeFile('/file', bytes('old'));
  const descriptor = await fs.open!('/file', { access: 'readwrite' });
  await descriptor.write(bytes('bad'), 0);
  gate.beforePut = () => peer.writeFile('/file', bytes('keep'));
  await assert.rejects(descriptor.sync(false), { code: 'EAGAIN' });
  await assert.rejects(descriptor.close(), { code: 'EAGAIN' });
  assert.deepEqual(await fs.readFile('/file'), bytes('keep'));
});

test('namespace review: precommit abort preserves errno-shaped reason and never retries removal', async () => {
  const { fs, client, gate } = await fixture();
  await fs.mkdir('/temporary');
  await fs.writeFile('/temporary/keep', bytes('keep'));
  const expected = await fs.stat('/temporary');
  const parent = await fs.stat('/');
  const controller = new AbortController();
  const reason = { code: 'ENOENT', $metadata: { httpStatusCode: 412 } };
  const start = client.requests.length;
  gate.beforePut = () => controller.abort(reason);
  await assert.rejects(fs.removeTreeConditional!('/temporary', { expected, parent, signal: controller.signal }), error => error === reason);
  assert.equal(client.requests.slice(start).filter(request => request.operation === 'putObject').length, 1);
  assert.deepEqual(await fs.readFile('/temporary/keep'), bytes('keep'));
});

test('namespace review: cancellation during manifest streaming closes the producer and preserves a falsey reason', async context => {
  const { fs, client } = await fixture();
  const response = await client.getObjectStream(location);
  const original = (await client.getObject(location)).Body;
  assert.ok(original instanceof Uint8Array);
  const controller = new AbortController();
  let closed = false;
  context.mock.method(client, 'getObjectStream', async (_input: S3ObjectInput, forwarded?: S3RequestOptions) => {
    assert.equal(forwarded?.abortSignal, controller.signal);
    return { ...response, Body: (async function* () {
      try {
        yield original.slice(0, 8);
        controller.abort(false);
        yield original.slice(8);
      } finally { closed = true; }
    })() };
  });
  const start = client.requests.length;
  await assert.rejects(fs.mkdir('/cancelled', { signal: controller.signal }), error => error === false);
  assert.equal(closed, true);
  assert.equal(client.requests.length, start);
});

test('namespace review: overwrite, append and copy account for the whole namespace without partial commits', async () => {
  const { fs } = await fixture({ maxBytes: 5 });
  await fs.writeFile('/first', bytes('abcd'));
  await fs.writeFile('/second', bytes('e'));
  await fs.writeFile('/first', bytes('a'));
  await fs.appendFile('/second', bytes('bcd'));
  await assert.rejects(fs.copyFile('/second', '/copy'), { code: 'ENOSPC' });
  await assert.rejects(fs.appendFile('/first', bytes('overflow')), { code: 'ENOSPC' });
  assert.deepEqual(await fs.readFile('/first'), bytes('a'));
  assert.deepEqual(await fs.readFile('/second'), bytes('ebcd'));
  await assert.rejects(fs.stat('/copy'), { code: 'ENOENT' });
  await fs.unlink!('/second');
  await fs.copyFile('/first', '/copy');
  assert.deepEqual(await fs.readFile('/copy'), bytes('a'));
});

test('namespace review: recursive mkdir exceeding the entry budget commits no partial ancestors', async () => {
  const { fs, client } = await fixture({ maxEntries: 3 });
  await fs.mkdir('/keep');
  const start = client.requests.length;
  await assert.rejects(fs.mkdir('/new/child', { recursive: true }), { code: 'ENOSPC' });
  assert.equal(client.requests.slice(start).filter(request => request.operation === 'putObject').length, 0);
  await assert.rejects(fs.stat('/new'), { code: 'ENOENT' });
  await fs.mkdir('/last');
  assert.equal((await fs.stat('/last')).ino, 3);
});

test('namespace review: malformed and over-budget persisted schemas fail before mutation', async context => {
  const root = { ino: 1, revision: 1, type: 'directory', mode: 0o755, time: 1, bytes: [] };
  const file = { ino: 2, revision: 1, type: 'file', mode: 0o644, time: 1, bytes: [1] };
  const valid = { version: 1, identity: 'schema-review', nextInode: 3, nodes: { '/': root, '/file': file } };
  const cases = [
    { name: 'duplicate inode', nodes: { '/': root, '/file': { ...file, ino: 1 } }, code: 'EIO' },
    { name: 'missing parent', nodes: { '/': root, '/absent/file': file }, code: 'EIO' },
    { name: 'directory payload', nodes: { '/': { ...root, bytes: [0] } }, code: 'EIO' },
    { name: 'noncanonical path', nodes: { '/': root, '/a/../file': file }, code: 'EIO' },
    { name: 'fractional byte', nodes: { '/': root, '/file': { ...file, bytes: [0.5] } }, code: 'EIO' },
    { name: 'out-of-range byte', nodes: { '/': root, '/file': { ...file, bytes: [256] } }, code: 'EIO' },
    { name: 'invalid revision', nodes: { '/': root, '/file': { ...file, revision: 0 } }, code: 'EIO' },
    { name: 'unallocated inode', nodes: { '/': root, '/file': { ...file, ino: 3 } }, code: 'EIO' },
    { name: 'total byte limit', nodes: { '/': root, '/file': { ...file, bytes: [0, 1, 2] } }, code: 'ENOSPC' },
    { name: 'entry limit', nodes: valid.nodes, code: 'ENOSPC', maxEntries: 1 },
  ];
  for (const entry of cases) {
    await context.test(entry.name, async () => {
      const client = new MockS3Client({ buckets: [location.Bucket] });
      const body = bytes(JSON.stringify({ ...valid, nodes: entry.nodes }));
      await client.putObject({ ...location, Body: body });
      const start = client.requests.length;
      await assert.rejects(createS3NamespaceFileSystem({ client, bucket: location.Bucket, key: location.Key, maxBytes: 2, maxEntries: entry.maxEntries ?? 3 }), { code: entry.code });
      assert.equal(client.requests.slice(start).filter(request => request.operation === 'putObject').length, 0);
      assert.deepEqual((await client.getObject(location)).Body, body);
    });
  }
});

test('namespace review: oversized manifest streams stop before parsing or pulling further chunks', async context => {
  const { fs, client } = await fixture({ maxManifestBytes: 2048 });
  const response = await client.getObjectStream(location);
  let pulls = 0;
  let closed = false;
  context.mock.method(client, 'getObjectStream', async () => ({ ...response, ContentLength: 1, Body: (async function* () {
    try {
      pulls++;
      yield new Uint8Array(2049);
      pulls++;
      yield bytes('must not be read');
    } finally { closed = true; }
  })() }));
  const parse = context.mock.method(JSON, 'parse');
  await assert.rejects(fs.stat('/'), { code: 'EFBIG' });
  assert.equal(pulls, 1);
  assert.equal(closed, true);
  assert.equal(parse.mock.callCount(), 0);
});

test('namespace review: a missing manifest is not silently reinitialized by an existing handle', async () => {
  const { fs, client } = await fixture();
  await fs.mkdir('/temporary');
  const expected = await fs.stat('/temporary');
  const parent = await fs.stat('/');
  await client.deleteObject(location);
  const start = client.requests.length;
  await assert.rejects(fs.removeTreeConditional!('/temporary', { expected, parent }), { code: 'EIO' });
  await assert.rejects(fs.mkdir('/resurrected'), { code: 'EIO' });
  assert.ok(client.requests.slice(start).every(request => request.operation === 'getObject'));
});

test('namespace review: replaced manifest identity after a lost commit invalidates stale root observations', async () => {
  const { fs, client, gate, options } = await fixture();
  await fs.mkdir('/temporary');
  await fs.writeFile('/temporary/keep', bytes('keep'));
  const expected = await fs.stat('/temporary');
  const parent = await fs.stat('/');
  const saved = (await client.getObject(location)).Body;
  assert.ok(saved instanceof Uint8Array);
  const replacement = bytes(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(saved)), identity: 'replacement-review' }));
  gate.beforePut = async () => { await client.putObject({ ...location, Body: replacement }); };
  await assert.rejects(fs.removeTreeConditional!('/temporary', { expected, parent }), { code: 'EIO' });
  assert.deepEqual((await client.getObject(location)).Body, replacement);
  await assert.rejects(fs.stat('/'), { code: 'EIO' });
  const fresh = await createS3NamespaceFileSystem(options);
  assert.deepEqual(await fresh.readFile('/temporary/keep'), bytes('keep'));
});

for (const operation of ['stat', 'readFile', 'open'] as const) {
  test(`namespace review: ${operation} requires a directory for a trailing slash`, async () => {
    const { fs, client } = await fixture();
    await fs.writeFile('/file', bytes('keep'));
    const start = client.requests.length;
    const outcome = await (operation === 'open'
      ? fs.open!('/file/', { access: 'read' }).then(async descriptor => { await descriptor.close(); })
      : fs[operation]('/file/')).then(() => 'fulfilled', error => error.code);
    assert.deepEqual({
      outcome, puts: client.requests.slice(start).filter(request => request.operation === 'putObject').length,
    }, { outcome: 'ENOTDIR', puts: 0 });
    assert.deepEqual(await fs.readFile('/file'), bytes('keep'));
  });
}

for (const operation of ['writeFile', 'appendFile', 'unlink', 'rm', 'removeEntryConditional', 'rename-source', 'rename-destination', 'copy-source', 'copy-destination'] as const) {
  test(`namespace review: ${operation} cannot mutate a regular file through a trailing slash`, async () => {
    const { fs, client } = await fixture();
    await fs.writeFile('/file', bytes('keep'));
    await fs.writeFile('/other', bytes('source'));
    const expected = await fs.stat('/file');
    const parent = await fs.stat('/');
    const saved = (await client.getObject(location)).Body;
    assert.ok(saved instanceof Uint8Array);
    const start = client.requests.length;
    const actions = {
      writeFile: () => fs.writeFile('/file/', bytes('bad')),
      appendFile: () => fs.appendFile('/file/', bytes('bad')),
      unlink: () => fs.unlink!('/file/'),
      rm: () => fs.rm('/file/', { recursive: true, force: true }),
      removeEntryConditional: () => fs.removeEntryConditional!('/file/', { expected, parent }),
      'rename-source': () => fs.rename('/file/', '/other'),
      'rename-destination': () => fs.rename('/other', '/file/'),
      'copy-source': () => fs.copyFile('/file/', '/other'),
      'copy-destination': () => fs.copyFile('/other', '/file/'),
    };
    const outcome = await actions[operation]().then(() => 'fulfilled', error => error.code);
    const current = (await client.getObject(location)).Body;
    assert.ok(current instanceof Uint8Array);
    assert.deepEqual({
      outcome, unchanged: Buffer.from(current).equals(saved),
      puts: client.requests.slice(start).filter(request => request.operation === 'putObject').length,
    }, { outcome: 'ENOTDIR', unchanged: true, puts: 0 });
  });
}

for (const operation of ['writeFile', 'appendFile', 'open', 'copyFile'] as const) {
  test(`namespace review: ${operation} cannot create a regular file at a missing trailing-slash path`, async () => {
    const { fs, client } = await fixture();
    await fs.writeFile('/source', bytes('keep'));
    const saved = (await client.getObject(location)).Body;
    assert.ok(saved instanceof Uint8Array);
    const start = client.requests.length;
    const actions = {
      writeFile: () => fs.writeFile('/missing/', bytes('bad')),
      appendFile: () => fs.appendFile('/missing/', bytes('bad')),
      open: async () => {
        const descriptor = await fs.open!('/missing/', { access: 'write', creation: 'exclusive' });
        await descriptor.close();
      },
      copyFile: () => fs.copyFile('/source', '/missing/'),
    };
    const rejected = await actions[operation]().then(() => false, () => true);
    const current = (await client.getObject(location)).Body;
    assert.ok(current instanceof Uint8Array);
    assert.deepEqual({
      rejected, unchanged: Buffer.from(current).equals(saved),
      puts: client.requests.slice(start).filter(request => request.operation === 'putObject').length,
    }, { rejected: true, unchanged: true, puts: 0 });
  });
}

test('namespace review: directory trailing slashes remain valid for rename and conditional cleanup', async () => {
  const { fs } = await fixture();
  await fs.mkdir('/temporary/');
  await fs.writeFile('/temporary/keep', bytes('owned'));
  const expected = await fs.stat('/temporary/');
  await fs.rename('/temporary/', '/renamed/');
  assert.equal((await fs.stat('/renamed/')).ino, expected.ino);
  await fs.removeTreeConditional!('/renamed/', { expected, parent: await fs.stat('/') });
  await assert.rejects(fs.stat('/renamed'), { code: 'ENOENT' });
});

for (const prefix of ['file', 'missing'] as const) {
  test(`namespace review: ${prefix} prefix must be traversable before dot-dot reduction`, async () => {
    const { fs, client } = await fixture();
    await fs.writeFile('/file', bytes('not a directory'));
    await fs.writeFile('/victim', bytes('keep'));
    const saved = (await client.getObject(location)).Body;
    assert.ok(saved instanceof Uint8Array);
    const start = client.requests.length;
    const outcome = await fs.unlink!(`/${prefix}/../victim`).then(() => 'fulfilled', error => error.code);
    const current = (await client.getObject(location)).Body;
    assert.ok(current instanceof Uint8Array);
    assert.deepEqual({
      outcome, unchanged: Buffer.from(current).equals(saved),
      puts: client.requests.slice(start).filter(request => request.operation === 'putObject').length,
    }, { outcome: prefix === 'file' ? 'ENOTDIR' : 'ENOENT', unchanged: true, puts: 0 });
  });
}

test('namespace review: complete identities must not classify two views of the same manifest entry as distinct', async () => {
  const { fs, options } = await fixture();
  await fs.writeFile('/file', bytes('shared'));
  const peer = await createS3NamespaceFileSystem(options);
  const view = new MountFileSystem({ root: fs });
  assert.deepEqual(await peer.readFile('/file'), bytes('shared'));
  assert.notEqual(await view.compareEntry('/file', peer, '/file'), 'distinct');
});
