import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const own = dirname(fileURLToPath(import.meta.url));
const repository = resolve(own, '../../..');
const evidence = join(own, 'evidence-v2');
const candidate = '373437cf84424939e1792470805cdd9e60bd3898';
const authorFreeze = '88d91975e4a718fb3c1b55322e44492cf4059391';
const independentFreeze = 'cbed682564e1e3b1c2ac8062157ece7b8b997f30';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const oid = (type, value) => createHash('sha1').update(`${type} ${value.length}\0`).update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
const json = filename => JSON.parse(readFileSync(filename));
function write(filename, value) { writeFileSync(filename, value, { flag: 'wx' }); }
function writeJson(filename, value) { write(filename, JSON.stringify(value, null, 2) + '\n'); }
function entries(bytes) {
  const result = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const space = bytes.indexOf(32, cursor);
    const zero = bytes.indexOf(0, space);
    assert.ok(space > cursor && zero > space);
    const mode = bytes.subarray(cursor, space).toString();
    result.push({ mode, name: bytes.subarray(space + 1, zero).toString(), oid: bytes.subarray(zero + 1, zero + 21).toString('hex'), type: mode === '40000' ? 'tree' : mode === '160000' ? 'commit' : 'blob' });
    cursor = zero + 21;
  }
  assert.equal(cursor, bytes.length);
  return result;
}
function inventory(directory) {
  const members = {};
  function visit(filename) {
    const info = lstatSync(filename);
    assert.equal(info.isSymbolicLink(), false);
    const name = relative(directory, filename) || '.';
    if (info.isDirectory()) {
      members[name] = { kind: 'directory', mode: info.mode & 0o777 };
      for (const child of readdirSync(filename).sort()) visit(join(filename, child));
    } else {
      assert.ok(info.isFile());
      members[name] = { kind: 'file', mode: info.mode & 0o777, size: info.size, sha256: sha256(readFileSync(filename)) };
    }
  }
  visit(directory);
  return members;
}

