import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { assertPublicAdmission, assertSourceMap, authorizeSources, canonical, expectedPackage, fixtureRoot, preparationRoot, requireFact, safePath, sha256, workspaceRoot } from './guards.mjs';
import { verifyFrozenV1 } from './frozen-v1.mjs';

const rootAuthority = JSON.parse(readFileSync(join(preparationRoot, 'SOURCE-AUTHORITY.json')));
const receipt = JSON.parse(readFileSync(join(preparationRoot, 'SOURCE-RECEIPT.json')));
const controls = JSON.parse(readFileSync(join(preparationRoot, 'CONTROLS.json'))).controls;
const git = (...args) => execFileSync('git', ['-C', workspaceRoot, ...args], { maxBuffer: 16 * 1024 * 1024, env: { PATH: process.env.PATH, GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
const scratch = mkdtempSync(join(preparationRoot, '.admission-'));
mkdirSync(join(preparationRoot, 'evidence'), { recursive: true });
const evidence = mkdtempSync(join(preparationRoot, 'evidence/admission-'));
const observations = [];
let admitted;
let artifacts;
let diff;
let failure;

function receiptControl(id, mutate, wrongHash = false) {
  const value = structuredClone(receipt);
  mutate(value);
  const raw = JSON.stringify(value);
  const path = join(scratch, id + '.json');
  writeFileSync(path, raw, { flag: 'wx' });
  return authorizeSources(path, wrongHash ? '0'.repeat(64) : sha256(raw));
}

function tarInventory(bytes, prefix) {
  requireFact(bytes.length <= 16 * 1024 * 1024 && bytes.length % 512 === 0, 'TAR_DATA_SIZE');
  const files = {};
  let offset = 0;
  const text = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/su, '');
  const octal = value => { requireFact(/^[0-7]+ *$/u.test(value), 'TAR_OCTAL'); return parseInt(value, 8); };
  while (offset < bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) {
      requireFact(bytes.subarray(offset).every(value => value === 0), 'TAR_TRAILING_DATA');
      return files;
    }
    const storedChecksum = octal(text(header, 148, 8).trim());
    const checksum = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
    requireFact(storedChecksum === checksum, 'TAR_CHECKSUM');
    requireFact(header[156] === 0 || header[156] === 48, 'TAR_REGULAR_ONLY');
    const leading = text(header, 345, 155);
    const name = (leading ? leading + '/' : '') + text(header, 0, 100);
    requireFact(name.startsWith(prefix), 'TAR_PREFIX');
    const path = safePath(name.slice(prefix.length));
    requireFact(!Object.hasOwn(files, path) && Object.keys(files).length < 2048, 'TAR_MEMBERSHIP');
    const size = octal(text(header, 124, 12).trim());
    const mode = octal(text(header, 100, 8).trim());
    requireFact(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= bytes.length, 'TAR_SIZE');
    const payload = bytes.subarray(offset + 512, offset + 512 + size);
    files[path] = { sha256: sha256(payload), bytes: payload.length, mode };
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('TAR_MISSING_END');
}

function authenticateArtifactData() {
  const readArtifact = binding => {
    const raw = git('show', `${rootAuthority.evidenceCommit}:${binding.path}`);
    requireFact(sha256(raw) === binding.sha256, 'ROOT_ARTIFACT_HASH', binding.path);
    return raw;
  };
  const sourceBytes = readArtifact(rootAuthority.archive);
  const packageBytes = readArtifact(rootAuthority.package);
  const sourceFiles = tarInventory(sourceBytes, '');
  const packageFiles = tarInventory(gunzipSync(packageBytes, { maxOutputLength: 16 * 1024 * 1024 }), 'package/');
  const baseline = JSON.parse(readFileSync(join(fixtureRoot, 'BASELINE-PACKAGE.json')));
  const selected = JSON.parse(readFileSync(join(fixtureRoot, 'SELECTED.json')));
  const additions = {};
  for (const path of Object.keys(receipt.sourceAdditions).filter(path => path.endsWith('.ts'))) {
    for (const extension of ['.js', '.js.map', '.d.ts', '.d.ts.map']) {
      const output = path.replace(/^src\//u, 'dist/').replace(/\.ts$/u, extension);
      requireFact(Object.hasOwn(packageFiles, output), 'PACKAGE_OUTPUTS', output);
      additions[output] = packageFiles[output];
    }
  }
  const directories = { '': 493 };
  for (const path of Object.keys(packageFiles)) {
    const parts = path.split('/');
    for (let count = 1; count < parts.length; count++) directories[parts.slice(0, count).join('/')] = 493;
  }
  const fullReceipt = { ...receipt, packageAdditions: additions, packageDirectories: directories, entries: { yq: 'dist/commands/yq/index.js', contracts: 'dist/contracts/index.js' } };
  const expected = expectedPackage(fullReceipt, baseline, selected.readme);
  assert.deepEqual(packageFiles, expected.files);
  assert.equal(Object.keys(packageFiles).length, Object.keys(baseline).length + Object.keys(additions).length);
  const supportFiles = {};
  for (const path of ['package-lock.json', 'scripts/typecheck.mjs']) {
    const entry = git('ls-tree', '-z', receipt.sourceBase, '--', path).toString().split('\0').filter(Boolean);
    requireFact(entry.length === 1 && entry[0].split('\t')[1] === path && entry[0].startsWith('100644 blob '), 'SOURCE_SUPPORT_ORIGIN');
    const bytes = git('show', `${receipt.sourceBase}:${path}`);
    supportFiles[path] = { sha256: sha256(bytes), bytes: bytes.length, mode: 420 };
  }
  assert.deepEqual(sourceFiles, { ...admitted.sourceFiles, ...supportFiles });
  return {
    role: 'IMMUTABLE_ARTIFACT_DATA_AUTHENTICATION_NOT_PRODUCT_OR_MATERIALIZATION_EXECUTION',
    sourceArchiveSha256: sha256(sourceBytes), sourceArchiveMembers: Object.keys(sourceFiles).length,
    sourceGuardMembers: Object.keys(admitted.sourceFiles).length, separateSourceMaterializationGap: Object.keys(supportFiles),
    packageSha256: sha256(packageBytes), packageMembers: Object.keys(packageFiles).length,
    baselineMembers: Object.keys(baseline).length, authorizedPackageAdditions: Object.keys(additions).length,
    readme: packageFiles['README.md'], packageMapSha256: sha256(canonical(expected)),
  };
}

function verifyMinimalDiff() {
  const originalGuard = readFileSync(join(fixtureRoot, 'guards.mjs'), 'utf8');
  const currentGuard = readFileSync(join(preparationRoot, 'guards.mjs'), 'utf8');
  const maskSourceFunction = text => {
    const start = text.indexOf('export function authorizeSources(');
    const end = text.indexOf('export function assertSourceMaterialization(', start);
    requireFact(start >= 0 && end > start, 'DIFF_BOUNDARY');
    return text.slice(0, start) + 'SOURCE_AUTHORIZATION_BODY\n' + text.slice(end);
  };
  const expectedGuard = originalGuard.replace('export const preparationRoot', "import { fixtureRoot, verifyFrozenV1 } from './frozen-v1.mjs';\nexport { fixtureRoot } from './frozen-v1.mjs';\n\nexport const preparationRoot")
    .replace('join(preparationRoot, name)', 'join(fixtureRoot, name)')
    .replace('export function verifyPreseal() {', 'export function verifyPreseal() {\n  verifyFrozenV1();')
    .replace('join(preparationRoot, safePath(path))', 'join(fixtureRoot, safePath(path))');
  assert.equal(maskSourceFunction(currentGuard), maskSourceFunction(expectedGuard));
  const originalTypes = readFileSync(join(fixtureRoot, 'type-worker.mjs'), 'utf8');
  const expectedTypes = originalTypes.replace('copyRegularTree, inspectTree', 'copyRegularTree, fixtureRoot, inspectTree')
    .replaceAll("join(preparationRoot, 'SELECTED.json')", "join(fixtureRoot, 'SELECTED.json')")
    .replaceAll("join(preparationRoot, 'JOBS.json')", "join(fixtureRoot, 'JOBS.json')")
    .replaceAll('join(preparationRoot, job.fixture)', 'join(fixtureRoot, job.fixture)');
  assert.equal(readFileSync(join(preparationRoot, 'type-worker.mjs'), 'utf8'), expectedTypes);
  const originalSynthetic = readFileSync(join(fixtureRoot, 'synthetic-check.mjs'), 'utf8');
  let expectedSynthetic = originalSynthetic.replace('expectedPackage, preparationRoot', 'expectedPackage, fixtureRoot, preparationRoot');
  for (const name of ['NEGATIVE-CASES.json', 'JOBS.json', 'COVERAGE.json', 'SELECTED.json']) expectedSynthetic = expectedSynthetic.replaceAll(`join(preparationRoot, '${name}')`, `join(fixtureRoot, '${name}')`);
  expectedSynthetic = expectedSynthetic.replaceAll('join(preparationRoot, job.fixture)', 'join(fixtureRoot, job.fixture)')
    .replace('sha256(readFileSync(join(preparationRoot, path)))', "sha256(readFileSync(join(['PRESEAL.json', 'PRETEST-CLARIFICATIONS.md'].includes(path) ? fixtureRoot : preparationRoot, path)))")
    .replace("presealCommit: '21ad8c589d7f138064616e8f37e748e6a2e7c200'", "presealCommit: '61cec1d71bf1121234de8ee727da990ff29c54e8', originalV1Commit: '409449136ae1adc252ff6e205a6bb5785d113d0f', fixtureRoot");
  assert.equal(readFileSync(join(preparationRoot, 'synthetic-check.mjs'), 'utf8'), expectedSynthetic);
  assert.deepEqual(readFileSync(join(preparationRoot, 'verify-recipe.mjs')), readFileSync(join(fixtureRoot, 'verify-recipe.mjs')));
  return { scope: 'Only authorizeSources behavior plus explicit frozen-input/root/provenance plumbing', allOtherGuardCodeIdentical: true, typeWorkerBehaviorIdentical: true, all36SyntheticControlsIdentical: true, verifierBytesIdentical: true, v1GuardSha256: sha256(originalGuard), v2GuardSha256: sha256(currentGuard) };
}

const cases = {
  'selected-composition'() {
    admitted = authorizeSources(join(preparationRoot, 'SOURCE-RECEIPT.json'), '0b2a4bb3f6e7ff878f6c17f2237363811376edc1fbcdd5aa7499759705ecd170');
    assert.equal(admitted.expected, null);
    assert.equal(Object.keys(admitted.sourceFiles).length, Object.keys(JSON.parse(readFileSync(join(fixtureRoot, 'SOURCE-BASE.json')))).length + Object.keys(receipt.sourceAdditions).length);
    assert.equal(admitted.sourceFiles['README.md'].sha256, '87e92b73c7339b104212a9fb11006d339694f65575a7b79debfaa902ef9cf9d1');
  },
  'wrong-baseline'() { receiptControl('wrong-baseline', value => { value.sourceBase = receipt.candidateCommit; }); },
  'wrong-length'() { receiptControl('wrong-length', value => { value.acceptedLength = receipt.sourceBase; }); },
  'wrong-new-source-bytes'() { receiptControl('wrong-new-source-bytes', value => { value.sourceAdditions['src/commands/yq/index.ts'].sha256 = '0'.repeat(64); }); },
  'wrong-new-source-mode'() { receiptControl('wrong-new-source-mode', value => { value.sourceAdditions['src/commands/yq/index.ts'].mode = 384; }); },
  'unapproved-yq-addition'() { receiptControl('unapproved-yq-addition', value => { value.sourceAdditions['src/commands/yq/unapproved.ts'] = value.sourceAdditions['src/commands/yq/index.ts']; }); },
  'unapproved-root-edit'() { receiptControl('unapproved-root-edit', value => { value.sourceAdditions['src/index.ts'] = value.sourceAdditions['src/commands/yq/index.ts']; }); },
  'missing-authorized-new-path'() { receiptControl('missing-authorized-new-path', value => { delete value.sourceAdditions['src/commands/yq/index.ts']; }); },
  'mutable-head-origin'() { receiptControl('mutable-head-origin', value => { value.candidateCommit = 'HEAD'; }); },
  'wrong-fixed-origin'() { receiptControl('wrong-fixed-origin', value => { value.candidateCommit = receipt.sourceBase; }); },
  'invented-source-overrides'() { receiptControl('invented-source-overrides', value => { value.sourceOverrides = {}; }); },
  'receipt-hash-mismatch'() { receiptControl('receipt-hash-mismatch', () => {}, true); },
  'composed-baseline-edit'() { const modified = structuredClone(admitted.sourceFiles); modified['README.md'].sha256 = '0'.repeat(64); assertSourceMap(modified, admitted.sourceFiles); },
  'composed-source-extra'() { const modified = structuredClone(admitted.sourceFiles); modified['src/commands/yq/unapproved.ts'] = modified['README.md']; assertSourceMap(modified, admitted.sourceFiles); },
  'composed-readme-missing'() { const modified = structuredClone(admitted.sourceFiles); delete modified['README.md']; assertSourceMap(modified, admitted.sourceFiles); },
  'full870-baseline-readme'() { artifacts = authenticateArtifactData(); },
  'public-export-gap'() { assertPublicAdmission(); },
};

try {
  verifyFrozenV1();
  diff = verifyMinimalDiff();
  assert.deepEqual(Object.keys(cases).sort(), controls.map(control => control.id).sort());
  for (const control of controls) {
    let caught;
    try { cases[control.id](); } catch (error) { caught = error; }
    const positive = ['ADMISSION', 'PACKAGE_DATA_ADMISSION'].includes(control.outcome);
    const matched = positive ? caught === undefined : caught?.code === control.outcome;
    observations.push({ id: control.id, expected: control.outcome, actual: caught?.code ?? (caught ? 'UNEXPECTED_ERROR' : control.outcome), matched, message: caught?.message ?? null, role: control.role });
    requireFact(matched, 'CONTROL_MISMATCH', control.id);
  }
  verifyFrozenV1();
} catch (error) {
  failure = error;
} finally {
  rmSync(scratch, { recursive: true });
  const result = { schema: 2, date: '2026-08-28', role: 'SOURCE_COMPOSITION_CORRECTION_AUTHOR_DATA_EVIDENCE_REVIEW_PENDING', observations, declared: controls.length, matched: observations.filter(row => row.matched).length, diff, sourceMapSha256: admitted?.sourceMapSha256 ?? null, artifacts, helperHashes: Object.fromEntries(['guards.mjs', 'frozen-v1.mjs', 'type-worker.mjs', 'validate.mjs'].map(path => [path, sha256(readFileSync(join(preparationRoot, path)))])), failure: failure ? { message: failure.message, stack: failure.stack } : null, productExecutions: 0, productImports: 0, builds: 0, typeCompiles: 0, packageReplays: 0, semanticResults: [], independentReview: 'PENDING_ROOT_ROUTING' };
  writeFileSync(join(evidence, 'RESULTS.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ evidence, declared: result.declared, matched: result.matched, failure: result.failure, productExecution: 0 }));
}
if (failure) process.exitCode = 1;
