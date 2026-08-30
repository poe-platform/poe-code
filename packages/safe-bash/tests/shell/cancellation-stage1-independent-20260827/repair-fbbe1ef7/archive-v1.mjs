import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const prior = path.dirname(here);
export const repository = path.resolve(here, '../../../..');
export const independentPath = 'tests/shell/cancellation-stage1-independent-20260827';
export const authorPath = 'tests/shell/cancellation-stage1-20260827';
export const helperPath = 'src/shell/cancellation.ts';
export const pins = {
  originalAuthorFreeze: '7023c28229ecb7939aee5eb7ca0f52ac57c795bb',
  originalCandidate: '6747227230cd770379148552d471621717b766d7',
  historicalAudit: '146d5ad72cbccf61885baa9b33feee0891b7d32c',
  repairFreeze: '01fbb3880bbe662adb2c7371e52ea3b47c0549f4',
  candidate: 'fbbe1ef793b7434871403125efbeb46624a8e081',
  authorEvidence: '339da95906bd88d42435970beadcb620b72a7afd',
  independentFreeze: '647f42b9abf9f5abc4de3e36c74410b3bb63df3c',
};
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function git(...args) {
  const result = spawnSync('git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}
export function inventory(directory, excludeRoot = '') {
  const entries = [];
  function visit(relative) {
    for (const name of readdirSync(path.join(directory, relative)).sort()) {
      if (!relative && name === excludeRoot) continue;
      const file = path.posix.join(relative, name);
      const location = path.join(directory, file);
      const stat = lstatSync(location);
      assert.equal(stat.isSymbolicLink(), false, `regular files only: ${location}`);
      if (stat.isDirectory()) { entries.push({ path: `${file}/`, kind: 'directory' }); visit(file); }
      else entries.push({ path: file, kind: 'file', size: stat.size, sha256: hash(readFileSync(location)) });
    }
  }
  visit('');
  return entries;
}
export function historicalMembership() {
  const baseline = JSON.parse(readFileSync(path.join(here, 'history-before-v1.json')));
  const entries = inventory(prior, 'repair-fbbe1ef7');
  assert.deepEqual(entries, baseline.historicalEntries, 'history bytes AND membership preserved; only new version excluded');
  const manifest = JSON.parse(readFileSync(path.join(prior, 'final-manifest-v2.json')));
  assert.deepEqual(entries.filter(item => item.path !== 'final-manifest-v2.json'), manifest.entries);
  return entries;
}
export function liveSnapshot() {
  const files = git('ls-files', '-z', '--', 'src', 'package.json', 'package-lock.json', 'AGENTS.md').toString().split('\0').filter(Boolean);
  return { at: new Date().toISOString(), head: git('rev-parse', 'HEAD').toString().trim(),
    status: git('status', '--porcelain=v1', '--untracked-files=all').toString(),
    foreignIndex: git('diff', '--cached', '--raw', '--abbrev=40', '--', '.', `:(exclude)${independentPath}/repair-fbbe1ef7`).toString(),
    liveFiles: files.map(file => {
      try { return { path: file, sha256: hash(readFileSync(path.join(repository, file))) }; }
      catch (error) { return { path: file, error: error.code }; }
    }),
  };
}
export function objects(seal, capture = false) {
  function get(oid) {
    if (!seal.objects[oid] && capture) {
      const type = git('cat-file', '-t', oid).toString().trim();
      const bytes = git('cat-file', type, oid);
      seal.objects[oid] = { type, sha256: hash(bytes), base64: bytes.toString('base64') };
    }
    const record = seal.objects[oid];
    assert.ok(record, `sealed object ${oid}`);
    const bytes = Buffer.from(record.base64, 'base64');
    assert.equal(createHash('sha1').update(`${record.type} ${bytes.length}\0`).update(bytes).digest('hex'), oid);
    assert.equal(hash(bytes), record.sha256);
    return { type: record.type, bytes };
  }
  function tree(oid) {
    if (!oid) return new Map();
    const object = get(oid);
    assert.equal(object.type, 'tree');
    const entries = new Map();
    let cursor = 0;
    while (cursor < object.bytes.length) {
      const space = object.bytes.indexOf(32, cursor);
      const nul = object.bytes.indexOf(0, space);
      entries.set(object.bytes.subarray(space + 1, nul).toString(), {
        mode: object.bytes.subarray(cursor, space).toString(),
        oid: object.bytes.subarray(nul + 1, nul + 21).toString('hex'),
      });
      cursor = nul + 21;
    }
    assert.equal(cursor, object.bytes.length);
    return entries;
  }
  function commit(oid) {
    const object = get(oid);
    assert.equal(object.type, 'commit');
    return { tree: /^tree (.*)$/m.exec(object.bytes.toString())[1],
      parents: [...object.bytes.toString().matchAll(/^parent (.*)$/gm)].map(match => match[1]) };
  }
  function resolve(oid, file) {
    let target = commit(oid).tree;
    for (const name of file.split('/')) {
      const entry = tree(target).get(name);
      assert.ok(entry, `committed ${oid}:${file}`);
      target = entry.oid;
    }
    return target;
  }
  function file(oid, name) {
    const target = resolve(oid, name);
    const object = get(target);
    assert.equal(object.type, 'blob');
    if (capture) seal.paths[`${oid}:${name}`] = target;
    else assert.equal(seal.paths[`${oid}:${name}`], target);
    return object.bytes;
  }
  function delta(oldTree, newTree, prefix = '') {
    if (oldTree === newTree) return [];
    const previous = tree(oldTree);
    const current = tree(newTree);
    const changes = [];
    for (const name of [...new Set([...previous.keys(), ...current.keys()])].sort()) {
      const before = previous.get(name);
      const after = current.get(name);
      if (before?.oid === after?.oid && before?.mode === after?.mode) continue;
      if (before?.mode === '40000' || after?.mode === '40000') changes.push(...delta(before?.oid, after?.oid, prefix + name + '/'));
      else {
        if (before) get(before.oid);
        if (after) get(after.oid);
        changes.push({ path: prefix + name, before: before ?? null, after: after ?? null });
      }
    }
    return changes;
  }
  return { get, tree, commit, resolve, file, delta };
}
export function captureSeal() {
  const seal = { version: 1, pins, objects: {}, paths: {}, deltas: {}, memberships: {} };
  const archive = objects(seal, true);
  for (const pin of Object.values(pins)) archive.commit(pin);
  for (const key of ['repairFreeze', 'candidate', 'authorEvidence', 'independentFreeze']) {
    const candidate = archive.commit(pins[key]);
    assert.equal(candidate.parents.length, 1);
    const parent = archive.commit(candidate.parents[0]);
    seal.deltas[key] = { parent: candidate.parents[0], paths: archive.delta(parent.tree, candidate.tree) };
  }
  const candidateParent = seal.deltas.candidate.parent;
  for (const commit of [pins.originalCandidate, pins.repairFreeze, candidateParent, pins.candidate, pins.authorEvidence]) archive.file(commit, helperPath);
  const reserved = ['src/shell/cleanup.ts', 'src/shell/runtime.ts', 'src/shell/shell.ts', 'src/shell/types.ts', 'src/index.ts', 'src/plugins/index.ts', 'package.json', 'package-lock.json'];
  for (const commit of [candidateParent, pins.candidate]) for (const name of reserved) archive.file(commit, name);
  for (const name of ['cohort-v1.mjs', 'positive-v1.ts.data', 'negative-v1.ts.data', 'final-manifest-v2.json', 'evidence-v1/summary.json', 'evidence-v2/summary.json', 'review-v2.mjs', 'evidence-v2/mutants.json']) {
    for (const commit of [pins.historicalAudit, pins.repairFreeze, pins.candidate, pins.authorEvidence]) archive.file(commit, `${independentPath}/${name}`);
  }
  for (const commit of [pins.historicalAudit, pins.repairFreeze, pins.candidate, pins.authorEvidence]) seal.memberships[`${commit}:independentTree`] = archive.resolve(commit, independentPath);
  const originalFiles = git('ls-tree', '-r', '--name-only', pins.originalAuthorFreeze, '--', authorPath).toString().trim().split('\n');
  for (const commit of [pins.originalAuthorFreeze, pins.repairFreeze, pins.candidate, pins.authorEvidence]) for (const name of originalFiles) archive.file(commit, name);
  const repairFiles = git('ls-tree', '-r', '--name-only', pins.repairFreeze, '--', `${authorPath}/repair-v1`).toString().trim().split('\n');
  for (const commit of [pins.repairFreeze, pins.candidate, pins.authorEvidence]) for (const name of repairFiles) archive.file(commit, name);
  archive.file(pins.authorEvidence, `${authorPath}/repair-v1/evidence-v1/RESULTS.md`);
  archive.file(pins.independentFreeze, `${independentPath}/repair-fbbe1ef7/FREEZE-v1.md`);
  archive.file(pins.independentFreeze, `${independentPath}/repair-fbbe1ef7/history-before-v1.json`);
  seal.reservedPaths = reserved;
  return seal;
}
export function verifySeal(seal) {
  assert.deepEqual(seal.pins, pins);
  const archive = objects(seal);
  for (const oid of Object.keys(seal.objects)) archive.get(oid);
  for (const entry of Object.keys(seal.paths)) {
    const separator = entry.indexOf(':');
    archive.file(entry.slice(0, separator), entry.slice(separator + 1));
  }
  for (const [key, expected] of Object.entries(seal.deltas)) {
    const candidate = archive.commit(pins[key]);
    assert.deepEqual(candidate.parents, [expected.parent]);
    const actual = archive.delta(archive.commit(expected.parent).tree, candidate.tree);
    assert.deepEqual(actual, expected.paths);
  }
  assert.deepEqual(seal.deltas.candidate.paths.map(item => item.path), [helperPath]);
  assert.equal(seal.deltas.candidate.paths[0].before.oid, 'd5ceafef56a9351bd77630db66d9acfdc19a38ee');
  const source = archive.file(pins.candidate, helperPath);
  assert.equal(hash(source), 'ee048f6c38086dd40573db57e002e596029174ee2afc5f888e516779e5a718ac');
  assert.equal(seal.paths[`${pins.candidate}:${helperPath}`], 'a7742b7f7e81bcd8c1c2a6be35092d8b5f41102f');
  assert.equal(hash(archive.file(pins.repairFreeze, helperPath)), hash(archive.file(pins.originalCandidate, helperPath)));
  const parent = seal.deltas.candidate.parent;
  for (const name of seal.reservedPaths) assert.equal(hash(archive.file(parent, name)), hash(archive.file(pins.candidate, name)));
  for (const commit of [pins.repairFreeze, pins.candidate, pins.authorEvidence]) {
    assert.equal(archive.resolve(commit, independentPath), archive.resolve(pins.historicalAudit, independentPath));
    const originalManifest = JSON.parse(archive.file(pins.originalAuthorFreeze, `${authorPath}/freeze-manifest.json`));
    for (const [name, expected] of Object.entries(originalManifest.files)) assert.equal(hash(archive.file(commit, `${authorPath}/${name}`)), expected);
    const repairManifest = JSON.parse(archive.file(pins.repairFreeze, `${authorPath}/repair-v1/freeze-manifest.json`));
    for (const [name, expected] of Object.entries(repairManifest.files)) assert.equal(hash(archive.file(commit, `${authorPath}/repair-v1/${name}`)), expected);
  }
  assert.equal(/^\s*(?:import\b|export\s+.*\bfrom\b)|\b(?:import|require)\s*\(/m.test(source.toString()), false);
  assert.equal(archive.file(pins.candidate, 'src/index.ts').toString().includes('cancellation'), false);
  assert.equal(archive.file(pins.candidate, 'package.json').toString().includes('cancellation'), false);
  return { archive, source, identity: {
    candidate: pins.candidate, parent, tree: archive.commit(pins.candidate).tree,
    rawCommitSha256: hash(archive.get(pins.candidate).bytes), helperBlob: seal.paths[`${pins.candidate}:${helperPath}`],
    helperSha256: hash(source), emptyImportClosure: true, onlyHelperChanged: true, reservedUnchangedRelativeToOwnParent: seal.reservedPaths,
    historicalIndependentTreeUnchanged: true, originalAuthorHashesVerified: 8, repairAuthorHashesVerified: 5,
    rawObjects: Object.keys(seal.objects).length, reachablePaths: Object.keys(seal.paths).length,
    reconstruction: 'raw Git objects and changed-path trees; no loose-object assumption, branch or full repository clone',
  } };
}
