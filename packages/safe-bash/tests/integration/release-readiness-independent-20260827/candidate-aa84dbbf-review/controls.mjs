import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { base, candidate, capture, environment, evidence, frozen, git, inventory, load, node, productRevision, save, scratch, sha } from './review.mjs';

Object.assign(process.env, environment);
const definitions = JSON.parse(readFileSync(join(frozen, 'cases.json'))).cases;
const boundary = JSON.parse(readFileSync(join(frozen, 'boundary.json')));
const matrix = [];
const work = join(scratch, 'independent-controls'); mkdirSync(work);
const tree = await load(base + 'integrity-73/tree.mjs');
const classification = await load('tests/plugins/qualified-current-release/inventory-check.mjs');
const consumers = await load('tests/plugins/qualified-current-release/consumers.mjs');
const native = await load(base + 'preflight-repair/preflight.mjs');
const profile = await load(base + 'candidate-profile-73/prepare.mjs');
const frozenTools = await import(pathToFileURL(join(frozen, 'fixture-tools.mjs')).href);
const check = callback => { try { const result = callback(); return { accepted: true, result }; } catch (error) { return { accepted: false, rejection: String(error.stack) }; } };
async function record(id, target, callback, method = 'actual-candidate-api') {
  const definition = definitions.find(row => row.id === id); assert.ok(definition);
  let result;
  try {
    const observation = await callback();
    result = { ...definition, target, method, observed: observation.accepted ? 'accept' : 'reject', status: observation.accepted === (definition.expected === 'accept') ? 'PASS' : 'FAIL', observation };
  } catch (error) { result = { ...definition, target, method, status: 'NOTEXECUTED', limitation: 'Adapter/setup failure, not candidate rejection', error: String(error.stack) }; }
  save(id + '.json', result); matrix.push(result); console.log(id, result.status);
}
for (const definition of definitions.filter(row => row.group === 'inventory')) await record(definition.id, base + 'integrity-73/tree.mjs#createTreeGuard', () => {
  const root = join(work, definition.id); mkdirSync(root); writeFileSync(join(root, 'input'), 'before\n'); mkdirSync(join(root, 'empty')); symlinkSync('input', join(root, 'link'));
  const beforeSetup = tree.createTreeGuard(root);
  if (definition.id === 'inventory-postsetup-baseline') { mkdirSync(join(root, 'dist')); writeFileSync(join(root, 'dist/setup-output'), 'legitimate setup artifact\n'); assert.ok(beforeSetup.check().changes.length); }
  const guard = tree.createTreeGuard(root);
  const actions = {
    'inventory-added-file': () => writeFileSync(join(root, 'new-input'), 'addition\n'),
    'inventory-added-empty-directory': () => mkdirSync(join(root, 'new-empty')),
    'inventory-removed-file': () => rmSync(join(root, 'input')),
    'inventory-modified-bytes': () => writeFileSync(join(root, 'input'), 'after!\n'),
    'inventory-file-to-directory': () => { rmSync(join(root, 'input')); mkdirSync(join(root, 'input')); },
    'inventory-directory-to-file': () => { rmSync(join(root, 'empty'), { recursive: true }); writeFileSync(join(root, 'empty'), 'replacement'); },
    'inventory-file-to-symlink': () => { rmSync(join(root, 'input')); symlinkSync('missing', join(root, 'input')); },
    'inventory-symlink-retarget': () => { rmSync(join(root, 'link')); symlinkSync('missing', join(root, 'link')); },
    'inventory-new-symlink': () => symlinkSync('input', join(root, 'new-link')),
    'inventory-new-dangling-symlink': () => symlinkSync('missing', join(root, 'dangling')),
    'inventory-symlink-to-file': () => { rmSync(join(root, 'link')); writeFileSync(join(root, 'link'), 'replacement'); },
    'inventory-mode-change': () => chmodSync(join(root, 'input'), 0o700),
  };
  actions[definition.id]?.(); const observation = guard.check();
  return { accepted: observation.changes.length === 0, before: guard.before(), ...observation };
});
const failClosedRoot = join(work, 'removed-root'); mkdirSync(failClosedRoot); const removedGuard = tree.createTreeGuard(failClosedRoot); rmSync(failClosedRoot, { recursive: true });
save('inventory-failclosed-root.json', removedGuard.check()); assert.equal(removedGuard.check().changes[0].kind, 'unreadable');
const policy = JSON.parse(readFileSync(join(candidate, base, 'combined-8670ebe8/policy.json')));
const recovery = JSON.parse(readFileSync(join(candidate, base, 'native-recovery-73/RECOVERY.json')));
const rg = policy.native.find(entry => entry.name === 'rg'); assert.equal(rg.sha256, boundary.nativeRg.expectedSha256);
for (const definition of definitions.filter(row => row.group === 'asset')) await record(definition.id, base + 'preflight-repair/preflight.mjs#assessNative', () => {
  const path = join(work, definition.id + '.asset');
  const accepted = Buffer.from('independent inert native asset fixture v1\n'); assert.equal(sha(accepted), '6afe59dd4b71ade0d4a735e1a361776c4644c1e5938da6a11413ef19633a95a0');
  if (definition.id !== 'asset-missing') writeFileSync(path, definition.id === 'asset-wrong-bytes' ? 'wrong asset\n' : accepted);
  const requirement = definition.id === 'asset-rg-observed-not-expected' ? rg : { name: 'frozen-inert', origin: path, executable: false, sha256: sha(accepted) };
  if (definition.id === 'asset-rg-observed-not-expected') assert.equal(sha(readFileSync(rg.origin)), boundary.nativeRg.observedSha256);
  const assessed = native.assessNative([requirement], candidate, {}); return { accepted: assessed.issues.length === 0, ...assessed };
});
const recoverApi = await load(base + 'native-recovery-73/recover.mjs');
const retainedPaths = [recovery.retained.path, recovery.recovered.path];
const recoveredTarget = join(work, 'recovered-rg');
const recovered = recoverApi.copyAcceptedAsset(recovery.recovered.path, recoveredTarget);
const nativeProvenance = { policySha256: sha(readFileSync(join(candidate, base, 'combined-8670ebe8/policy.json'))), authorReceiptSha256: sha(readFileSync(join(candidate, base, 'native-recovery-73/RECOVERY.json'))), origins: retainedPaths.map(path => ({ path, available: existsSync(path), sha256: existsSync(path) ? sha(readFileSync(path)) : null })), recovered, requirement: rg, installedOrigin: { path: rg.origin, sha256: sha(readFileSync(rg.origin)) }, assessed: native.assessNative([{ ...rg, originEnv: 'RG_NATIVE_BIN' }], candidate, { RG_NATIVE_BIN: recoveredTarget }) };
assert.equal(nativeProvenance.assessed.issues.length, 0); capture('accepted-rg-version', recoveredTarget, ['--version']); capture('installed-rg-version', rg.origin, ['--version']);
save('native-provenance-recovery.json', nativeProvenance);
const actualInventory = JSON.parse(readFileSync(join(candidate, 'tests/plugins/qualified-current-release/inventory.json')));
const paths = JSON.parse(readFileSync(join(evidence, 'candidate-git-inputs.json'))).map(row => row.path);
const read = path => readFileSync(join(candidate, path));
const verify = (value = actualInventory, current = consumers.currentConsumerPaths(), negatives = consumers.negativeGroups.map(group => group.path), reader = read) => classification.verifyInventory(value, paths, current, negatives, reader);
const priorInventory = JSON.parse(git(['show', 'd5f068cd3649c09c6e4573645b64de505875adc3:tests/plugins/qualified-current-release/inventory.json']));
for (const entry of priorInventory.entries) assert.deepEqual(actualInventory.entries.find(row => row.path === entry.path), entry);
save('actual-eleven-classifications.json', { counts: verify(), priorEntriesPreserved: priorInventory.entries.length, paths: boundary.individualMts.map(fixed => ({ frozen: fixed, actual: actualInventory.entries.find(entry => entry.path === fixed.path), actualSha256: sha(read(fixed.path)), route: consumers.consumerGroups.filter(group => [...group.files, ...group.companions ?? []].includes(fixed.path)) })), groups: consumers.consumerGroups, negatives: consumers.negativeGroups });
for (const definition of definitions.filter(row => row.group === 'classification')) await record(definition.id, 'tests/plugins/qualified-current-release/inventory-check.mjs#verifyInventory', () => {
  const modified = structuredClone(actualInventory); let current = consumers.currentConsumerPaths(), negatives = consumers.negativeGroups.map(group => group.path), reader = read;
  const history = actualInventory.entries.find(entry => boundary.individualMts.some(fixed => fixed.path === entry.path) && entry.freeze);
  const declaration = actualInventory.entries.find(entry => boundary.individualMts.some(fixed => fixed.path === entry.path) && entry.classification === 'declaration');
  if (definition.id === 'classification-omission') {
    const omissions = boundary.individualMts.map(fixed => { const value = structuredClone(actualInventory); value.entries = value.entries.filter(entry => entry.path !== fixed.path); return { path: fixed.path, ...check(() => verify(value)) }; });
    return { accepted: omissions.some(row => row.accepted), omissions };
  }
  if (definition.id === 'classification-invalid') modified.entries[0].classification = 'ignore';
  if (definition.id === 'classification-multiple') modified.entries.push({ ...modified.entries[0], classification: 'declaration' });
  if (definition.id === 'classification-current-unrouted') current = current.filter(path => path !== 'tests/commands/grep-aliases/consumer.mts');
  if (definition.id === 'classification-negative-unrouted') negatives = [];
  if (definition.id === 'classification-historical-changed') reader = path => path === history.path ? Buffer.from('changed history') : read(path);
  if (definition.id === 'classification-declaration-changed') reader = path => path === declaration.path ? Buffer.from('changed declaration') : read(path);
  if (definition.id === 'classification-freeze-evidence-changed') reader = path => path === history.freeze.evidence[0].path ? Buffer.from('changed evidence') : read(path);
  if (definition.id === 'classification-historical-not-current-pass') assert.ok(!current.includes(history.path));
  return { ...check(() => verify(modified, current, negatives, reader)), historyTarget: history.path, declarationTarget: declaration.path };
});
const prepared = join(work, 'profile'); const preparedReceipt = profile.prepare(productRevision, prepared); save('independent-prepared-receipt.json', preparedReceipt);
assert.equal(preparedReceipt.cleanupInputs, 244);
assert.deepEqual(JSON.parse(readFileSync(join(prepared, 'cleanup-expected.json'))), boundary.cleanupObservation);
for (const definition of definitions.filter(row => row.group === 'cleanup')) await record(definition.id, base + 'candidate-profile-73/prepare.mjs#verifyPrepared', () => {
  const directory = join(work, definition.id); cpSync(prepared, directory, { recursive: true });
  const file = join(directory, 'cleanup-expected.json'), envelope = JSON.parse(readFileSync(file)), first = Object.keys(envelope.files)[0];
  if (definition.id === 'cleanup-missing-source') delete envelope.files[first];
  if (definition.id === 'cleanup-stale-source') envelope.files[first] = sha('stale source');
  if (definition.id === 'cleanup-swapped-path') { envelope.files['src/not-approved.ts'] = envelope.files[first]; delete envelope.files[first]; }
  if (definition.id === 'cleanup-wrong-revision') envelope.revision = boundary.revision;
  if (definition.id === 'cleanup-wrong-tree') envelope.tree = '0'.repeat(40);
  writeFileSync(file, JSON.stringify(envelope, null, 2) + '\n');
  const receiptPath = join(directory, 'RECEIPT.json'), receipt = JSON.parse(readFileSync(receiptPath)); receipt.files['cleanup-expected.json'] = sha(readFileSync(file)); writeFileSync(receiptPath, JSON.stringify(receipt));
  return { ...check(() => profile.verifyPrepared(directory, productRevision)), manifest: envelope, rehashedOuterReceipt: true };
});
const actualMigrations = boundary.migrations.map(entry => {
  const before = git(['show', `${boundary.observationRevision}:${entry.path}`]), after = read(entry.path);
  assert.equal(after.toString(), before.toString().replaceAll('70', '73'));
  return { path: entry.path, beforeSha256: sha(before), afterSha256: sha(after), changes: before.toString().split('\n').flatMap((line, index) => line === after.toString().split('\n')[index] ? [] : [{ line: index + 1, before: line, after: after.toString().split('\n')[index] }]) };
});
const commitChanges = git(['diff-tree', '--no-commit-id', '--name-only', '-r', '7d1cebf615d805f7f0077c0f9150fbe87462c1b1']).toString().trim().split('\n');
assert.deepEqual(commitChanges.sort(), boundary.migrations.map(row => row.path).sort());
save('exact-count-migration-audit.json', { actualMigrations, commitChanges, scope: 'Entire count patch changes exactly two fixtures; historical fixtures outside patch unchanged. Other twenty-file changes remain separate.' });
for (const definition of definitions.filter(row => row.group === 'counts')) await record(definition.id, 'frozen0895926b#migrations plus authenticated candidate fixture bytes', () => {
  const changes = boundary.migrations.map(({ path, from, to, assertionLines }) => ({ path, from, to, assertionLines }));
  if (definition.id === 'counts-one-migration') changes.pop();
  if (definition.id === 'counts-historical-rewrite') changes.push({ path: 'tests/plugins/stream-five-public/current-profile.mjs', from: 70, to: 73 });
  if (definition.id === 'counts-wrong-value') changes[0].to = 74;
  return { ...check(() => frozenTools.migrations(changes)), changes, additionalActualExecution: 'count-migration-driver: original, revised, wrong-count-control; no claim this independent audit is a candidate gate hook' };
}, 'independent-frozen-input-audit');
for (const definition of definitions.filter(row => row.group === 'binding')) {
  const result = { ...definition, target: 'candidate-template.json#candidateParameters', method: 'not-substituted', status: 'NOTEXECUTED', limitation: 'No single full successor gate/source/package/native/classification/244 binding was declared. Infrastructure522 and productc355 are deliberately distinct. Original synthetic reference selfcheck covers structure only; do not fabricate unified binding or rescore it as candidate execution.' };
  save(definition.id + '.json', result); matrix.push(result);
}
save('matrix-part1.json', matrix);
save('controls-inputs-after.json', inventory(work));
