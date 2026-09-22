import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { createExecutionServer } from '../src/materialization-server.js';
import { createExecutionClient, type NativeInvocation } from '../src/materializations.js';
import { createUploadClient } from '../src/uploads.js';
import type { DependencyManifest } from '../src/protocol.js';

const bytes = (value: string) => Array.from(Buffer.from(value));

// This fixed reader qualifies physical relative-path behavior only. The fixture
// does not install an absolute logical namespace or qualify delegate containment.
const reader = `
const fs = require('node:fs');
const path = require('node:path');
try {
  const list = process.argv[1];
  const directive = fs.readFileSync(list, 'utf8').split('\\n').find(line => line.startsWith("file '"));
  const directory = fs.realpathSync(path.dirname(list));
  const clip = fs.readFileSync(directory + '/' + directive.slice(6, -1));
  if (!fs.readFileSync('shortcut').equals(clip)) throw new Error('Link differs');
  for (const resource of ['filters/look.txt', 'fonts/Test.ttf', 'profiles/input.icc']) fs.readFileSync(resource);
  if (fs.readdirSync('empty').length) throw new Error('Directory is not empty');
  process.stdout.write(clip);
} catch (error) {
  process.stderr.write(error.message);
  process.exitCode = 1;
}
`;

for (const native of [false, true]) test(`API uploads build and inspect an owned physical tree (${native ? 'native relative reader' : 'unsupported namespace'})`, async () => {
  const privateRoot = await fs.realpath(await fs.mkdtemp(`${tmpdir()}/remote-materialization-`));
  const storage = new Map<string, Uint8Array>();
  let launches = 0;
  try {
    const server = createExecutionServer({
      async authenticate() { return { tenantId: 'disk', principalId: 'owner', sessionId: 'session', epoch: 'epoch', expiresAt: Date.now() + 60000, sessionExpiresAt: Date.now() + 60000 }; },
      storage: {
        async append(id, offset, chunk) {
          const prior = storage.get(id) ?? new Uint8Array();
          assert.equal(BigInt(prior.length), offset);
          storage.set(id, Uint8Array.from([...prior, ...chunk]));
        },
        async read(id, offset, count) { return storage.get(id)!.slice(Number(offset), Number(offset) + count); },
        async remove(id) { storage.delete(id); },
      },
      limits: { maxBlobBytes: 10000n, maxReservedBytes: 100000n, maxChunkBytes: 4096, maxConcurrent: 2, maxUploads: 100, maxChunks: 100 },
      materializations: {
        privateRoot, maxDocumentBytes: 100000, maxEntries: 100, maxPathBytes: 4096, maxTreeBytes: 100000n, maxRecords: 100,
        async authorize(_principal, manifest, binding) {
          return binding === 'independent-upload' && manifest.sourceAuthorityId === 'selected' && Buffer.from(manifest.logicalRoot).equals(Buffer.from('/work'));
        },
        ...(native ? { namespace: {
          buildId: 'relative-reader-fixture',
          async execute({ physicalRoot, invocation, signal }: { physicalRoot: string; invocation: NativeInvocation; signal: AbortSignal }) {
            // Test-only, fixed read-only process; never advertise this cwd mapping
            // as the production namespace adapter required by the shared contract.
            assert.deepEqual(invocation.originalArgv, [bytes(process.execPath), bytes('-e'), bytes(reader), bytes('edit/lists/cut.ffconcat')]);
            launches++;
            const child = spawn(process.execPath, ['-e', reader, 'edit/lists/cut.ffconcat'], {
              cwd: physicalRoot + Buffer.from(invocation.cwd).toString().slice('/work'.length), signal,
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            const stdout: Buffer[] = []; const stderr: Buffer[] = [];
            child.stdout.on('data', chunk => stdout.push(chunk));
            child.stderr.on('data', chunk => stderr.push(chunk));
            const exitCode = await new Promise<number>((resolve, reject) => {
              child.once('error', reject);
              child.once('close', code => code === null ? reject(new Error('Reader terminated by signal')) : resolve(code));
            });
            return { exitCode, stdout: Array.from(Buffer.concat(stdout)), stderr: Array.from(Buffer.concat(stderr)) };
          },
        } } : {}),
      },
    });
    const options = { baseUrl: 'https://disk.test', sessionId: 'session', epoch: 'epoch', token: () => 'owned-test', maxChunkBytes: 4096,
      fetch: async (input: string | URL | Request, init?: RequestInit) => server.fetch(new Request(input, init)) };
    const uploads = createUploadClient(options); const client = createExecutionClient(options);
    const manifest: DependencyManifest = { version: 1, sessionId: 'session', epoch: 'epoch', namespaceId: 'tree', revision: 'original', logicalRoot: bytes('/work'), cwd: bytes('/work'), sourceAuthorityId: 'selected', entries: [] };
    const originals = {
      'clips/part one.mp4': 'independent clip bytes',
      'edit/lists/cut.ffconcat': "ffconcat version 1.0\nfile '../../clips/part one.mp4'\ninpoint 0.5\noutpoint 1.5\n",
      'filters/look.txt': 'drawtext=fontfile=fonts/Test.ttf',
      'fonts/Test.ttf': 'independent font bytes',
      'profiles/input.icc': 'independent profile bytes',
    };
    for (const path of ['clips', 'edit', 'edit/lists', 'empty', 'filters', 'fonts', 'profiles']) {
      manifest.entries.push({ kind: 'directory', path: path.split('/').map(bytes), source: { authorityId: 'selected', path: bytes(`/source/${path}`), freshness: 'immutable', snapshotId: 'independent', observedVersion: null, retainedIdentity: null } });
    }
    for (const [path, original] of Object.entries(originals)) {
      const data = Buffer.from(original);
      const upload = await uploads.beginUpload({ size: String(data.length), digest: createHash('sha256').update(data).digest('hex') });
      await uploads.uploadChunk(upload.uploadId, '0', data);
      const blob = await uploads.commitUpload(upload.uploadId);
      manifest.entries.push({ kind: 'file', path: path.split('/').map(bytes), blob: { blobId: blob.blobId, size: blob.size, sha256: blob.digest }, source: { authorityId: 'selected', path: bytes(`/source/${path}`), freshness: 'immutable', snapshotId: 'independent', observedVersion: null, retainedIdentity: null } });
    }
    manifest.entries.push({ kind: 'symlink', path: [bytes('shortcut')], target: bytes('edit/lists/../../clips/part one.mp4'), source: { ...manifest.entries[0].source, path: bytes('/source/shortcut') } });
    manifest.entries.sort((left, right) => Buffer.compare(Buffer.from(left.path.flatMap((part, index) => index ? [47, ...part] : part)), Buffer.from(right.path.flatMap((part, index) => index ? [47, ...part] : part))));
    const saved = await client.putManifest(manifest);
    const result = await client.materialize({ sessionId: 'session', epoch: 'epoch', manifestId: saved.manifestId, manifestRevision: saved.revision, bindingId: 'independent-upload', expectedDirectoryRevision: null, operationKey: 'materialize' });
    assert.equal(result.state, 'ready');
    assert.deepEqual(await client.inspectMaterialization(result.operationId), result);
    assert.deepEqual(await client.listMaterializations(), [result]);
    assert.deepEqual(await client.inspectManifest(saved.manifestId), manifest);
    const names = await fs.readdir(privateRoot); assert.equal(names.length, 1);
    const tree = `${privateRoot}/${names[0]}`;
    for (const [path, original] of Object.entries(originals)) assert.equal(await fs.readFile(`${tree}/${path}`, 'utf8'), original);
    assert.equal(await fs.readFile(`${tree}/edit/lists/../../clips/part one.mp4`, 'utf8'), originals['clips/part one.mp4']);
    assert.equal(await fs.readFile(`${tree}/shortcut`, 'utf8'), originals['clips/part one.mp4']);
    assert.deepEqual(await fs.readdir(`${tree}/empty`), []);
    await assert.rejects(fs.lstat(`${tree}/out`), { code: 'ENOENT' });
    for (const cwd of ['/work', '/work/edit']) {
      const execution = client.execute({ sessionId: 'session', epoch: 'epoch', buildId: native ? 'relative-reader-fixture' : 'unqualified', sourceAuthorityId: 'selected', bindingId: 'independent-upload', materializationId: result.operationId, manifestId: saved.manifestId, manifestRevision: saved.revision, directoryRevision: result.directoryRevision!, cwd: bytes(cwd), originalArgv: [bytes(process.execPath), bytes('-e'), bytes(reader), bytes('edit/lists/cut.ffconcat')] });
      if (!native) await assert.rejects(execution, { status: 422 });
      else {
        const job = await execution;
        assert.equal(job.state, 'exited');
        assert.equal(job.result!.exitCode, cwd === '/work' ? 0 : 1);
        assert.deepEqual(job.result!.stdout, cwd === '/work' ? bytes(originals['clips/part one.mp4']) : []);
        if (cwd !== '/work') assert.ok(Buffer.from(job.result!.stderr).includes(Buffer.from('edit/lists/cut.ffconcat')));
        assert.deepEqual(await client.inspectJob(job.jobId), job);
      }
    }
    assert.deepEqual(await client.inspectMaterialization(result.operationId), result);
    if (native) {
      assert.equal(launches, 2);
      await fs.writeFile(`${tree}/clips/part one.mp4`, 'corrupt');
      const job = await client.execute({ sessionId: 'session', epoch: 'epoch', buildId: 'relative-reader-fixture', sourceAuthorityId: 'selected', bindingId: 'independent-upload', materializationId: result.operationId, manifestId: saved.manifestId, manifestRevision: saved.revision, directoryRevision: result.directoryRevision!, cwd: bytes('/work'), originalArgv: [bytes(process.execPath), bytes('-e'), bytes(reader), bytes('edit/lists/cut.ffconcat')] });
      assert.equal(job.state, 'failed'); assert.equal(job.error, 'integrity');
      assert.equal(launches, 2);
      assert.equal((await client.inspectMaterialization(result.operationId)).failureCategory, 'integrity');
    } else assert.equal(launches, 0);
    const originalBytes = new Map(Object.entries(originals));
    for (const entry of manifest.entries) if (entry.kind === 'file') {
      const original = originalBytes.get(entry.path.map(part => Buffer.from(part).toString()).join('/'));
      assert.equal(await (await uploads.readBlob(entry.blob.blobId)).text(), original);
    }
    await assert.rejects(fs.lstat(`${tree}/out`), { code: 'ENOENT' });
  } finally { await fs.rm(privateRoot, { recursive: true, force: true }); }
});
