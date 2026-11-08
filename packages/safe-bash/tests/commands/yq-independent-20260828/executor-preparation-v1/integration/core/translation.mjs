import assert from 'node:assert/strict';
import { dirname, isAbsolute, join } from 'node:path';
import { hash, jsonHash } from './components.mjs';

export function directoryMap(files) {
  const directories = { '': 493 };
  for (const filename of Object.keys(files)) {
    let parent = dirname(filename);
    while (parent !== '.') { directories[parent] = 493; parent = dirname(parent); }
  }
  return directories;
}

export function runtimeEntries(tree) {
  const result = [];
  const all = [...Object.keys(tree.directories).filter(Boolean), ...Object.keys(tree.files)];
  assert.equal(new Set(all).size, all.length, 'File/directory collision');
  const visit = (prefix) => {
    result.push({ path: prefix || '.', kind: 'directory', mode: tree.directories[prefix] });
    for (const path of all.filter((path) => dirname(path) === (prefix || '.')).sort()) {
      if (Object.hasOwn(tree.directories, path)) visit(path);
      else {
        const value = tree.files[path];
        result.push({ path, kind: 'file', mode: value.mode, bytes: value.bytes, sha256: value.sha256 });
      }
    }
  };
  visit('');
  assert.equal(result.length, all.length + 1, 'Disconnected tree map');
  return result;
}

export function assertFullPackage(files, readme) {
  assert.equal(Object.keys(files).length, 870, 'Complete package must have 870 files');
  assert.deepEqual(files['README.md'], { sha256: readme.sha256, bytes: readme.bytes, mode: readme.mode }, 'Complete baseline README identity');
}

export function validateEnvelope(root, expectedSeal, pins) {
  assert(root && root.schema === 1 && root.purpose === 'YQ_COMPOUND_AFTER_ROOT_PRESEAL' && root.execute === true, 'Missing root execution authorization');
  const keys = ['schema', 'purpose', 'execute', 'rootApproval', 'integrationSealSha256', 'authorSourceCommit', 'consumerCandidateCommit', 'sourceBase', 'acceptedLength', 'rootSourceCompositionAccepted', 'consumerReceipt', 'admissionReceipt', 'frameworkReviewReceipt', 'sourceArchive', 'packageArchive', 'archiveSourceRoot', 'consumerSourceRoot', 'packageRoot', 'outputParent', 'buildProof'];
  assert.deepEqual(Object.keys(root).sort(), keys.sort(), 'Unknown/missing execution envelope field');
  assert.equal(root.integrationSealSha256, expectedSeal, 'Integration seal binding');
  assert(typeof root.rootApproval === 'string' && root.rootApproval.length > 0);
  assert.equal(root.authorSourceCommit, pins.author.sourceCommit, 'Author source identity');
  assert.equal(root.sourceBase, pins.baseline);
  assert.equal(root.acceptedLength, pins.acceptedLength);
  assert.equal(root.rootSourceCompositionAccepted, true);
  assert(/^[a-f0-9]{40}$/.test(root.consumerCandidateCommit));
  assert.notEqual(root.consumerCandidateCommit, pins.author.sourceCommit, 'CONSUMER_RAW_AUTHOR_TREE_GAP: 301 selected Git paths versus authorized 271; no silent substitution');
  for (const key of ['consumerReceipt', 'admissionReceipt', 'frameworkReviewReceipt', 'sourceArchive', 'packageArchive']) {
    assert.deepEqual(Object.keys(root[key]).sort(), ['path', 'sha256']);
    assert(isAbsolute(root[key].path) && /^[a-f0-9]{64}$/.test(root[key].sha256));
  }
  assert.equal(root.sourceArchive.sha256, pins.author.archiveSha256, 'Exact author archive binding');
  assert.equal(root.packageArchive.sha256, pins.author.packageSha256, 'Exact full870 package binding');
  for (const key of ['archiveSourceRoot', 'consumerSourceRoot', 'packageRoot', 'outputParent']) assert(isAbsolute(root[key]));
  assert(['AUTHOR_ARTIFACT_BINDING_ONLY', 'INDEPENDENT_REPRODUCTION_ROOT_ACCEPTED'].includes(root.buildProof.classification));
  assert.deepEqual(Object.keys(root.buildProof).sort(), ['classification', 'receipt']);
  if (root.buildProof.classification === 'AUTHOR_ARTIFACT_BINDING_ONLY') assert.equal(root.buildProof.receipt, null);
  else assert(root.buildProof.receipt && isAbsolute(root.buildProof.receipt.path) && /^[a-f0-9]{64}$/.test(root.buildProof.receipt.sha256));
  return root;
}

