import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT, OLD, json, identity, verifyTree, durable } from './common.mjs';
import { generator, digestSink } from '../preparation-v2/resources.mjs';
const directory = path.join(ROOT, 'evidence-continuation'); const children = await json(path.join(directory, 'CHILDREN.json'));
const admission = await json(path.join(OLD, 'evidence/ADMISSION.json')); const seal = await json(path.join(ROOT, 'PRE-SEAL.json')); const addendum = await json(path.join(ROOT, 'CONTINUATION-PRE.json'));
for (const entry of [...seal.inputs, ...addendum.inputs]) { const { path: filename, ...expected } = entry; assert.deepEqual(await identity(filename), expected); }
for (const [name, entries] of [['source', admission.source], ['tools', admission.tools], ['installed-moved', admission.installed]]) await verifyTree(path.join(OLD, 'work', name), entries);
const emission = await json(path.join(directory, 'EMISSION.json')); await verifyTree(path.join(ROOT, 'build-continuation'), emission.entries);
const finals = [];
for (const child of children.filter(child => /^(SOURCE|INSTALLED_MOVED)-\d+$/.test(child.id))) {
  const final = await json(path.join(directory, child.id, 'FINAL-ADMISSION.json'));
  assert.equal(child.code, final.failures ? 1 : 0); assert.equal(final.closed, true); assert.equal(final.complete, true); assert.equal(final.intact, true);
  finals.push({ id: child.id, code: child.code, failures: final.failures, complete: true, closed: true, intact: true });
}
assert.equal(finals.length, 158); assert.equal(children.length, 164); assert.ok(children.every(child => child.reaped));
const limit = seal.cohort.limits.find(limit => limit.name === 'maxOutputBytes'); const spec = generator(limit, limit.defaultValue); const output = digestSink();
for await (const chunk of spec.output()) await output.write(chunk);
const expected = output.finish(); const data = (await readFile(path.join(directory, 'INSTALLED_MOVED-076/stdout.raw'), 'utf8')).trim().split('\n').map(JSON.parse);
const observed = data.find(record => record.stage === 'RAW_OBSERVATION').observation.stdout; assert.deepEqual(observed, expected);
await durable(path.join(ROOT, 'POSTCHECK.json'), { classification: 'READ_ONLY_EVIDENCE_CHECK_NO_PRODUCT_RERUN_OR_RESCORE', checked: new Date().toISOString(),
  appendAwareTrees: ['admitted source', 'admitted tools', 'physically moved package', 'independent emission'], recipeFileHashes: 'exact bound files; not append-proof review output directory',
  finals, allActualExitChannelsAgree: true, cohortChildren: 164, reaped: 164,
  movedDefaultOutput: { bytes: expected.bytes, expectedSha256: expected.sha256, actualSha256: observed.sha256, reference: 'sealed preparation-v2 independent output generator', actualRaw: 'evidence-continuation/INSTALLED_MOVED-076/stdout.raw', newProductInvocations: 0 },
  parentAuditCaveat: 'unexecuted nonzero-exit/all-PASS inconsistency remains unqualified; this check confirms it did not occur in these actual receipts' });
console.log(JSON.stringify({ actualFinalizations: finals.length, children: children.length, outputDigest: expected }));
