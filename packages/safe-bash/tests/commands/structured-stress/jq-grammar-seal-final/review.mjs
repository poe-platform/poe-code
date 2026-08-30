import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const owned = 'tests/commands/structured-stress/jq-grammar-seal-final';
export const proposal = 'tests/commands/structured-stress/jq-grammar-seal-proposal';
export const target = 'tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts';
export const handoff = '09926fb67452ca7db9bd793d87b78d2f41ff82be';
export const expectedSource = '913886e89fce8626d28f957d978243e3b8dd6bf94dd14348f5331f47607b4fb1';
export const read = path => readFileSync(resolve(root, path));
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
export function artifact(name, value) {
  const path = `${owned}/${name}`;
  assert.equal(existsSync(resolve(root, path)), false, 'never overwrite evidence');
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
}
export function tree(paths) {
  const files = {};
  function visit(path) {
    if (path === owned) return;
    for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else {
        assert.ok(entry.isFile(), `nonregular entry ${child}`);
        files[child] = digest(read(child));
      }
    }
  }
  paths.forEach(visit);
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}
export function source() {
  const files = tree(['src/commands/structured']);
  const hash = digest(Object.entries(files).map(([path, value]) => `${path}\0${value}\n`).join(''));
  assert.equal(hash, expectedSource, 'structured source handoff');
  const committed = git(['ls-tree', '-r', '--name-only', handoff, '--', 'src/commands/structured']).toString().trim().split('\n');
  assert.deepEqual(Object.keys(files), committed.sort());
  for (const path of committed) assert.equal(digest(git(['show', `${handoff}:${path}`])), files[path], path);
  return { handoff, sha256: hash, files };
}

