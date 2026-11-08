import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const verifier = await import(pathToFileURL(join(config.v2, 'verify-recipe.mjs')).href);
verifier.verifyRecipe(config.v2Seal);
const originalVerifier = await import(pathToFileURL(join(config.v1, 'verify-recipe.mjs')).href);
originalVerifier.verifyRecipe(config.v1Seal);
const current = await import(pathToFileURL(join(config.v2, 'guards.mjs')).href);
const original = await import(pathToFileURL(join(config.v1, 'guards.mjs')).href);
const packetReceipt = JSON.parse(readFileSync(join(config.packet, 'SOURCE-RECEIPT.json')));
const observations = [];
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
let authority;
let fullAuthority;
async function observe(id, operation, expected) {
  verifier.verifyRecipe(config.v2Seal);
  originalVerifier.verifyRecipe(config.v1Seal);
  let value = null;
  let error = null;
  try { value = await operation(); } catch (caught) { error = { code: caught.code ?? null, message: caught.message, stack: caught.stack }; }
  const raw = { id, expected, value, error, role: 'DATA_OR_SYNTHETIC_NOT_YQ' };
  save(join(config.output, id + '-raw.json'), raw);
  const matched = expected === 'ACCEPT' ? error === null : expected === 'RECIPE_INTEGRITY_MESSAGE' ? error?.message.startsWith('RECIPE_INTEGRITY:') : error?.code === expected;
  observations.push({ id, expected, matched, raw: id + '-raw.json' });
  verifier.verifyRecipe(config.v2Seal);
  originalVerifier.verifyRecipe(config.v1Seal);
  assert(matched, `${id}: ${JSON.stringify(error)}`);
}
function describe(admitted) { return { receiptHash: admitted.receiptHash, sourceFiles: Object.keys(admitted.sourceFiles).length, sourceMapSha256: admitted.sourceMapSha256, packageFiles: admitted.expected ? Object.keys(admitted.expected.files).length : null }; }
function mutatedReceipt(id, mutate, wrongHash = false) {
  const value = structuredClone(packetReceipt);
  mutate(value);
  const path = join(config.scratch, id + '.json');
  save(path, value);
  save(join(config.output, id + '-input.json'), value);
  return describe(current.authorizeSources(path, wrongHash ? '0'.repeat(64) : current.sha256(readFileSync(path))));
}

