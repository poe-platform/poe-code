import assert from 'node:assert/strict';
import { chmodSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(join(config.output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const errorData = (error) => ({ name: error.name, message: error.message, code: error.code ?? null, stack: error.stack });
function authenticate() {
  for (const file of config.files) { const status = lstatSync(file.copy); assert(status.isFile() && !status.isSymbolicLink()); assert.equal(realpathSync(file.copy), file.copy); assert.equal(status.mode & 4095, file.mode); assert.equal(hash(readFileSync(file.copy)), file.sha256); }
}
authenticate();
const components = await import(pathToFileURL(join(config.core, 'components.mjs')).href);
const translation = await import(pathToFileURL(join(config.core, 'translation.mjs')).href);
const binding = await import(pathToFileURL(join(config.core, 'binding.mjs')).href);
components.verifyIntegration(config.sealPath, config.sealHash);
const pins = JSON.parse(readFileSync(join(config.core, 'COMPONENTS.json')));
const recipe = JSON.parse(readFileSync(join(config.core, 'RECIPE.json')));
const maps = JSON.parse(readFileSync(config.mapsPath));
const fullReceipt = JSON.parse(readFileSync(config.fullReceiptPath));
const reference = (entry) => ({ path: join(components.repository, entry.path), sha256: entry.sha256 });
const root = { schema: 1, purpose: 'YQ_COMPOUND_V2_AFTER_ROOT_PRESEAL', execute: true, rootApproval: 'SYNTHETIC_METADATA_ONLY_NOT_ROOT_AUTHORIZATION', integrationSealSha256: config.sealHash, authorSourceCommit: pins.author.sourceCommit, consumerCandidateCommit: pins.author.sourceCommit, sourceBase: pins.baseline, acceptedLength: pins.acceptedLength, rootSourceCompositionAccepted: true, consumerReceipt: reference(pins.packet.fullReceipt), admissionReceipt: reference(pins.packet.admissionReceipt), frameworkReviewReceipt: { path: join(config.scratch, 'NOT-A-ROOT-REVIEW.json'), sha256: '0'.repeat(64) }, sourceArchive: { path: join(config.scratch, 'UNOPENED-SOURCE.tar'), sha256: pins.author.archiveSha256 }, packageArchive: { path: join(config.scratch, 'UNOPENED-PACKAGE.tgz'), sha256: pins.author.packageSha256 }, archiveSourceRoot: join(config.scratch, 'archive273'), consumerSourceRoot: join(config.scratch, 'source271'), packageRoot: join(config.scratch, 'package870'), runtimeRecipeRoot: join(config.scratch, 'runtime'), outputParent: join(config.scratch, 'future-output'), buildProof: { classification: 'AUTHOR_ARTIFACT_BINDING_ONLY', receipt: null } };
const observations = [];
async function observe(id, input, operation, predicate) {
  authenticate();
  components.verifyIntegration(config.sealPath, config.sealHash);
  save(id + '-input.json', input);
  let returned = null;
  let rejected = null;
  try { returned = await operation(); } catch (error) { rejected = errorData(error); }
  const raw = { returned, rejected, classification: 'CANNED_METADATA_NOT_ROOT_AUTHORIZATION' };
  save(id + '-raw.json', raw);
  let failure = null;
  try { predicate(raw); } catch (error) { failure = errorData(error); }
  observations.push({ id, matched: !failure, failure });
  save(id + '-verdict.json', observations.at(-1));
  authenticate();
  components.verifyIntegration(config.sealPath, config.sealHash);
}
function mutations(changes) {
  return changes.map((change) => { const value = structuredClone(root); change(value); let error = null; try { translation.validateEnvelope(value, config.sealHash, pins); } catch (caught) { error = errorData(caught); } return { input: value, error }; });
}
function allRefused(raw) { assert.equal(raw.rejected, null); assert(raw.returned.length > 0 && raw.returned.every((entry) => entry.error)); }
try {
  await observe('I01-envelope', root, () => translation.validateEnvelope(structuredClone(root), config.sealHash, pins), (raw) => { assert.equal(raw.rejected, null); assert.equal(raw.returned.consumerCandidateCommit, '35da18547ca82a67be9ca22b4adc21e3b8060780'); });
  await observe('I02-origins', { variants: ['HEAD', 'fabricated', 'wrong-baseline'] }, () => mutations([(value) => { value.consumerCandidateCommit = 'HEAD'; }, (value) => { value.consumerCandidateCommit = 'f'.repeat(40); }, (value) => { value.sourceBase = pins.author.sourceCommit; }]), allRefused);
  await observe('I03-receipt-binding', { cases: ['wrong-hash', 'wrong-path', 'missing-external-hash'] }, () => {
    const results = mutations([(value) => { value.consumerReceipt.sha256 = '0'.repeat(64); }, (value) => { value.admissionReceipt.path = join(config.scratch, 'self-authorized.json'); }]);
    let error = null;
    try { components.readBound(config.sealPath, undefined); } catch (caught) { error = errorData(caught); }
    results.push({ error });
    return results;
  }, allRefused);
  await observe('I04-schema-public', { cases: ['missing-runtime', 'public-claim'] }, () => mutations([(value) => { delete value.runtimeRecipeRoot; }, (value) => { value.publicIntegrationPassed = true; }]), allRefused);
  await observe('I05-build-role', { cases: ['fake-independent-compile', 'invented-build-receipt'] }, () => mutations([(value) => { value.buildProof.classification = 'INDEPENDENT_REPRODUCTION_ROOT_ACCEPTED'; }, (value) => { value.buildProof.receipt = { path: '/not-a-build', sha256: '0'.repeat(64) }; }]), allRefused);
  await observe('I06-runtime-translation', { source: 271, archive: 273, package: 870, noAuthorizationWrittenOrConsumed: true }, () => translation.translateRuntime({ root: { ...root, consumerBuildReceipt: pins.packet.buildReceipt, sourceAdditions: fullReceipt.sourceAdditions }, pins, recipe, runtimeRoot: root.runtimeRecipeRoot, sourceTree: maps.source, packageTree: maps.fullPackage, entry: { path: 'dist/commands/yq/index.js', sha256: pins.author.entrySha256 }, metadataRoot: join(config.scratch, 'unwritten-metadata'), evidenceParent: root.outputParent, frozenRepository: components.repository, node: { path: process.execPath, sha256: config.nodeSha256, mode: lstatSync(process.execPath).mode & 4095 } }), (raw) => {
    assert.equal(raw.rejected, null);
    const result = raw.returned;
    assert.equal(result.authorization.source.root, root.consumerSourceRoot);
    assert.notEqual(result.authorization.source.root, root.archiveSourceRoot);
    assert.equal(result.authorization.source.treeSha256, '62784dcec8eeb324e3260cc9f1962e31bbf22c1d0ff23d771b5206ee1eb2b0a0');
    assert.equal(result.authorization.compiled.treeSha256, '782b3b4e92d66339c2f2d037f16b6f55ac281550fd99c440bac5828a04c13742');
    assert.equal(result.authorization.recipe.sealSha256, 'fc273904cf20f4a717bb7350bb46046bbee16617aee371bcfd03e38d98920f15');
    assert.equal(result.authorization.candidateCommit, pins.author.sourceCommit);
    assert.equal(result.authorization.contractCommit, 'bd471ef682d768692a682d40009a874f51e3ad68');
    assert.equal(result.provenance.buildProofClassification, 'AUTHOR_ARTIFACT_BINDING_ONLY');
    assert.deepEqual(result.provenance.newPaths.sort(), ['src/commands/structured/query-core.ts', 'src/commands/yq/README.md', 'src/commands/yq/accounting.ts', 'src/commands/yq/encoder.ts', 'src/commands/yq/errors.ts', 'src/commands/yq/index.ts', 'src/commands/yq/parser.ts']);
    assert.equal(Object.keys(maps.source.files).length, 271);
    assert.equal(Object.keys(maps.archive.files).length, 273);
    assert.equal(Object.keys(maps.fullPackage.files).length, 870);
  });
  await observe('I07-readme-full-package', { mutations: ['README-absent', 'README-mismatched', 'extra-entry', 'omitted-baseline'] }, () => {
    translation.assertFullPackage(maps.fullPackage.files, maps.readme);
    return [(files) => { delete files['README.md']; }, (files) => { files['README.md'].sha256 = '0'.repeat(64); }, (files) => { files['extra.txt'] = files['README.md']; }, (files) => { delete files['package.json']; }].map((change) => { const files = structuredClone(maps.fullPackage.files); change(files); let error = null; try { translation.assertFullPackage(files, maps.readme); } catch (caught) { error = errorData(caught); } return { error }; });
  }, allRefused);
  await observe('I08-continuation', { metadataOnly: true }, () => {
    const base = { aggregate: 'PASS', stop: null, activeChildren: [], results: [{ admitted: true, integrity: true, reapProof: true, metadata: { reaped: true, exitCode: 0, signal: null, timedOut: false, overflow: false, spawnError: null } }] };
    return [(value) => { value.aggregate = 'FAIL'; }, (value) => { value.results[0].metadata.exitCode = 7; }, (value) => { value.results[0].metadata.timedOut = true; }, (value) => { value.results[0].metadata.signal = 'SIGTERM'; }, (value) => { value.results[0].integrity = false; }, (value) => { value.results[0].reapProof = false; }].map((change) => { const input = structuredClone(base); change(input); return { input, result: translation.continuation(input) }; });
  }, (raw) => { assert.equal(raw.rejected, null); assert(raw.returned.every((entry) => entry.result.aggregate === 'FAIL')); for (const entry of raw.returned) if (entry.result.admitIndependent) assert(entry.input.results.every((record) => record.integrity && record.reapProof && record.metadata.reaped)); assert(raw.returned.slice(4).every((entry) => !entry.result.admitIndependent)); });
  await observe('I09-integration-integrity', { mutations: ['added-file', 'mode'] }, () => {
    const results = [];
    const added = join(config.core, 'unbound.txt');
    try { writeFileSync(added, 'unbound\n', { flag: 'wx' }); try { components.verifyIntegration(config.sealPath, config.sealHash); results.push(null); } catch (error) { results.push(errorData(error)); } } finally { rmSync(added); }
    const filename = join(config.core, 'translation.mjs');
    try { chmodSync(filename, 0o600); try { components.verifyIntegration(config.sealPath, config.sealHash); results.push(null); } catch (error) { results.push(errorData(error)); } } finally { chmodSync(filename, 0o644); }
    return results;
  }, (raw) => { assert.equal(raw.rejected, null); assert(raw.returned.every(Boolean)); });
  await observe('I10-missing-root', { missingArguments: true }, () => binding.bind(), (raw) => { assert(raw.rejected); assert.match(raw.rejected.message, /Missing explicit root binding/); });
} catch (error) { save('STOP.json', errorData(error)); process.exitCode = 1; }
finally {
  const summary = { count: observations.length, matched: observations.filter((entry) => entry.matched).length, observations, productImports: 0, productRuns: 0, builds: 0, compilerRuns: 0, semanticPasses: 0, positiveBindExecuted: false, loadComponentsExecuted: false };
  save('SUMMARY.json', summary);
  if (summary.count !== 10 || summary.matched !== 10) process.exitCode = 1;
  console.log(JSON.stringify({ controls: summary.count, matched: summary.matched }));
}
