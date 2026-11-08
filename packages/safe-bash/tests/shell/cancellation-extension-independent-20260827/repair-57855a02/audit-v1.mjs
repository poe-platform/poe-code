import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { own, repository, prefix, oldLayer, candidate, authorFreeze, independentFreeze, helperPath, expectedSource,
  sha256, objectId, json, write, writeJson, inventory, objectCollector, treeEntries, git, foreignIndex } from './support-v1.mjs';

const evidence = join(own, 'evidence-v1');
function decode(proof) {
  const objects = new Map();
  for (const object of proof.objects) {
    const bytes = Buffer.from(object.base64, 'base64');
    assert.equal(objectId(object.type, bytes), object.oid);
    assert.equal(sha256(bytes), object.sha256);
    assert.equal(bytes.length, object.size);
    objects.set(object.oid, { ...object, bytes });
  }
  function get(type, identifier) {
    assert.equal(objects.get(identifier)?.type, type, `archived ${type} ${identifier}`);
    return objects.get(identifier).bytes;
  }
  const root = commit => get('commit', commit).toString().match(/^tree (.+)$/m)[1];
  function path(commit, filename) {
    let current = root(commit);
    let selected;
    for (const name of filename.split('/')) {
      selected = treeEntries(get('tree', current)).find(entry => entry.name === name);
      assert.ok(selected, `${commit}:${filename}`);
      current = selected.oid;
    }
    return selected;
  }
  for (const binding of proof.paths) {
    const selected = path(binding.commit, binding.path);
    assert.equal(selected.oid, binding.oid);
    assert.equal(selected.mode, binding.mode);
    if (binding.sha256) assert.equal(sha256(get(selected.type, selected.oid)), binding.sha256);
  }
  function differences(before, after, base = '') {
    if (before === after) return [];
    const left = before ? treeEntries(get('tree', before)) : [];
    const right = after ? treeEntries(get('tree', after)) : [];
    const changed = [];
    for (const name of [...new Set([...left, ...right].map(entry => entry.name))].sort()) {
      const previous = left.find(entry => entry.name === name);
      const current = right.find(entry => entry.name === name);
      if (previous?.oid === current?.oid && previous?.mode === current?.mode) continue;
      if ((previous?.type ?? 'tree') === 'tree' && (current?.type ?? 'tree') === 'tree') changed.push(...differences(previous?.oid, current?.oid, `${base}${name}/`));
      else changed.push(base + name);
    }
    return changed;
  }
  function members(identifier, base = '') {
    const rows = [];
    for (const entry of treeEntries(get('tree', identifier))) {
      const name = base + entry.name;
      if (entry.type === 'tree') rows.push(...members(entry.oid, name + '/'));
      else rows.push({ path: name, ...entry });
    }
    return rows;
  }
  return { get, root, path, differences, members, objects };
}

