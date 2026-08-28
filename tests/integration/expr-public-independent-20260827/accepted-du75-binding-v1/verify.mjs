import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../..');
const prefix = `${relative(root, directory)}/`;
const limit = 1024 * 1024;
const args = process.argv.slice(2);
const authenticateOnly = args.length === 1 && args[0] === '--authenticate';
const commit = args.length === 2 && args[0] === '--commit' ? args[1] : undefined;
assert(args.length === 0 || authenticateOnly || /^[0-9a-f]{40}$/.test(commit ?? ''),
  'Usage: node verify.mjs [--authenticate | --commit <full-40-character-commit>]');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...arguments_) => execFileSync('git', arguments_, {
  cwd: root, maxBuffer: limit + 1, timeout: 10000,
});
const safePath = path => {
  assert(typeof path === 'string' && !path.startsWith('/') && !path.split('/').includes('..'));
  assert(path.startsWith('tests/integration/'));
  return path;
};
const readBlob = (revision, path) => {
  assert.match(revision, /^[0-9a-f]{40}$/);
  safePath(path);
  assert.equal(git('cat-file', '-t', revision).toString().trim(), 'commit');
  const object = `${revision}:${path}`;
  const size = Number(git('cat-file', '-s', object).toString().trim());
  assert(Number.isSafeInteger(size) && size >= 0 && size <= limit);
  const bytes = git('cat-file', 'blob', object);
  assert.equal(bytes.length, size);
  return bytes;
};
const readLocal = path => {
  const absolute = resolve(root, safePath(path));
  const stat = statSync(absolute);
  assert(stat.isFile() && stat.size <= limit);
  const bytes = readFileSync(absolute);
  assert(bytes.length <= limit);
  return bytes;
};
const readOwned = name => commit ? readBlob(commit, prefix + name) : readLocal(prefix + name);
const binding = JSON.parse(readOwned('BINDING.json'));
const checks = [];
const check = (name, callback) => { callback(); checks.push(name); };
const sources = binding.sources;
const raw = {};
const receipts = {};
check('sixteen-exact-git-blob-hashes', () => {
  assert.equal(Object.keys(sources).length, 16);
  for (const [name, source] of Object.entries(sources)) {
    raw[name] = readBlob(source.commit, source.path);
    assert.equal(raw[name].length, source.bytes, name);
    assert.equal(sha256(raw[name]), source.sha256, name);
    if (source.path.endsWith('.json')) receipts[name] = JSON.parse(raw[name]);
  }
});
const original = receipts.duOriginalReport;
const continuation = receipts.duContinuationReport;
const admission = receipts.exprAdmission;
const inputs = receipts.exprInputs;
const v4 = receipts.exprV4Manifest;
const v5 = receipts.exprV5Manifest;
const report = receipts.exprV5Report;
const seal = receipts.r21N04Seal;
check('exact-du-candidate-equals-expr-selected-base', () => {
  assert.equal(original.candidate, binding.du.selectedBase);
  assert.equal(continuation.candidate, binding.du.selectedBase);
  assert.equal(admission.objects.selectedDU75.commit, binding.du.selectedBase);
  for (const receipt of [original, continuation]) {
    assert.equal(receipt.freeze, binding.du.freeze);
    assert.equal(receipt.package.tarballSha256, binding.du.pack.sha256);
    assert.equal(receipt.package.tarballBytes, binding.du.pack.bytes);
    assert.equal(receipt.package.authenticatedMembers, binding.du.pack.members);
  }
});
check('du-composed-receipt-and-recipe-links', () => {
  assert.equal(receipts.duOriginalManifest.files['REPORT.json'], sources.duOriginalReport.sha256);
  assert.equal(receipts.duContinuationManifest.files['REPORT.json'], sources.duContinuationReport.sha256);
  assert.equal(continuation.originalEvidence, sources.duOriginalManifest.commit);
  assert.equal(continuation.originalEvidenceManifestSha256, sources.duOriginalManifest.sha256);
  assert.equal(continuation.recipeCommit, sources.duContinuationRecipe.commit);
  assert.equal(continuation.recipeManifestSha256, sources.duContinuationRecipe.sha256);
  assert.equal(receipts.duContinuationManifest.recipeCommit, continuation.recipeCommit);
  assert.equal(receipts.duContinuationManifest.originalEvidence, continuation.originalEvidence);
  assert.equal(receipts.duContinuationManifest.newCases, 7);
  assert.equal(receipts.duContinuationManifest.composedCases, 29);
});
check('du-22-plus-7-and-unchanged-runtime-receipts', () => {
  const composed = binding.du.composition;
  assert.equal(original.counts.acceptedFrozenCases, composed.originalQualified);
  assert.equal(continuation.counts.priorQualified, composed.originalQualified);
  assert.equal(continuation.counts.newlyQualified, composed.continuationQualified);
  assert.equal(composed.originalQualified + composed.continuationQualified, composed.total);
  assert.equal(continuation.counts.composedUniqueCases, composed.total);
  assert.deepEqual(continuation.counts.newCaseIds, composed.continuationIds);
  assert.equal(original.counts.sourceRuntime, composed.sourceRuntime);
  assert.equal(original.counts.movedRuntime, composed.movedRuntime);
  assert.equal(continuation.counts.priorSourceRuntime, composed.sourceRuntime);
  assert.equal(continuation.counts.priorMovedRuntime, composed.movedRuntime);
  assert.equal(continuation.counts.sourceReruns, 0);
  assert.equal(continuation.counts.movedReruns, 0);
  assert.equal(continuation.counts.focusedControls, composed.focusedControls);
  assert.equal(continuation.counts.originalPackageGuardExpectedRejects, composed.packageGuardExpectedRejects);
  assert.deepEqual(original.counts.attemptedUnaccepted, ['T03']);
  assert.deepEqual(original.counts.neverExecuted, composed.originalNeverExecuted);
  assert.equal(original.failure.rescore, false);
  assert.equal(original.boundaries.public29Accepted, false);
});
check('du-T03-leaf-TS2322-and-T04-T05-root-proofs', () => {
  const proof = label => continuation.declarationProofs.find(entry => entry.label === label);
  assert.deepEqual(proof('T03').requiredRoots, ['du']);
  for (const label of ['T04', 'T05-positive', 'T05-replace', 'T05-unknown']) {
    assert.deepEqual(proof(label).requiredRoots, ['root']);
  }
  const outcome = continuation.typeOutcomes.find(entry => entry.label === 'T03');
  assert.equal(outcome.status, 'EXPECTED');
  assert.equal(outcome.expected.exitCode, 2);
  assert.deepEqual(outcome.diagnostics.map(entry => entry.code), [2322]);
});
check('expr-commit-tree-and-ancestry-not-byte-identity', () => {
  assert.equal(admission.objects.candidate.commit, binding.expr.candidate);
  assert.equal(admission.objects.source.commit, binding.expr.sourceCommit);
  assert.equal(admission.objects.freeze.commit, binding.expr.originalFreeze);
  for (const receipt of [inputs, report]) {
    assert.equal(receipt.candidate, binding.expr.candidate);
    assert.equal(receipt.tree, binding.expr.tree);
  }
  assert.equal(admission.objects.candidate.tree, binding.expr.tree);
  assert.equal(git('rev-parse', `${binding.expr.candidate}^{tree}`).toString().trim(), binding.expr.tree);
  for (const [ancestor, descendant] of [
    [binding.du.selectedBase, binding.expr.candidate],
    [binding.expr.originalFreeze, binding.expr.sourceCommit],
    [binding.expr.sourceCommit, binding.expr.candidate],
  ]) {
    assert(admission.ancestry.some(entry => entry.ancestor === ancestor && entry.descendant === descendant && entry.isAncestor));
    git('merge-base', '--is-ancestor', ancestor, descendant);
  }
  assert.notEqual(binding.du.selectedBase, binding.expr.candidate);
  assert.notEqual(binding.du.pack.sha256, binding.expr.pack.sha256);
});
check('expr-distinct-pack-and-independent-P01-lineage', () => {
  assert.equal(inputs.selected.length, binding.expr.pack.inputs);
  assert.equal(inputs.package.tarballSha256, binding.expr.pack.sha256);
  assert.equal(admission.artifact.sha256, binding.expr.pack.sha256);
  assert.equal(admission.artifact.bytes, binding.expr.pack.bytes);
  assert.equal(admission.artifact.regularFileCount, binding.expr.pack.members);
  assert.equal(v4.P01.status, 'pass');
  assert.equal(v4.P01.buildExecuted, true);
  assert.equal(v4.P01.packExecuted, true);
  assert.equal(v4.P01.independentInputs, binding.expr.pack.inputs);
  for (const receipt of [v4, v5, report, seal]) {
    assert.equal(receipt.P01.actualPackSha256, binding.expr.pack.sha256);
    assert.equal(receipt.P01.packBytes, binding.expr.pack.bytes);
  }
  for (const receipt of [v5, report, seal]) {
    assert.equal(receipt.P01.status, 'BOUND_ACCEPTED_PROOF');
    assert.equal(receipt.P01.accepted, true);
    assert.equal(receipt.P01.independentlyBuiltIn, sources.exprV4Manifest.commit);
    assert.equal(receipt.P01.manifestSha256, sources.exprV4Manifest.sha256);
    assert.equal(receipt.P01.independentInputsBound, binding.expr.pack.inputs);
    assert.equal(receipt.P01.members, binding.expr.pack.members);
    assert.equal(receipt.P01.buildExecuted, false);
    assert.equal(receipt.P01.packExecuted, false);
  }
  assert.equal(report.inputsSha256, sources.exprInputs.sha256);
});
check('historical-consumer-profile-and-v5-outcomes-not-rescored', () => {
  assert.equal(sources.originalConsumer.sha256, binding.expr.originalConsumerSha256);
  assert.equal(sources.componentAdapter.sha256, binding.expr.componentAdapterSha256);
  assert(raw.componentAdapter.toString().includes(binding.expr.executedHistoricalProfile));
  assert(inputs.original.some(entry => entry.path === sources.originalConsumer.path && entry.sha256 === sources.originalConsumer.sha256));
  for (const receipt of [v5, report]) {
    assert.equal(receipt.counts.pass, 100);
    assert.equal(receipt.counts.executed, 104);
    assert.equal(receipt.counts.fail, 4);
    assert.equal(receipt.counts.typePass, 32);
    assert.equal(receipt.counts.typeInvocations, 40);
    assert.equal(receipt.counts.typeFail, 8);
    assert.equal(receipt.counts.controlsPass, 36);
  }
  assert.equal(report.contexts.length, 4);
  for (const context of report.contexts) {
    for (const id of ['R25', 'R26']) {
      const outcome = context.cases.find(entry => entry.id === id);
      assert.equal(outcome.status, 'pass');
      assert.equal(outcome.executed, true);
    }
  }
  assert(report.holds.includes('accepted-DU75 remains HELD/unrescored'));
});
check('separate-R21-N04-receipt-bindings-and-counts-only', () => {
  assert.equal(seal.recipeCommit, sources.r21N04Recipe.commit);
  assert.equal(seal.recipeManifestSha256, sources.r21N04Recipe.sha256);
  assert.equal(seal.artifacts.find(entry => entry.path === 'MANIFEST.json').sha256, sources.r21N04Manifest.sha256);
  for (const [name, value] of Object.entries(binding.reconciliation.reported)) assert.equal(seal.counts[name], value);
  assert.equal(seal.originalR21Rescored, false);
  assert.equal(seal.holdsUnchanged, true);
  assert.equal(seal.newBuilds, 0);
  assert(raw.r21N04Checkpoint.toString().includes('PROPOSED R21 fixture amendment'));
  assert(raw.r21N04Checkpoint.toString().includes('DU75 is selected, not accepted'));
});
check('nonexecuted-current-prerequisite-and-remaining-boundaries', () => {
  assert.equal(binding.profile, 'EXPR_ACCEPTED_DU75_PREREQUISITE_BOUND_20260828');
  assert.equal(binding.kind, 'NONEXECUTED_ACCEPTANCE_BINDING');
  assert.equal(binding.authority.currentPrerequisite, 'SATISFIED');
  assert.equal(binding.authority.priorAcceptedBeforeRunRewritten, false);
  assert.equal(binding.reconciliation.R21.rootAuthorizedFixtureAmendment, false);
  assert.equal(binding.remaining.finalExprQualification, 'PENDING_ROOT_REVIEW');
  assert.equal(binding.remaining.DiracDriver, 'SEPARATE_PENDING');
  assert.equal(binding.remaining.originalConsumerNewExecution, false);
  for (const [key, value] of Object.entries(binding.thisBindingExecution)) if (key !== 'scope') assert.equal(value, 0);
});
const authenticationChecks = [...checks];
let preservationTargets = 0;
if (!authenticateOnly) {
  const verification = JSON.parse(readOwned('VERIFICATION.json'));
  check('recorded-authentication-and-29-target-pre-post-preservation', () => {
    assert.equal(verification.authentication.status, 'AUTHENTICATED_METADATA_ONLY');
    assert.deepEqual(verification.authentication.checks, authenticationChecks);
    assert.equal(verification.preservation.targets.length, 29);
    const paths = verification.preservation.targets.map(entry => entry.path);
    assert.equal(new Set(paths).size, paths.length);
    for (const source of [...Object.values(sources), ...inputs.original]) assert(paths.includes(source.path));
    for (const target of verification.preservation.targets) {
      assert.equal(sha256(readBlob(target.commit, target.path)), target.sha256);
      assert.equal(target.beforeSha256, target.sha256);
      assert.equal(target.afterSha256, target.sha256);
      assert.equal(sha256(readLocal(target.path)), target.sha256);
    }
    preservationTargets = paths.length;
  });
  check('owned-artifact-manifest-and-local-verifier-identity', () => {
    const manifest = JSON.parse(readOwned('MANIFEST.json'));
    assert.deepEqual(Object.keys(manifest.files).sort(), ['BINDING.json', 'README.md', 'VERIFICATION.json', 'verify.mjs'].sort());
    for (const [name, expected] of Object.entries(manifest.files)) {
      const bytes = readOwned(name);
      assert.equal(bytes.length, expected.bytes, name);
      assert.equal(sha256(bytes), expected.sha256, name);
    }
    assert.equal(sha256(readLocal(prefix + 'verify.mjs')), manifest.files['verify.mjs'].sha256);
  });
}
console.log(JSON.stringify({
  status: 'AUTHENTICATED_METADATA_ONLY',
  mode: authenticateOnly ? 'UNSEALED_AUTHENTICATION' : commit ? 'COMMITTED_BLOBS' : 'SEALED_WORKTREE',
  commit: commit ?? null,
  sources: Object.keys(sources).length,
  checks,
  preservationTargets,
  authority: 'Coordinator-conveyed root acceptance; message delivery not independently verified',
  productExecutions: 0,
  newProductPasses: 0,
  archiveExtractions: 0,
  fullGates: 0,
}, null, 2));