function collect() {
  const objects = new Map();
  const bindings = [];
  function keep(type, identifier) {
    if (!objects.has(identifier)) {
      const bytes = git('cat-file', type, identifier);
      assert.equal(oid(type, bytes), identifier);
      objects.set(identifier, { type, oid: identifier, size: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') });
    }
    return Buffer.from(objects.get(identifier).base64, 'base64');
  }
  function bind(commit, path, contents = false) {
    let tree = keep('commit', commit).toString().match(/^tree (.+)$/m)[1];
    let selected;
    for (const name of path.split('/')) {
      selected = entries(keep('tree', tree)).find(entry => entry.name === name);
      assert.ok(selected, `${commit}:${path}`);
      tree = selected.oid;
    }
    if (contents || selected.type === 'tree') keep(selected.type, selected.oid);
    bindings.push({ commit, path, oid: selected.oid, type: selected.type, ...(contents ? { sha256: sha256(keep(selected.type, selected.oid)) } : {}) });
    return selected;
  }
  for (const directory of ['tests/shell/cancellation-stage1-independent-20260827', 'tests/shell/cancellation-stage1-20260827']) {
    const selected = bind(candidate, directory);
    const visit = identifier => {
      for (const entry of entries(keep('tree', identifier))) if (entry.type === 'tree') visit(entry.oid);
    };
    visit(selected.oid);
  }
  const ownParent = keep('commit', independentFreeze).toString().match(/^parent (.+)$/m)[1];
  bind(ownParent, 'tests/shell');
  bind(independentFreeze, 'tests/shell');
  const exposures = [
    ...['82687013db952e765b81db458410777850982ef5', '7958e786c9566653d8da693e7d991a6f63de08a0', '90499562b73767fa983cd675b8349afbd2acd58d']
      .flatMap(commit => ['DESIGN.md', 'identity.json'].map(name => [commit, `tests/shell/cancellation-stage2-author-20260827/design-v1/${name}`])),
    ['82687013db952e765b81db458410777850982ef5', 'tests/shell/cancellation-stage1-20260827/accepted-fbbe1ef7-docs/ACCEPTANCE-CLARIFICATION.md'],
    ['82687013db952e765b81db458410777850982ef5', 'tests/shell/cancellation-stage1-20260827/accepted-fbbe1ef7-docs/identity.json'],
    ['98f400c4a33eeb03f825213054f90adc1fd979c4', 'tests/shell/cancellation-stage2-independent-20260827/HANDOFF.md'],
    ['647f42b9abf9f5abc4de3e36c74410b3bb63df3c', 'tests/shell/cancellation-stage1-independent-20260827/FREEZE-v1.md'],
    ['647f42b9abf9f5abc4de3e36c74410b3bb63df3c', 'tests/shell/cancellation-stage1-independent-20260827/CONCRETIZATION-v1.md'],
    ['647f42b9abf9f5abc4de3e36c74410b3bb63df3c', 'tests/shell/cancellation-stage1-independent-20260827/repair-fbbe1ef7/FREEZE-v1.md'],
    ['fbbe1ef793b7434871403125efbeb46624a8e081', 'src/shell/cancellation.ts'],
  ];
  for (const [commit, path] of exposures) bind(commit, path, true);
  write(join(evidence, 'supplemental-object-proof.json.gz'), gzipSync(JSON.stringify({ version: 1, objects: [...objects.values()], bindings,
    exposureQualification: 'Prior design/docs plus old independent fixture envelopes and accepted Stage1 declarations were exposed before this freeze. Full candidate/helper objects were acquired only after independent freeze. Author extension fixture bodies were not inspected or replayed.' })));
}

function verify() {
  const primary = JSON.parse(gunzipSync(readFileSync(join(evidence, 'raw-object-proof.json.gz'))));
  const supplemental = JSON.parse(gunzipSync(readFileSync(join(evidence, 'supplemental-object-proof.json.gz'))));
  const objects = new Map();
  for (const object of [...primary.objects, ...supplemental.objects]) {
    const bytes = Buffer.from(object.base64, 'base64');
    assert.equal(bytes.length, object.size);
    assert.equal(sha256(bytes), object.sha256);
    assert.equal(oid(object.type, bytes), object.oid);
    if (objects.has(object.oid)) assert.deepEqual(objects.get(object.oid).bytes, bytes);
    objects.set(object.oid, { ...object, bytes });
  }
  const get = (type, identifier) => {
    const object = objects.get(identifier);
    assert.ok(object, `archived ${type} ${identifier}`);
    assert.equal(object.type, type);
    return object.bytes;
  };
  const root = commit => get('commit', commit).toString().match(/^tree (.+)$/m)[1];
  function pathObject(commit, path) {
    let current = root(commit);
    let entry;
    for (const name of path.split('/')) {
      entry = entries(get('tree', current)).find(candidateEntry => candidateEntry.name === name);
      assert.ok(entry, `${commit}:${path}`);
      current = entry.oid;
    }
    return entry;
  }
  for (const binding of [...primary.paths, ...supplemental.bindings]) {
    const entry = pathObject(binding.commit, binding.path);
    assert.equal(entry.oid, binding.oid);
    if (binding.sha256) assert.equal(sha256(get(entry.type, entry.oid)), binding.sha256);
  }
  function differences(before, after, prefix = '') {
    if (before === after) return [];
    const previous = before ? entries(get('tree', before)) : [];
    const current = after ? entries(get('tree', after)) : [];
    const names = [...new Set([...previous, ...current].map(entry => entry.name))].sort();
    const changed = [];
    for (const name of names) {
      const left = previous.find(entry => entry.name === name);
      const right = current.find(entry => entry.name === name);
      if (left?.oid === right?.oid && left?.mode === right?.mode) continue;
      if ((left?.type ?? 'tree') === 'tree' && (right?.type ?? 'tree') === 'tree') changed.push(...differences(left?.oid, right?.oid, `${prefix}${name}/`));
      else changed.push(prefix + name);
    }
    return changed;
  }
  assert.equal(get('commit', candidate).toString().match(/^parent (.+)$/m)[1], authorFreeze);
  assert.deepEqual(differences(root(authorFreeze), root(candidate)), ['src/shell/cancellation.ts']);
  const ownParent = get('commit', independentFreeze).toString().match(/^parent (.+)$/m)[1];
  const ownChanges = differences(root(ownParent), root(independentFreeze));
  assert.equal(ownChanges.length, 6);
  assert.ok(ownChanges.every(path => path.startsWith(relative(repository, own) + '/')));
  const helper = pathObject(candidate, 'src/shell/cancellation.ts');
  assert.equal(sha256(get('blob', helper.oid)), 'f628801379acd1c86c247a778e973f4cb89f8bbe2c3089f8192c31f3c5b273a5');
  assert.equal(pathObject(independentFreeze, 'src/shell/cancellation.ts').oid, helper.oid);
  assert.equal(pathObject(ownParent, 'src/shell/cancellation.ts').oid, helper.oid);
  const historical = json(join(evidence, 'authentication.json')).historicalMembership;
  function listing(identifier, prefix) {
    const parts = [];
    for (const entry of entries(get('tree', identifier))) {
      const path = `${prefix}/${entry.name}`;
      if (entry.type === 'tree') parts.push(listing(entry.oid, path));
      else parts.push(Buffer.from(`${entry.mode.padStart(6, '0')} ${entry.type} ${entry.oid}\t${path}\0`));
    }
    return Buffer.concat(parts);
  }
  for (const [path, value] of Object.entries(historical)) {
    assert.equal(pathObject(authorFreeze, path).oid, pathObject(candidate, path).oid);
    assert.equal(sha256(listing(value.tree, path)), value.sha256, 'full historical membership reconstructed including additions');
  }
  const frozen = JSON.parse(get('blob', pathObject(independentFreeze, `${relative(repository, own)}/FREEZE-v1.json`).oid));
  for (const [filename, digest] of Object.entries(frozen.files)) assert.equal(sha256(readFileSync(join(own, filename))), digest, `unchanged own frozen ${filename}`);
  const fixtureBindings = json(join(evidence, 'fixture-bindings.json')).members;
  for (const filename of ['extension-v1.mjs', 'positive-v1.ts.data', 'negative-v1.ts.data']) assert.equal(fixtureBindings[filename].sha256, frozen.files[filename]);
  for (const [filename, suffix] of [['original12.mjs', '/cohort-v1.mjs'], ['nearby4.mjs', '/nearby-v1.mjs'], ['old-positive.ts.data', '/positive-v1.ts.data'], ['old-negative.ts.data', '/negative-v1.ts.data']]) {
    const input = frozen.inputs.find(item => item.path.endsWith(suffix));
    assert.equal(fixtureBindings[filename].sha256, input.sha256);
  }
  assert.deepEqual(json(join(evidence, 'fixtures-after.json')), fixtureBindings);
  assert.deepEqual(json(join(evidence, 'tools-before.json')), json(join(evidence, 'tools-after.json')));
  const movedBefore = json(join(evidence, 'moved-before.json'));
  const movedAfter = json(join(evidence, 'moved-after.json'));
  const typeNames = ['old-positive', 'old-six-negative', 'extension-positive', 'extension-eight-negative'];
  const sourceBefore = json(join(evidence, 'source-before.json'));
  const sourceAfterBuild = json(join(evidence, 'source-after-build.json'));
  const removed = json(join(evidence, 'source-build-before-removal.json'));
  assert.deepEqual(Object.keys(sourceAfterBuild).sort(), [...Object.keys(sourceBefore), 'tsconfig.json'].sort());
  assert.deepEqual(Object.keys(removed.source).sort(), [...Object.keys(sourceAfterBuild), ...typeNames.flatMap(name => [`${name}-source.ts`, `tsconfig-${name}-source.json`])].sort());
  for (const [filename, value] of Object.entries(sourceBefore)) assert.deepEqual(removed.source[filename], value);
  assert.deepEqual(removed.build, json(join(evidence, 'build-before.json')));
  assert.deepEqual(Object.keys(movedAfter).sort(), [...Object.keys(movedBefore), ...typeNames.flatMap(name => [`${name}-moved.ts`, `tsconfig-${name}-moved.json`])].sort());
  for (const filename of ['cancellation.js', 'cancellation.d.ts', 'package.json']) {
    assert.deepEqual(movedAfter[filename], movedBefore[filename]);
    assert.equal(sha256(readFileSync(join(evidence, 'artifacts', `${filename}.data`))), movedBefore[filename].sha256);
  }
  for (const [cohort, total, passed] of [['extension', 12, 11], ['original12', 12, 12], ['nearby4', 4, 4]]) {
    const first = json(join(evidence, `${cohort}-isolated-summary.json`));
    const moved = json(join(evidence, `${cohort}-moved-summary.json`));
    assert.deepEqual(first, moved);
    assert.equal(first.tests, total);
    assert.equal(first.pass, passed);
    assert.equal(first.fail, total - passed);
    assert.equal(first.cancelled + first.skipped + first.todo, 0);
  }
  const mutantResults = json(join(evidence, 'counterfactuals.json'));
  assert.equal(mutantResults.length, 4);
  const baseline = json(join(evidence, 'extension-isolated-summary.json'));
  for (const mutant of mutantResults) {
    assert.equal(baseline.records.find(item => item.name.startsWith(mutant.witness + ' ')).pass, true);
    assert.equal(mutant.killed, true);
    const result = json(join(evidence, `counterfactual-${mutant.name}-summary.json`));
    assert.equal(result.fail, 1);
    assert.equal(result.records[0].pass, false);
    assert.ok(readFileSync(join(evidence, `counterfactual-${mutant.name}.stdout`), 'utf8').includes('ERR_ASSERTION'), 'behavioral assertion, not loader/compile error');
  }
  const typeCases = [['old-positive', 0], ['old-six-negative', 6], ['extension-positive', 0], ['extension-eight-negative', 8]];
  for (const [name, count] of typeCases) {
    const source = json(join(evidence, `${name}-source-diagnostics.json`));
    const moved = json(join(evidence, `${name}-moved-diagnostics.json`));
    assert.equal(source.diagnostics.length, count);
    assert.equal(moved.diagnostics.length, count);
    assert.deepEqual(source.diagnostics.map(item => [item.line, item.code]), moved.diagnostics.map(item => [item.line, item.code]));
  }
  const declarations = json(join(evidence, 'declaration-bindings-v1/summary.json'));
  assert.equal(declarations.summaries.length, 4);
  for (const summary of declarations.summaries) {
    const loaded = summary.loadedFiles.find(item => item.path === 'moved-internal/cancellation.d.ts');
    assert.equal(loaded.sha256, movedBefore['cancellation.d.ts'].sha256);
  }
  let loads = 0;
  for (const filename of readdirSync(evidence).filter(name => name.endsWith('-loads.jsonl'))) {
    const records = readFileSync(join(evidence, filename), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    for (const entry of records) assert.equal(entry.diskSha256, entry.loadedSha256);
    const helperLoad = records.find(item => item.filename.endsWith('/cancellation.js'));
    assert.ok(helperLoad);
    if (filename.startsWith('counterfactual-')) {
      const after = json(join(evidence, filename.replace('-loads.jsonl', '-after.json')));
      assert.equal(helperLoad.loadedSha256, after['emitted/cancellation.js'].sha256);
    } else assert.equal(helperLoad.loadedSha256, movedBefore['cancellation.js'].sha256);
    const fixture = records.find(item => !item.filename.endsWith('/cancellation.js'));
    assert.ok(fixture);
    const fixtureName = fixture.filename.split('/').at(-1);
    const expectedFixture = fixtureName === 'bug-repro-v1.mjs' ? sha256(readFileSync(join(evidence, 'bug-repro-v1.mjs.data'))) : fixtureBindings[fixtureName].sha256;
    assert.equal(fixture.loadedSha256, expectedFixture);
    loads += 1;
  }
  assert.equal(loads, 11);
  const naturalProcesses = readdirSync(evidence).filter(name => name.endsWith('-process.json')).map(filename => json(join(evidence, filename)));
  for (const process of naturalProcesses) {
    assert.equal(process.error, null);
    assert.equal(process.signal, null);
    assert.ok(Number.isInteger(process.exit));
    assert.equal(process.executableSha256, json(join(evidence, 'tools-before.json')).node.sha256);
  }
  for (const process of json(join(evidence, 'declaration-bindings-v1/processes.json'))) {
    assert.equal(process.error, null);
    assert.equal(process.signal, null);
  }
  assert.equal(json(join(evidence, 'source-build-removal.json')).sourceAbsent, true);
  assert.equal(json(join(evidence, 'source-build-removal.json')).buildAbsent, true);
  for (const filename of ['scratch-cleanup.json', 'declaration-bindings-v1/cleanup.json']) {
    const cleanup = json(join(evidence, filename));
    assert.equal(cleanup.absent, true);
    assert.equal(existsSync(cleanup.removed ?? cleanup.path), false);
  }
  const manifestPath = join(own, 'evidence-manifest-v1.json');
  if (existsSync(manifestPath)) {
    const manifest = json(manifestPath);
    assert.deepEqual(inventory(join(own, 'evidence-v1')), manifest.failedPreparation);
    assert.deepEqual(inventory(evidence), manifest.evidence, 'complete sealed membership including additions');
  }
  const result = { verifiedAt: new Date().toISOString(), archivedObjects: objects.size, candidateOnlyChangedHelper: true, ownFreezeChangedOnlySixOwnedFiles: true,
    historicalMembershipReconstructed: true, authenticatedHelperLoads: loads, naturalPrimaryProcesses: naturalProcesses.length,
    naturalSupplementalTypeProcesses: 4, sourceBuildRemovedBeforeMovedReplay: true, scratchAbsent: true,
    extension: '11/12 in each mode; E07 fails', original12: '12/12 in each mode', nearby4: '4/4 in each mode', mutants: '4/4 targeted behavioral kills',
    verdict: 'REJECT candidate helper extension: B01', stage2Authorized: false };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[2] === 'collect') collect();
else if (process.argv[2] === 'seal') {
  const result = verify();
  writeJson(join(own, 'evidence-manifest-v1.json'), { version: 1, candidate, independentFreeze, failedPreparation: inventory(join(own, 'evidence-v1')), evidence: inventory(evidence), result });
} else if (process.argv[2] === 'verify') verify();
else throw new Error('usage: audit-v1.mjs collect|seal|verify');