if (process.argv[2] === 'review') {
  const startedAt = new Date().toISOString();
  const sourceBefore = source();
  const beforePath = `${proposal}/before-2026-08-27/evidence.test.ts.txt`;
  const afterPath = `${proposal}/afterSnapshot/evidence.test.ts.txt`;
  assert.equal(digest(read(target)), 'bc2b19133b926eccf2519885bb5ca7a16f9ce09e1fb1a9cda78b6c365a7710f8');
  assert.deepEqual(read(target), git(['show', `21d78a4073ce5ab03079985b44888026c45564ec:${target}`]));
  for (const path of Object.keys(tree([proposal]))) assert.deepEqual(read(path), git(['show', `21d78a4073ce5ab03079985b44888026c45564ec:${path}`]), path);
  assert.equal(digest(read(afterPath)), '81a55856d1ec4dea51676ef09a5aeeb95d3383a7284eb1ec87deef848e430281');
  assert.equal(digest(read(`${proposal}/seal-migration.patch`)), '53e2b083aa7c61444052eebd14428ba5e032500e963eb1b6e5f427806ddaa47f');
  const frozenBefore = tree(['tests/commands/structured', 'tests/commands/structured-stress']);
  const rerun = spawnSync(process.execPath, ['--unhandled-rejections=strict', `${proposal}/verify.mjs`], { cwd: root, timeout: 120000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' });
  assert.ifError(rerun.error);
  assert.equal(rerun.status, 0, rerun.stderr);
  const proof = JSON.parse(rerun.stdout);
  assert.deepEqual(proof, JSON.parse(read(`${proposal}/verification.json`)), 'all recorded author proofs reproduced, not assumed');
  assert.equal(proof.checks.totalChecks, 352);
  assert.equal(proof.mutations.length, 347);
  assert.equal(new Set(proof.mutations.map(row => row.name)).size, 347);
  assert.ok(proof.mutations.every(row => row.rejected));
  if (existsSync(resolve(root, owned, 'proposal-rerun.json'))) assert.deepEqual(JSON.parse(read(`${owned}/proposal-rerun.json`)).proof, proof);
  else artifact('proposal-rerun.json', { command: [process.execPath, '--unhandled-rejections=strict', `${proposal}/verify.mjs`], status: rerun.status, stderr: rerun.stderr, proof });
  const oldPath = proof.oldManifest.path;
  const manifestPath = proof.migrationManifest.path;
  const original = JSON.parse(read(oldPath));
  const migration = JSON.parse(read(manifestPath));
  assert.equal(digest(read(oldPath)), '3766803b4bd8cc39f014e13de881cda034515b1094436530cdfa6505750ce9e3');
  assert.equal(digest(read(manifestPath)), 'aae89dfeefab84c50ef91a84c1c1608d659c0037ac96eb93c5f828ab32c938ce');
  assert.equal(Object.keys(original.files).length, 139);
  assert.equal(migration.files.length, 13);
  assert.deepEqual(read(manifestPath), git(['show', `95966ca:${manifestPath}`]));
  assert.deepEqual(read(oldPath), git(['show', `95966ca:${oldPath}`]));
  const intersection = migration.files.filter(entry => Object.hasOwn(original.files, entry.path));
  assert.equal(intersection.length, 10);
  const originals = Object.keys(original.files).filter(path => !intersection.some(entry => entry.path === path));
  assert.equal(originals.length, 129);
  const paths = new Set([oldPath, manifestPath, beforePath, 'tests/commands/structured-stress/jq-42-review-fixes/native-frozen.json', ...Object.keys(original.files)]);
  for (const entry of migration.files) {
    paths.add(entry.path);
    paths.add(entry.afterSnapshot);
    if (entry.beforeSnapshot) paths.add(entry.beforeSnapshot);
  }
  const baseline = new Map([...paths].map(path => [path, read(path)]));
  const candidateText = read(afterPath).toString();
  assert.equal(candidateText.split('\n').length - 1, 43);
  assert.equal(candidateText.split('\n').slice(0, 10).join('\n'), read(beforePath).toString().split('\n').slice(0, 10).join('\n'), 'first test and imports unchanged');
  const executable = stripTypeScriptTypes(candidateText).replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', 'testUrl');
  function execute(files) {
    const registrations = [];
    runInNewContext(executable, {
      assert, createHash, URL, testUrl: pathToFileURL(resolve(root, target)).href,
      readFileSync(path, encoding) {
        const key = relative(root, path instanceof URL ? fileURLToPath(path) : resolve(root, path));
        if (!files.has(key)) throw Object.assign(new Error(`ENOENT: ${key}`), { code: 'ENOENT' });
        return encoding ? files.get(key).toString(encoding) : Buffer.from(files.get(key));
      },
      test(name, callback) { assert.equal(typeof callback, 'function'); registrations.push(name); callback(); },
    }, { timeout: 1000 });
    assert.deepEqual(registrations, proof.checks.names);
    return registrations;
  }
  const names = execute(baseline);
  const mutants = [];
  function reject(category, path, change) {
    const files = new Map(baseline);
    change(files);
    let caught;
    try { execute(files); } catch (error) { caught = error; }
    assert.ok(caught, `surviving ${category}: ${path}`);
    assert.ok(['ERR_ASSERTION', 'ENOENT'].includes(caught.code), `unexpected rejection: ${caught}`);
    mutants.push({ category, path, code: caught.code });
  }
  const tamper = (files, path) => files.set(path, Buffer.concat([files.get(path), Buffer.from('\nINDEPENDENT-TAMPER')]));
  for (const path of paths) {
    reject('missing-file', path, files => files.delete(path));
    reject('renamed-file', path, files => { files.set(`${path}.renamed`, files.get(path)); files.delete(path); });
  }
  for (const entry of intersection) reject('original-before-tamper', entry.path, files => tamper(files, entry.beforeSnapshot));
  for (const entry of migration.files) {
    reject('current-after-tamper', entry.path, files => tamper(files, entry.path));
    reject('approved-after-snapshot-tamper', entry.path, files => tamper(files, entry.afterSnapshot));
  }
  for (const path of originals) reject('unlisted-current-tamper', path, files => tamper(files, path));
  for (const [path, key] of [[oldPath, 'files'], [manifestPath, 'files']]) {
    for (const category of ['missing-entry', 'extra-entry', 'renamed-entry', 'replaced-hash', 'same-json-new-bytes']) {
      reject(category, path, files => {
        const value = JSON.parse(files.get(path));
        const entries = value[key];
        if (Array.isArray(entries)) {
          if (category === 'missing-entry') entries.pop();
          if (category === 'extra-entry') entries.push({ ...entries[0], path: 'tests/unapproved.ts' });
          if (category === 'renamed-entry') entries[0].path += '.renamed';
          if (category === 'replaced-hash') entries[0].afterSha256 = '0'.repeat(64);
        } else {
          const first = Object.keys(entries)[0];
          if (category === 'missing-entry') delete entries[first];
          if (category === 'extra-entry') entries['tests/unapproved.ts'] = '0'.repeat(64);
          if (category === 'renamed-entry') { entries[`${first}.renamed`] = entries[first]; delete entries[first]; }
          if (category === 'replaced-hash') entries[first] = '0'.repeat(64);
        }
        files.set(path, Buffer.from(`${JSON.stringify(value)}\n`));
      });
    }
  }
  reject('dated-test-tamper', beforePath, files => tamper(files, beforePath));
  assert.deepEqual(source(), sourceBefore);
  assert.deepEqual(tree(['tests/commands/structured', 'tests/commands/structured-stress']), frozenBefore);
  artifact('approval.json', {
    verdict: 'APPROVE', startedAt, endedAt: new Date().toISOString(), head: git(['rev-parse', 'HEAD']).toString().trim(),
    target, beforeSha256: digest(read(target)), afterSha256: digest(read(afterPath)), patchSha256: digest(read(`${proposal}/seal-migration.patch`)),
    source: sourceBefore, oldManifest: proof.oldManifest, migrationManifest: proof.migrationManifest,
    provenance: { proposal: '21d78a4073ce5ab03079985b44888026c45564ec', approval: proof.approval, native: proof.commits.native, host: proof.commits.host, paths: proof.pathMap },
    authorProofsReexecuted: proof.checks, independent: { candidateTests: names.length, rejectedMutations: mutants.length, categories: Object.fromEntries([...new Set(mutants.map(row => row.category))].map(category => [category, mutants.filter(row => row.category === category).length])), mutants },
    frozenBefore, status: git(['status', '--short']).toString(),
  });
  console.log(JSON.stringify({ verdict: 'APPROVE', reproduced: proof.checks.totalChecks, independentRejected: mutants.length, source: sourceBefore.sha256, frozenPaths: Object.keys(frozenBefore).length }));
}
