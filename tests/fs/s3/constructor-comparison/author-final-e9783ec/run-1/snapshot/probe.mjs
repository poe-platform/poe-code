import assert from 'node:assert/strict';
import { S3FileSystem, MockS3Client } from './src/fs/s3/index.ts';
import { WebDavFileSystem } from './src/fs/webdav/index.ts';
import { MockDav } from './tests/fs/webdav/mock.ts';
import { createMountFileSystem } from './src/fs/mount/index.ts';
import { MemoryFileSystem } from './src/fs/memory/index.ts';
import { FsError } from './src/contracts/errors.ts';
const payload = new Uint8Array([1, 2]);
const previous = new Uint8Array([9]);
let count = 0;
for (const kind of ['s3', 'webdav']) for (const phase of ['constructor', 'late']) {
  for (const scenario of ['same-distinct', 'distinct-alias', 'unknown-distinct', 'denied-alias', 'cancel-alias']) {
    const controller = new AbortController();
    const reason = new FsError('ENOENT', { message: 'controlled abort reason' });
    let calls = 0;
    let replacedCalls = 0;
    let filesystem;
    const callback = async function(ownPath, peer, peerPath, options) {
      calls++;
      assert.equal(this, filesystem);
      assert.equal(peer, filesystem);
      assert.equal(ownPath, '/source');
      assert.equal(peerPath, scenario.endsWith('alias') ? '/source' : '/target');
      assert.equal(options.signal, controller.signal);
      if (scenario === 'denied-alias') throw new FsError('EACCES');
      if (scenario === 'cancel-alias') { controller.abort(reason); return 'same'; }
      return scenario.startsWith('same') ? 'same' : scenario.startsWith('distinct') ? 'distinct' : 'unknown';
    };
    const selected = phase === 'constructor' ? callback : async () => { replacedCalls++; return 'distinct'; };
    let operations;
    if (kind === 's3') {
      const service = new MockS3Client({ buckets: ['bucket'] });
      await service.putObject({ Bucket: 'bucket', Key: 'source', Body: payload });
      await service.putObject({ Bucket: 'bucket', Key: 'target', Body: previous });
      filesystem = new S3FileSystem({ bucket: 'bucket', transport: service, compareEntry: selected });
      operations = () => service.requests.map(request => request.operation);
    } else {
      const service = new MockDav();
      service.files.set('/source', payload);
      service.files.set('/target', previous);
      filesystem = new WebDavFileSystem({ baseUrl: 'https://callback.invalid/dav/', fetch: service.createFetch(), compareEntry: selected });
      operations = () => service.requests.map(request => request.init.method);
    }
    if (phase === 'late') filesystem.compareEntry = callback;
    const mounted = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { '/remote': filesystem } });
    const start = operations().length;
    const target = scenario.endsWith('alias') ? '/remote/source' : '/remote/target';
    const result = await mounted.compareEntry('/remote/source', mounted, target, { signal: controller.signal })
      .then(relation => ({ relation }), error => ({ code: error.code, error }));
    assert.equal(calls, 1);
    assert.equal(replacedCalls, 0);
    if (scenario === 'same-distinct') assert.equal(result.relation, 'same');
    else if (scenario === 'unknown-distinct') assert.equal(result.relation, 'unknown');
    else assert.equal(result.code, scenario === 'distinct-alias' ? 'EIO' : scenario === 'denied-alias' ? 'EACCES' : 'ENOENT');
    if (scenario === 'cancel-alias') assert.equal(result.error, reason);
    const trace = operations().slice(start);
    assert.ok(trace.every(operation => ['headObject', 'listObjectsV2', 'PROPFIND'].includes(operation)));
    assert.deepEqual(await filesystem.readFile('/source'), payload);
    assert.deepEqual(await filesystem.readFile('/target'), previous);
    assert.deepEqual(await filesystem.readdir('/'), [{ name: 'source', type: 'file' }, { name: 'target', type: 'file' }]);
    console.log(JSON.stringify({ kind, phase, scenario, relation: result.relation, code: result.code, calls, replacedCalls, trace, source: [...payload], target: [...previous] }));
    count++;
  }
}
console.log(JSON.stringify({ verified: count, failed: 0, classification: 'narrow author dispatch controls; not independent acceptance' }));