export function translateRuntime({ root, pins, recipe, runtimeRoot, sourceTree, packageTree, entry, metadataRoot, evidenceParent, frozenRepository, node }) {
  const sourceTreeSha256 = jsonHash(runtimeEntries(sourceTree));
  const compiledTreeSha256 = jsonHash(runtimeEntries(packageTree));
  const provenance = {
    candidateCommit: pins.author.sourceCommit, consumerCandidateCommit: root.consumerCandidateCommit,
    baselineCommit: pins.baseline, acceptedLengthCommit: pins.acceptedLength,
    sourceTreeSha256, compiledTreeSha256, rootAcceptedComposition: root.rootSourceCompositionAccepted,
    buildReceiptSha256: root.consumerBuildReceipt.sha256, newPaths: Object.keys(root.sourceAdditions),
    buildProofClassification: root.buildProof.classification,
  };
  const provenanceBytes = `${JSON.stringify(provenance, null, 2)}\n`;
  const provenancePath = join(metadataRoot, 'runtime-provenance.json');
  const authorization = {
    schemaVersion: 1, purpose: 'YQ_CANDIDATE_EXECUTION_EXPLICIT_HANDOFF', rootApproval: root.rootApproval,
    candidateCommit: pins.author.sourceCommit, baselineCommit: pins.baseline, acceptedLengthCommit: pins.acceptedLength,
    contractCommit: pins.contract, independentReviewCommit: pins.independent,
    recipe: { root: runtimeRoot, sealSha256: pins.runtime.seal.sha256, treeSha256: pins.runtime.treeSha256 },
    source: { root: root.consumerSourceRoot, treeSha256: sourceTreeSha256, provenance: { path: provenancePath, sha256: hash(provenanceBytes) } },
    compiled: { root: root.packageRoot, treeSha256: compiledTreeSha256, entry: { path: entry.path, sha256: entry.sha256, exportName: 'createYqCommand', proofRole: 'direct-compiled-factory-handler-not-public-package' } },
    node, frozenRepository, selection: { ids: recipe.preparedIds, jobsSha256: recipe.jobsSha256 },
    bounds: Object.fromEntries(['deadlineMs', 'termGraceMs', 'reapMs', 'captureBytes', 'maximumJobs'].map((key) => [key, recipe.bounds[key]])), evidenceParent,
  };
  return { provenance, provenanceBytes, provenancePath, authorization };
}

export function continuation(result, movementIntegrity = true) {
  const records = result.results.filter((entry) => entry.admitted);
  const intact = records.length > 0 && records.every((entry) => entry.integrity) && movementIntegrity;
  const reaped = records.length > 0 && records.every((entry) => entry.reapProof && entry.metadata.reaped);
  const workerSuccess = records.every((entry) => entry.metadata.exitCode === 0 && entry.metadata.signal === null && !entry.metadata.timedOut && !entry.metadata.overflow && !entry.metadata.spawnError);
  return { aggregate: result.aggregate === 'PASS' && intact && reaped && workerSuccess ? 'PASS' : 'FAIL', admitIndependent: intact && reaped && !result.stop && result.activeChildren.length === 0 };
}