try {
  await observe('C01-v1-refusal', () => original.authorizeSources(join(config.v2, 'SOURCE-RECEIPT.json'), config.v2SourceHash), 'SOURCE_BINDING');
  await observe('C02-v2-source', () => { authority = current.authorizeSources(join(config.v2, 'SOURCE-RECEIPT.json'), config.v2SourceHash); return describe(authority); }, 'ACCEPT');
  await observe('C03-packet-source', () => describe(current.authorizeSources(join(config.packet, 'SOURCE-RECEIPT.json'), config.packetSourceHash)), 'ACCEPT');
  await observe('C04-packet-full-data', () => { fullAuthority = current.authorizeSources(join(config.packet, 'FULL-RECEIPT.json'), config.packetFullHash); return describe(fullAuthority); }, 'ACCEPT');
  const cases = [
    ['C05-baseline', (value) => { value.sourceBase = value.candidateCommit; }, 'SOURCE_BINDING'],
    ['C06-length', (value) => { value.acceptedLength = value.sourceBase; }, 'SOURCE_BINDING'],
    ['C07-HEAD', (value) => { value.candidateCommit = 'HEAD'; }, 'RECEIPT_SCHEMA'],
    ['C08-fabricated-origin', (value) => { value.candidateCommit = 'f'.repeat(40); }, 'SOURCE_BINDING'],
    ['C09-wrong-fixed-origin', (value) => { value.candidateCommit = value.sourceBase; }, 'SOURCE_BINDING'],
    ['C10-new-hash', (value) => { value.sourceAdditions['src/commands/yq/index.ts'].sha256 = '0'.repeat(64); }, 'SOURCE_BINDING'],
    ['C11-new-mode', (value) => { value.sourceAdditions['src/commands/yq/index.ts'].mode = 384; }, 'DESCRIPTOR'],
    ['C12-extra-addition', (value) => { value.sourceAdditions['src/commands/yq/unapproved.ts'] = value.sourceAdditions['src/commands/yq/index.ts']; }, 'SOURCE_BINDING'],
    ['C13-missing-addition', (value) => { delete value.sourceAdditions['src/commands/yq/index.ts']; }, 'SOURCE_BINDING'],
    ['C14-root-edit', (value) => { value.sourceAdditions['src/index.ts'] = value.sourceAdditions['src/commands/yq/index.ts']; }, 'SOURCE_BINDING'],
    ['C15-path', (value) => { value.sourceAdditions['src/commands/yq/../outside.ts'] = value.sourceAdditions['src/commands/yq/index.ts']; }, 'PATH'],
    ['C16-self-override', (value) => { value.sourceOverrides = {}; }, 'RECEIPT_SCHEMA'],
  ];
  for (const [id, mutate, expected] of cases) await observe(id, () => mutatedReceipt(id, mutate), expected);
  await observe('C17-expected-receipt-hash', () => mutatedReceipt('C17-expected-receipt-hash', () => {}, true), 'RECEIPT_HASH');
  for (const [id, path] of [['C18-source-original271', config.materialization.source.original], ['C19-source-moved271', config.materialization.source.moved]]) await observe(id, () => { const tree = current.assertSourceMaterialization(authority, path); return { path, files: Object.keys(tree.files).length, sourceMapSha256: current.sha256(current.canonical(tree.files)) }; }, 'ACCEPT');
  await observe('C20-archive273-not-projection', () => current.assertSourceMaterialization(authority, config.materialization.archive.root), 'PACKAGE_MEMBERSHIP');
  await observe('C21-public-pending', () => current.assertPublicAdmission(), 'PUBLIC_EXPORT_GAP');
  await observe('C22-mutated-driver', () => {
    const raw = readFileSync(join(config.v2, 'synthetic-check.mjs'));
    const changed = Buffer.concat([raw, Buffer.from('\nthrow new Error("MUTATED DRIVER");\n')]);
    save(join(config.output, 'C22-driver-hashes.json'), { expectedFromCommittedRecipe: config.driverHash, original: current.sha256(raw), mutated: current.sha256(changed), executed: false });
    assert.equal(current.sha256(raw), config.driverHash);
    current.requireFact(current.sha256(changed) === config.driverHash, 'DRIVER_INTEGRITY');
  }, 'DRIVER_INTEGRITY');
  for (const [id, path] of [['C23-package-original870', config.materialization.package.original], ['C24-package-moved870', config.materialization.package.moved]]) await observe(id, () => { const tree = current.assertPackageTree(path, fullAuthority.expected); return { path, files: Object.keys(tree.files).length, packageMapSha256: current.sha256(current.canonical(tree)) }; }, 'ACCEPT');
  await observe('C25-authority-mutation', () => {
    const path = join(config.v2, 'SOURCE-AUTHORITY.json');
    const bytes = readFileSync(path);
    try { const changed = JSON.parse(bytes); changed.candidateCommit = 'f'.repeat(40); writeFileSync(path, JSON.stringify(changed)); verifier.verifyRecipe(config.v2Seal); }
    finally { writeFileSync(path, bytes); }
  }, 'RECIPE_INTEGRITY_MESSAGE');
  assert.equal(observations.length, 25);
  assert.equal(authority.sourceMapSha256, config.expectedSourceMap);
  for (const scope of ['source', 'package']) { const movement = config.materialization[scope]; assert(!existsSync(movement.staging)); assert.equal(lstatSync(movement.moved).ino, movement.directoryIdentity.ino); assert.equal(lstatSync(movement.moved).dev, movement.directoryIdentity.dev); }
} catch (error) {
  save(join(config.output, 'FAILURE.json'), { code: error.code ?? null, message: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  save(join(config.output, 'OBSERVATIONS.json'), { observations, count: observations.length, matched: observations.filter((row) => row.matched).length, productImports: 0, productRuns: 0, compile: 0, build: 0 });
  console.log(JSON.stringify({ completed: observations.length, matched: observations.filter((row) => row.matched).length, output: config.output }));
}
