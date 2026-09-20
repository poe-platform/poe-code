import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as hostFilesystem from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { admitObjectIoArtifacts, runHostedObjectIoQualification } from './object-io-hosted.mjs';
import { createCloudflareQualificationApi } from './object-io-cloudflare-api.mjs';
import { qualifyHostedObjectIoMatrix } from './object-io-hosted-matrix.mjs';
import { admitHostedObjectIoCleanup } from './object-io-hosted-protocol.mjs';

export async function executeHostedObjectIoQualification({
  artifactDirectory, receiptPath, sourceRevision, runId, accountId, apiToken,
  filesystem = hostFilesystem, fetch = globalThis.fetch,
}) {
  assert.ok(accountId && apiToken, 'Hosted Cloudflare credentials required');
  const directory = resolve(artifactDirectory);
  const directoryStat = await filesystem.lstat(directory);
  assert.ok(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), 'Artifact directory must not be a symlink');
  const manifestPath = resolve(directory, 'qualification.json');
  const manifestStat = await filesystem.lstat(manifestPath);
  assert.ok(manifestStat.isFile() && !manifestStat.isSymbolicLink() && manifestStat.size <= 1048576,
    'Local qualification manifest must be a bounded regular file');
  const manifest = JSON.parse(await filesystem.readFile(manifestPath, 'utf8'));
  assert.equal(manifest.localCases, 16, 'Complete sixteen-case local qualification required');
  assert.equal(manifest.artifact, 'installed-public-runtime-packages-with-candidate-measurement-fixture',
    'Standalone published-runtime local qualification required');
  assert.equal(manifest.productionHost, false, 'Fresh qualification artifact required');
  assert.equal(manifest.deployedCloudflare, false, 'Undeployed local qualification artifact required');
  assert.equal(manifest.protocol?.size, 9437184, 'Pinned nine-MiB qualification required');
  assert.equal(manifest.protocol.expectedSequentialSha256,
    'b8b5dabaa3454f7fa46a97c51cec9ccd118ffc0d61df6e46d845ef200a2fd1bb');
  assert.equal(manifest.protocol.expectedPositionedSha256,
    'ee98d04569d114da547c22488141b6efe21d77c13a128c2062728dc7e2c3c59f');
  const artifact = await admitObjectIoArtifacts({ manifest, async readArtifact(name) {
    const path = resolve(directory, name);
    const stat = await filesystem.lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16 * 1024 * 1024,
      'Qualification modules must be bounded regular files');
    return filesystem.readFile(path);
  } });
  const nonce = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('hex');
  const api = createCloudflareQualificationApi({ token: apiToken, fetch });
  await filesystem.mkdir(dirname(resolve(receiptPath)), { recursive: true });
  const requestFor = ({ url, token: bearer }) => async pathname => fetch(url + pathname, {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Length': '0' },
    redirect: 'error', signal: AbortSignal.timeout(600000),
  });
  let receipt;
  try {
    receipt = await runHostedObjectIoQualification({ accountId, nonce, token, runId, sourceRevision,
      artifact, api,
      qualify: async endpoint => qualifyHostedObjectIoMatrix({ request: requestFor(endpoint),
        protocol: { ...manifest.protocol, owner: nonce } }),
      clean: async endpoint => {
        const response = await requestFor(endpoint)('/cleanup');
        assert.equal(response.status, 200, 'Hosted scratch cleanup endpoint must succeed');
        return admitHostedObjectIoCleanup(await response.json(), nonce);
      },
    });
  } catch (error) {
    try {
      await filesystem.writeFile(receiptPath, JSON.stringify({ sourceRevision,
        workerName: `poe-code-io-${runId}-${nonce.slice(0, 12)}`, passed: false,
        cleanupComplete: error.cleanupComplete ?? null, failure: 'Hosted qualification did not pass',
        recordedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
    } catch (receiptError) {
      throw new AggregateError([error, receiptError], 'Hosted qualification and receipt persistence failed');
    }
    throw error;
  }
  const result = { ...receipt, artifactHashes: manifest.artifacts, localCases: manifest.localCases,
    recordedAt: new Date().toISOString() };
  await filesystem.writeFile(receiptPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    artifacts: { type: 'string' }, receipt: { type: 'string' },
    'source-revision': { type: 'string' }, 'run-id': { type: 'string' },
  } });
  try {
    assert.ok(values.artifacts && values.receipt && values['source-revision'] && values['run-id'],
      'Required: --artifacts --receipt --source-revision --run-id');
    const result = await executeHostedObjectIoQualification({ artifactDirectory: values.artifacts,
      receiptPath: values.receipt, sourceRevision: values['source-revision'], runId: values['run-id'],
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID, apiToken: process.env.CLOUDFLARE_API_TOKEN });
    console.log(JSON.stringify({ sourceRevision: result.sourceRevision,
      cases: result.qualification.rows.length, cleanupComplete: result.cleanupComplete }));
  } catch (error) {
    console.error(error instanceof AggregateError
      ? error.errors.map(failure => failure.message).join('; ') : error.message);
    process.exitCode = 1;
  }
}
