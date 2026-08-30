import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { admitSource, bind } from './binding.mjs';

const [rootPath, rootHash, sealPath, sealHash, mode, jobId, destination, typeEvidence] = process.argv.slice(2);
const bound = await bind(rootPath, rootHash, sealPath, sealHash);
assert(['source-admission', 'moved-runtime', 'loaded-code', 'types'].includes(mode));
let movement = null;
let capture = null;
let body = {};
let failure = null;
try {
  const authority = admitSource(bound, mode === 'source-admission');
  if (mode === 'source-admission') {
    assert.equal(jobId, 'source-admission');
    body = { sourceMapSha256: authority.sourceMapSha256, packageMapSha256: bound.packageMapSha256, sourceFiles: Object.keys(authority.sourceFiles).length, packageFiles: Object.keys(authority.expected.files).length, publicStatus: 'PUBLIC_EXPORT_GAP', proofRole: 'SOURCE_PACKAGE_IDENTITY_NOT_BUILD_REPRODUCTION' };
  } else {
    assert(destination && !existsSync(destination));
    assert(bound.guards.within(bound.root.outputParent, destination) && destination !== bound.root.outputParent, 'Destination outside explicit output parent');
    bound.guards.regularRoot(dirname(destination));
    const binding = bound.guards.materializeCandidate(authority, bound.root.packageRoot, destination);
    movement = binding;
    if (mode === 'types') {
      assert.equal(jobId, 'types');
      assert(typeEvidence && bound.guards.within(bound.root.outputParent, typeEvidence), 'Type evidence outside explicit output parent');
      const facts = bound.types.runDeclarationConsumers(binding, typeEvidence, 'direct');
      body = { facts, typeEvidence, proofRole: 'DIRECT_MATERIALIZED_DECLARATIONS_NOT_PUBLIC_PACKAGE' };
    } else if (mode === 'loaded-code') {
      assert.equal(jobId, 'loaded-code');
      const loaded = await bound.guards.withMaterializedImports(binding, ['yq', 'contracts'], async (namespaces) => {
        const factories = ['createYqCommand', 'createYqCommands', 'yqCommands'];
        for (const name of factories) assert.equal(typeof namespaces.yq[name], 'function');
        let publicStatus;
        try { bound.guards.assertPublicAdmission(); } catch (error) { publicStatus = error.code; }
        assert.equal(publicStatus, 'PUBLIC_EXPORT_GAP');
        return { factories, contractExportNames: Object.keys(namespaces.contracts), publicStatus };
      });
      body = { ...loaded.value, imported: loaded.imported, proofRole: loaded.proofRole };
    } else {
      const data = bound.runtime.fixtures.loadData(bound.runtimeRoot, bound.guards.workspaceRoot);
      const jobs = bound.runtime.fixtures.materializeJobs(data, bound.recipe.preparedIds);
      const job = jobs.find((entry) => entry.id === jobId);
      assert(job, 'Unbound runtime job');
      const fixture = bound.runtime.context.createFixtureContext(job);
      const loaded = await bound.guards.withMaterializedImports(binding, ['yq'], async (namespaces) => {
        let status = null;
        let rejected = false;
        let rejection = null;
        try {
          const definition = namespaces.yq.createYqCommand();
          assert.equal(definition.name, 'yq');
          fixture.event('command-call');
          const result = await definition.execute(fixture.context);
          status = result?.exitCode ?? null;
          fixture.event('command-return', { status });
        } catch (error) {
          rejected = true;
          rejection = bound.runtime.context.encodeRejection(error);
          fixture.event('command-reject', { rejection });
        }
        const cleanupErrors = await fixture.drain();
        capture = { ...fixture.capture(), status, rejected, rejection, cleanupErrors };
        return capture;
      });
      body = { capture, imported: loaded.imported, proofRole: loaded.proofRole };
    }
    bound.guards.assertBound(binding);
  }
} catch (error) {
  failure = { name: String(error?.name), code: String(error?.code ?? ''), message: String(error?.message ?? error) };
  process.exitCode = 1;
}
try { bound.verify(); bound.runtime.integrity.verifyGuards(bound.guardList); }
catch (error) { failure ??= { name: 'Integrity', message: String(error) }; process.exitCode = 1; }
const receipt = { schemaVersion: 1, jobId, outcome: failure ? 'FAIL' : 'CAPTURED', mode, rootHash, sealHash, movement, capture, ...body, failure };
await new Promise((resolve, reject) => process.stdout.write(`${JSON.stringify(receipt)}\n`, (error) => error ? reject(error) : resolve()));
