import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Shell } from '../../../safe-bash/src/shell/shell.ts';
import { pythonCommands } from '../../../safe-bash/src/commands/python/index.ts';
import { createNodePythonWorker } from '../../../safe-bash/src/commands/python/node.ts';
import { withObjectFileDescriptors } from '../../src/core.ts';
import { createDiskStagingFixture } from './object-staging-native.fixture.mjs';

const [runtimeModuleURL, outputRoot, sizeText, profile] = process.argv.slice(2);
const size = Number(sizeText);
const chunkBytes = 65536;
const root = await mkdtemp(join(outputRoot, 'disk-'));
const backend = createDiskStagingFixture(root, {
  chunkBytes, delayed: profile === 'delayed', spill: process.env.SAFE_FS_STAGING_DISABLED !== '1',
});
const python = `import hashlib
block = bytes(range(256)) * 256
with open('/output', 'wb') as output:
 for index in range(${size / chunkBytes}):
  assert output.write(block) == len(block)
digest = hashlib.sha256()
with open('/output', 'rb') as source:
 while block := source.read(65536):
  digest.update(block)
print(digest.hexdigest())
`;
await backend.fs.writeFile('/main.py', new TextEncoder().encode(python));
const fs = withObjectFileDescriptors(backend.fs, backend.store, {
  chunkBytes, maxStagedBytes: chunkBytes, maxStagedPages: 1, maxFileBytes: size,
});
let retired = 0;
const shell = new Shell({ fs, limits: { maxOutputBytes: size + chunkBytes, maxWallClockMs: 75000, maxCpuMs: 75000 } }).use(pythonCommands({ createWorker() {
  const endpoint = createNodePythonWorker({ trustedPython: true, runtimeModuleURL });
  return { ...endpoint, async terminate() { await endpoint.terminate(); retired++; } };
} }));
try {
  const result = await shell.exec('python /main.py');
  assert.equal(result.exitCode, 0, result.stderr);
  const block = Uint8Array.from({ length: chunkBytes }, (_, index) => index % 256);
  const expected = createHash('sha256');
  for (let offset = 0; offset < size; offset += chunkBytes) expected.update(block);
  const digest = expected.digest('hex');
  assert.equal(result.stdout.trim(), digest);
  const published = backend.files.get('/output');
  assert.equal(published.stat.size, size);
  const actual = createHash('sha256');
  for await (const chunk of createReadStream(published.diskPath, { highWaterMark: chunkBytes })) actual.update(chunk);
  assert.equal(actual.digest('hex'), digest);
  assert.equal(retired, 1);
  assert.equal(backend.events.created, 1);
  assert.equal(backend.events.closed, 1);
  assert.equal(backend.events.publications, 2);
  assert.equal(backend.events.stageWriteBytes, size);
  assert.equal(backend.events.stageReadBytes, size);
  assert.equal(backend.events.publishedBytes, size);
  assert.equal(backend.events.peakWrites, 1);
  assert.equal(backend.events.activeWrites, 0);
  assert.ok(backend.events.largestRead <= chunkBytes);
  assert.ok(backend.events.largestChunk <= chunkBytes);
  assert.equal((await readdir(root)).some(name => name.startsWith('stage-')), false);
  console.log(JSON.stringify({ runtime: 'Node worker / Pyodide', interpreter: true,
    sourceExecutor: true, deployedCloudflare: false, productionHost: false,
    backend: 'disk spill and streamed immutable files; process-local namespace fixture',
    size, maxStagedBytes: chunkBytes, profile, sha256: digest, retired, ...backend.events }));
} finally {
  await shell.dispose();
  await rm(root, { recursive: true, force: true });
  assert.equal(backend.events.released, backend.events.acquired);
  assert.equal(backend.events.closed, backend.events.created);
}
