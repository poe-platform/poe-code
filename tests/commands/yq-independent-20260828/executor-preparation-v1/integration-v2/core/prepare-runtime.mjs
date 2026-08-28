import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { coreRoot, jsonHash, readBound, readJson, repository, treeEntries, verifyIntegration, verifyRuntimeSource } from './components.mjs';
import { continuation } from './translation.mjs';

const [sealPath, sealHash, evidenceParent, ...extra] = process.argv.slice(2);
assert(evidenceParent && extra.length === 0, 'Usage: prepare-runtime.mjs SEAL SHA256 EXISTING_EVIDENCE_PARENT');
const seal = verifyIntegration(sealPath, sealHash);
const pins = readJson(join(coreRoot, 'COMPONENTS.json'));
const runtimeSeal = verifyRuntimeSource(pins);
for (const binding of pins.runtime.bootstrap) {
  readBound(join(repository, binding.path), binding.sha256);
  assert.equal(runtimeSeal.entries.find((entry) => binding.path.endsWith(`/${entry.path}`))?.sha256, binding.sha256, 'Bootstrap must be byte-identical to corrected recipe');
}
const bootstrapRoot = dirname(join(repository, pins.runtime.bootstrap[0].path));
assert.equal(jsonHash(treeEntries(bootstrapRoot)), runtimeSeal.originalTreeSha256);
const integrity = await import(pathToFileURL(join(bootstrapRoot, 'integrity.mjs')).href);
const host = await import(pathToFileURL(join(bootstrapRoot, 'host.mjs')).href);
const guards = [
  { kind: 'tree', path: coreRoot, sha256: seal.coreTreeSha256 },
  { kind: 'file', path: join(repository, pins.runtime.sourcePreseal.path), sha256: pins.runtime.sourcePreseal.sha256, mode: 420 },
  { kind: 'tree', path: bootstrapRoot, sha256: runtimeSeal.originalTreeSha256 },
];
const evidence = integrity.createEvidence(evidenceParent, guards);
const destination = join(evidence, 'runtime-recipe');
let materialized = null;
const result = await host.runJobs({
  executable: process.execPath, evidenceParent: evidence, guards,
  bounds: { deadlineMs: 30000, termGraceMs: 150, reapMs: 2000, captureBytes: 16777216, maximumJobs: 1 },
  jobs: [{ id: 'materialize-runtime', cwd: repository, args: [join(coreRoot, 'materialize-runtime.mjs'), sealPath, sealHash, destination] }],
  assertReceipt(receipt) {
    verifyRuntimeSource(pins);
    assert.equal(receipt.outcome, 'CAPTURED');
    assert.equal(receipt.recipeRoot, destination);
    assert.equal(receipt.sealPath, join(repository, pins.runtime.seal.path));
    assert.equal(receipt.sealSha256, pins.runtime.seal.sha256);
    assert.equal(receipt.productImports, 0);
    assert.equal(jsonHash(treeEntries(destination)), pins.runtime.treeSha256);
    materialized = receipt;
  },
});
let integrityAfter = true;
try { verifyIntegration(sealPath, sealHash); verifyRuntimeSource(pins); integrity.verifyGuards(guards); }
catch { integrityAfter = false; }
const gate = continuation(result, integrityAfter);
const summary = { schema: 1, aggregate: materialized && gate.aggregate === 'PASS' ? 'PASS' : 'FAIL', evidence, rawEvidence: result.evidence, materialized, activeChildren: host.activeChildren(), integrityAfter, childResults: result.results, productImports: 0, productExecutions: 0, grantsExecution: false };
integrity.atomicJson(join(evidence, 'MATERIALIZATION.json'), summary);
console.log(JSON.stringify({ aggregate: summary.aggregate, recipeRoot: materialized?.recipeRoot ?? null, sealPath: materialized?.sealPath ?? null, sealSha256: materialized?.sealSha256 ?? null, evidence, activeChildren: summary.activeChildren, productImports: 0 }));
process.exitCode = summary.aggregate === 'PASS' ? 0 : 1;
