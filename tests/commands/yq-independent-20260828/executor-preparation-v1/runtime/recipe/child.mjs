import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { authorize } from './authorization.mjs';
import { createFixtureContext, encodeRejection } from './context.mjs';

const [authorizationPath, authorizationSha256, sealPath, sealSha256, jobId] = process.argv.slice(2);
const binding = authorize({ authorizationPath, authorizationSha256, sealPath, sealSha256 });
const job = binding.jobs.find((entry) => entry.id === jobId);
assert(job, 'Child job not authorized');
const fixture = createFixtureContext(job);
register('./import-fence.mjs', { parentURL: import.meta.url, data: { compiledRoot: binding.authorization.compiled.root } });
globalThis.fetch = async () => { throw new Error('Network not admitted by this command-context recipe'); };
let status = null;
let rejected = false;
let rejection = null;
try {
  const module = await import(pathToFileURL(binding.entryPath).href);
  assert.equal(typeof module.createYqCommand, 'function');
  const definition = module.createYqCommand();
  assert.equal(definition.name, 'yq');
  assert.equal(typeof definition.execute, 'function');
  fixture.event('command-call');
  const result = await definition.execute(fixture.context);
  status = result?.exitCode ?? null;
  fixture.event('command-return', { status });
} catch (error) {
  rejected = true;
  rejection = encodeRejection(error);
  fixture.event('command-reject', { rejection });
}
const cleanupErrors = await fixture.drain();
const receipt = {
  schemaVersion: 1, jobId, outcome: 'CAPTURED',
  proofRole: binding.authorization.compiled.entry.proofRole,
  binding: { authorizationSha256, sealSha256, candidateCommit: binding.authorization.candidateCommit, sourceTreeSha256: binding.authorization.source.treeSha256, compiledEntrySha256: binding.authorization.compiled.entry.sha256, jobsSha256: binding.authorization.selection.jobsSha256 },
  capture: { ...fixture.capture(), status, rejected, rejection, cleanupErrors },
};
await new Promise((resolve, reject) => process.stdout.write(`${JSON.stringify(receipt)}\n`, (error) => error ? reject(error) : resolve()));