function verify() {
  const raw = JSON.parse(gunzipSync(readFileSync(join(evidence, 'raw-object-proof.json.gz'))));
  const proof = decode(raw);
  const auth = json(join(evidence, 'authentication.json'));
  assert.equal(proof.get('commit', candidate).toString().match(/^parent (.+)$/m)[1], authorFreeze);
  assert.deepEqual(proof.differences(proof.root(authorFreeze), proof.root(candidate)), [helperPath]);
  const ownChanges = proof.differences(proof.root(auth.ownParent), proof.root(independentFreeze));
  assert.equal(ownChanges.length, 3);
  assert.ok(ownChanges.every(filename => filename.startsWith(prefix + '/')));
  const helper = proof.get('blob', proof.path(candidate, helperPath).oid);
  const prior = proof.get('blob', proof.path(authorFreeze, helperPath).oid);
  assert.equal(sha256(helper), expectedSource);
  assert.equal(helper.toString().replace('  if (captured.kind === "throw" && classified?.role !== "invoke-option") {\n    return throwingSelection(state, captured.reason, classified);',
    '  if (captured.kind === "throw" && !classified) {\n    return throwingSelection(state, captured.reason);'), prior.toString());
  const frozen = JSON.parse(proof.get('blob', proof.path(independentFreeze, `${prefix}/FREEZE-v1.json`).oid));
  for (const [filename, digest] of Object.entries(frozen.files)) assert.equal(sha256(readFileSync(join(own, filename))), digest);
  const before = json(join(evidence, 'live-before.json'));
  const after = json(join(evidence, 'live-after.json'));
  assert.deepEqual(before.oldLayer, frozen.protectedOldLayer.members);
  assert.deepEqual(after.oldLayer, before.oldLayer);
  assert.deepEqual(inventory(oldLayer, own), before.oldLayer, 'only this exact append subtree excluded; detect all other additions');
  assert.deepEqual(before.originalStage1, after.originalStage1);
  assert.deepEqual(before.authorHistory, after.authorHistory);
  assert.equal(before.index.stagedBase64, after.index.stagedBase64);
  for (const preserved of auth.preserved) assert.equal(proof.path(authorFreeze, preserved.path).oid, proof.path(candidate, preserved.path).oid);
  const oldRows = proof.members(proof.path(candidate, relative(repository, oldLayer)).oid);
  assert.deepEqual(oldRows.map(entry => entry.path).sort(), Object.keys(before.oldLayer).filter(name => before.oldLayer[name].kind === 'file').sort());
  for (const entry of oldRows) {
    const bytes = readFileSync(join(oldLayer, entry.path));
    assert.equal(objectId('blob', bytes), entry.oid, 'old file path binds to raw committed tree');
    assert.equal(sha256(bytes), before.oldLayer[entry.path].sha256);
  }
  const fixtureBindings = json(join(evidence, 'fixture-bindings.json'));
  for (const binding of fixtureBindings.bindings) {
    const object = proof.path(binding.commit, binding.path);
    assert.equal(sha256(proof.get('blob', object.oid)), binding.sha256);
    assert.equal(fixtureBindings.members[binding.filename].sha256, binding.sha256);
  }
  assert.deepEqual(json(join(evidence, 'fixtures-after.json')), fixtureBindings.members);
  assert.deepEqual(json(join(evidence, 'tools-after.json')), json(join(evidence, 'tools-before.json')));
  const sourceBefore = json(join(evidence, 'source-before.json'));
  const sourceBuilt = json(join(evidence, 'source-after-build.json'));
  const removed = json(join(evidence, 'source-build-before-removal.json'));
  const movedBefore = json(join(evidence, 'moved-before.json'));
  const movedAfter = json(join(evidence, 'moved-after.json'));
  const names = ['old-positive', 'old-six-negative', 'extension-positive', 'extension-eight-negative'];
  assert.deepEqual(Object.keys(sourceBuilt).sort(), [...Object.keys(sourceBefore), 'tsconfig.json'].sort());
  assert.deepEqual(Object.keys(removed.source).sort(), [...Object.keys(sourceBuilt), ...names.flatMap(name => [`${name}-source.ts`, `tsconfig-${name}-source.json`])].sort());
  for (const [filename, value] of Object.entries(sourceBefore)) assert.deepEqual(removed.source[filename], value);
  assert.deepEqual(removed.build, json(join(evidence, 'build-before.json')));
  assert.deepEqual(Object.keys(movedAfter).sort(), [...Object.keys(movedBefore), ...names.flatMap(name => [`${name}-moved.ts`, `tsconfig-${name}-moved.json`])].sort());
  for (const filename of ['cancellation.js', 'cancellation.d.ts', 'package.json']) {
    assert.deepEqual(movedAfter[filename], movedBefore[filename]);
    assert.equal(sha256(readFileSync(join(evidence, 'artifacts', `${filename}.data`))), movedBefore[filename].sha256);
  }
  assert.equal(movedBefore['cancellation.d.ts'].sha256, auth.previousDeclarations.sha256);
  for (const [cohort, count] of [['extension12', 12], ['original12', 12], ['nearby4', 4], ['new2', 2]]) {
    const first = json(join(evidence, `${cohort}-isolated-summary.json`));
    assert.deepEqual(json(join(evidence, `${cohort}-moved-summary.json`)), first);
    assert.equal(first.tests, count);
    assert.equal(first.pass, count);
    assert.equal(first.exit + first.fail + first.cancelled + first.skipped + first.todo, 0);
  }
  for (const [name, count] of [['old-positive', 0], ['old-six-negative', 6], ['extension-positive', 0], ['extension-eight-negative', 8]]) {
    const sourceTypes = json(join(evidence, `${name}-source-diagnostics.json`));
    const movedTypes = json(join(evidence, `${name}-moved-diagnostics.json`));
    assert.equal(sourceTypes.diagnostics.length, count);
    assert.equal(movedTypes.diagnostics.length, count);
    assert.deepEqual(sourceTypes.diagnostics.map(entry => [entry.line, entry.code]), movedTypes.diagnostics.map(entry => [entry.line, entry.code]));
    assert.equal(movedTypes.loadedFiles.find(entry => entry.path === 'moved-internal/cancellation.d.ts').sha256, movedBefore['cancellation.d.ts'].sha256);
    assert.ok(!movedTypes.loadedFiles.some(entry => entry.path.endsWith('/cancellation.ts')));
  }
  const mutant = json(join(evidence, 'counterfactual.json'));
  assert.equal(mutant.candidateWitnessPassed, true);
  assert.equal(mutant.behavioralKill, true);
  assert.equal(mutant.revertedSourceSha256, sha256(prior));
  const reverted = json(join(evidence, 'revert-E07-summary.json'));
  assert.equal(reverted.tests, 1);
  assert.equal(reverted.fail, 1);
  assert.equal(reverted.records[0].pass, false);
  assert.match(readFileSync(join(evidence, 'revert-E07.stdout'), 'utf8'), /ERR_ASSERTION/);
  const revertBefore = json(join(evidence, 'revert-before.json'));
  const revertAfter = json(join(evidence, 'revert-after.json'));
  for (const [filename, value] of Object.entries(revertBefore)) assert.deepEqual(revertAfter[filename], value);
  assert.deepEqual(Object.keys(revertAfter).sort(), [...Object.keys(revertBefore), 'tsconfig.json', 'emitted', 'emitted/cancellation.js', 'emitted/cancellation.d.ts', 'emitted/package.json'].sort());
  const loads = readdirSync(evidence).filter(filename => filename.endsWith('-loads.jsonl'));
  assert.equal(loads.length, 9);
  let naturalTestChildren = 0;
  for (const filename of loads) {
    const rows = readFileSync(join(evidence, filename), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(rows.length, 2);
    for (const entry of rows) assert.equal(entry.diskSha256, entry.loadedSha256);
    const loadedHelper = rows.find(entry => entry.filename.endsWith('/cancellation.js'));
    const expected = filename.startsWith('revert-') ? revertAfter['emitted/cancellation.js'].sha256 : movedBefore['cancellation.js'].sha256;
    assert.equal(loadedHelper.loadedSha256, expected);
    const fixture = rows.find(entry => !entry.filename.endsWith('/cancellation.js'));
    assert.equal(fixture.loadedSha256, fixtureBindings.members[fixture.filename.split('/').at(-1)].sha256);
    const children = readFileSync(join(evidence, filename.replace('-loads.jsonl', '-children.jsonl')), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    for (const start of children.filter(entry => entry.kind === 'start')) {
      const exits = children.filter(entry => entry.kind === 'exit' && entry.pid === start.pid);
      assert.equal(exits.length, 1);
      assert.ok(Number.isInteger(exits[0].code));
      naturalTestChildren += 1;
    }
  }
  const launches = readdirSync(evidence).filter(filename => filename.endsWith('-process.json')).map(filename => json(join(evidence, filename)));
  for (const launch of launches) {
    assert.equal(launch.error, null);
    assert.equal(launch.signal, null);
    assert.ok(Number.isInteger(launch.exit));
    assert.equal(launch.executableSha256, json(join(evidence, 'tools-before.json')).node.sha256);
  }
  for (const name of ['historical-extension-audit', 'historical-commit-audit']) assert.equal(json(join(evidence, `${name}-process.json`)).exit, 0);
  const removal = json(join(evidence, 'source-build-removal.json'));
  assert.equal(removal.sourceAbsent && removal.buildAbsent && removal.enumeratedBeforeRemoval, true);
  const cleanup = json(join(evidence, 'scratch-cleanup.json'));
  assert.equal(cleanup.absent && cleanup.enumerated, true);
  assert.equal(existsSync(cleanup.path), false);
  if (existsSync(join(own, 'EVIDENCE-v1.json'))) assert.deepEqual(inventory(evidence), json(join(own, 'EVIDENCE-v1.json')).members, 'complete evidence membership including additions');
  const result = { verifiedAt: new Date().toISOString(), candidate, helperSha256: expectedSource, rawObjects: proof.objects.size, completeCandidateDelta: [helperPath], independentFreezeOwnedPaths: ownChanges.length,
    extension12: '12/12 isolated and moved', original12: '12/12 isolated and moved', nearby4: '4/4 isolated and moved', new2: '2/2 isolated and moved',
    originalTypes: 'positive pass; six targeted malformed rows in both modes', extensionTypes: 'positive pass; eight targeted malformed rows in both modes',
    counterfactual: 'exact revert compiles/loads; candidate-passing E07 fails', authenticatedRuntimeLoads: loads.length, naturalLaunches: launches.length, naturalTestChildren,
    oldLayerMembers: oldRows.length, onlyAuthorizedAppendExcluded: true, oldHistoriesRescored: false, sourceRemovedBeforeMoved: true, scratchRemoved: true,
    verdict: 'PASS bounded B01 helper repair', stage2Authorized: false };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function captureCommit(commit) {
  assert.match(commit, /^[0-9a-f]{40}$/);
  const collector = objectCollector();
  const raw = collector.keep('commit', commit).toString();
  const parent = raw.match(/^parent (.+)$/m)[1];
  collector.bind(commit, prefix, false, true);
  collector.bind(parent, prefix, false, true);
  const rows = git('ls-tree', '-r', '-z', commit, '--', prefix).toString().split('\0').filter(Boolean).map(row => /^(\d+) (\w+) ([0-9a-f]{40})\t([\s\S]+)$/.exec(row));
  const members = rows.map(row => {
    const bytes = readFileSync(join(repository, row[4]));
    assert.equal(objectId('blob', bytes), row[3]);
    return { path: row[4], mode: row[1], blob: row[3], sha256: sha256(bytes), size: bytes.length };
  });
  const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit).toString().split('\0').filter(Boolean);
  assert.ok(changed.every(filename => filename.startsWith(prefix + '/')));
  const index = foreignIndex();
  const proof = { ...collector.snapshot(), commit, parent, members, changed, index, capturedAt: new Date().toISOString(), evidenceManifestSha256: sha256(readFileSync(join(own, 'EVIDENCE-v1.json'))) };
  write(join(own, 'COMMIT-PROOF-v1.json.gz'), gzipSync(JSON.stringify(proof)));
  return verifyCommit();
}
function verifyCommit() {
  const raw = JSON.parse(gunzipSync(readFileSync(join(own, 'COMMIT-PROOF-v1.json.gz'))));
  const proof = decode(raw);
  assert.equal(proof.get('commit', raw.commit).toString().match(/^parent (.+)$/m)[1], raw.parent);
  assert.deepEqual(proof.differences(proof.root(raw.parent), proof.root(raw.commit)), [...raw.changed].sort());
  assert.ok(raw.changed.every(filename => filename.startsWith(prefix + '/')));
  for (const entry of raw.members) {
    const binding = proof.path(raw.commit, entry.path);
    assert.equal(binding.oid, entry.blob);
    assert.equal(binding.mode, entry.mode);
    const bytes = readFileSync(join(repository, entry.path));
    assert.equal(bytes.length, entry.size);
    assert.equal(sha256(bytes), entry.sha256);
    assert.equal(objectId('blob', bytes), entry.blob);
  }
  assert.equal(sha256(readFileSync(join(own, 'EVIDENCE-v1.json'))), raw.evidenceManifestSha256);
  const result = { verifiedAt: new Date().toISOString(), evidenceCommit: raw.commit, parent: raw.parent, rawObjects: proof.objects.size,
    changedOwnedPaths: raw.changed.length, boundMembers: raw.members.length, noLooseObjectAssumption: true, allChangesOwned: true };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[2] === 'verify') verify();
else if (process.argv[2] === 'seal') {
  const result = verify();
  writeJson(join(own, 'EVIDENCE-v1.json'), { version: 1, candidate, authorFreeze, independentFreeze, result, members: inventory(evidence) });
} else if (process.argv[2] === 'capture-commit') writeJson(join(own, 'COMMIT-AUDIT-v1.json'), captureCommit(process.argv[3]));
else if (process.argv[2] === 'verify-commit') verifyCommit();
else throw new Error('usage: audit-v1.mjs verify|seal|capture-commit FULL_COMMIT|verify-commit');
