import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hash, json, git, inventory, privateShape } from '../safejs-getopts-followup-618d8967/common.mjs';
export { hash, json, git, inventory, privateShape, captures, node, candidate, oldOwner, old } from '../safejs-getopts-followup-618d8967/common.mjs';

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repo = '/Users/kjopek/Workspace/safe-bash';
export const relativeOwn = path.relative(repo, own);
export const work = path.join(own, '.scratch');
export const root = path.join(work, 'run');
export const accepted = '6133b2714602d1fd8a08dce26b17b74370754bbc';
const candidate = '618d8967009117547ab476256bc6eb0a9463309a';
export function write(filename, bytes, mode = 0o644) {
  assert(path.resolve(filename).startsWith(own + '/'));
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode });
}
export const save = (filename, value) => write(filename, JSON.stringify(value, null, 2) + '\n');
export function oldBoundary() {
  const phase = 'tests/shell/getopts-independent-20260827';
  const excluded = path.relative(path.join(repo, phase), own);
  const actual = inventory(path.join(repo, phase), name => name === excluded || name.startsWith(excluded + '/'));
  const records = git('ls-tree', '-rz', accepted, '--', phase).toString().split('\0').filter(Boolean);
  const expectedPaths = new Set();
  for (const record of records) {
    const [header, full] = record.split('\t');
    const [mode, type, oid] = header.split(' ');
    assert.equal(type, 'blob');
    const relative = full.slice(phase.length + 1);
    const entry = actual.find(item => item.path === relative);
    assert(entry, full);
    const bytes = fs.readFileSync(path.join(repo, full));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), oid, full);
    assert.equal(entry.mode & 0o111 ? '100755' : '100644', mode);
    expectedPaths.add(relative);
    let parent = path.dirname(relative);
    while (parent !== '.') { expectedPaths.add(parent); parent = path.dirname(parent); }
  }
  assert.deepEqual(actual.map(entry => entry.path).sort(), [...expectedPaths].sort());
  const layers = [
    ['review-618d8967', '2dcefd4f26588f6dc662148e3713e41b09537333', 'LAYERED-MANIFEST.json'],
    ['safejs-getopts-followup-618d8967', accepted, 'EVIDENCE-MANIFEST.json'],
  ].map(([name, commit, manifest]) => {
    const prefix = `${phase}/stage2/${name}`;
    const paths = git('ls-tree', '-r', '--name-only', commit, '--', prefix).toString().trim().split('\n');
    for (const filename of paths) assert.deepEqual(fs.readFileSync(path.join(repo, filename)), git('show', `${commit}:${filename}`));
    assert.equal(inventory(path.join(repo, prefix)).filter(entry => entry.kind === 'file').length, paths.length);
    return { name, commit, files: paths.length, manifestSHA256: hash(fs.readFileSync(path.join(repo, prefix, manifest))) };
  });
  return { accepted, files: records.length, entries: actual.length, inventorySHA256: hash(JSON.stringify(actual)), onlyAuthorizedExclusion: excluded, additionsChecked: true, layers, oldVerifiersModifiedOrInvoked: false };
}
export function protectedLive() {
  const baseline = JSON.parse(git('show', 'cb94b17d0eefc62e2a51f5a6f7cf46ebbcad2faf:tests/shell/getopts/runtime/baseline.json'));
  for (const [filename, expected] of Object.entries(baseline.protectedPaths)) assert.equal(hash(git('show', `${candidate}:${filename}`)), expected, filename);
  const names = [...new Set([...Object.keys(baseline.protectedPaths), 'src/shell/runtime.ts', 'src/shell/shell.ts'])].sort();
  const liveHashes = Object.fromEntries(names.map(filename => [filename, hash(fs.readFileSync(path.join(repo, filename)))]));
  return { protectedPaths: Object.keys(baseline.protectedPaths).length, sourcePaths: 2, currentLivePreservationPaths: names.length, currentLiveHashInventorySHA256: hash(JSON.stringify(liveHashes)), candidateProtectedHashesMatchBaseline: true, liveCandidateEqualityRequired: false, wholeLiveTreeClaim: false };
}
export const frozenFiles = ['PROTOCOL.md', 'G2.guest.txt', 'G2-CORRECTION.diff', 'witness-loader.mjs', 'child.mjs', 'common.mjs', 'prepare.mjs', 'run.mjs', 'finish.mjs', 'verify.mjs'];
export const immutable = () => inventory(work, name => ['run/logs', 'run/tmp', 'run/home'].some(prefix => name === prefix || name.startsWith(prefix + '/')));
export function fixtureBinding() {
  const prefix = 'tests/shell/getopts-independent-20260827/stage2/safejs-getopts-followup-618d8967';
  const original = git('show', `${accepted}:${prefix}/G2.guest.txt`).toString();
  const corrected = fs.readFileSync(path.join(own, 'G2.guest.txt'), 'utf8');
  assert.equal(original.split('export -p').length, 3);
  assert.equal(corrected, original.replaceAll('export -p', 'export'));
  for (const [name, previous] of [['child.mjs', 'child-v2.mjs'], ['witness-loader.mjs', 'witness-loader.mjs']]) assert.deepEqual(fs.readFileSync(path.join(own, name)), git('show', `${accepted}:${prefix}/${previous}`));
  const scripts = source => {
    const bodies = [...source.matchAll(/await shell\.exec\(`([^`]+)`\)/gu)].map(match => match[1]);
    assert.equal(bodies.length, 2);
    return bodies.map(body => { assert(!body.includes('${')); assert(!/\\(?!n)/u.test(body)); return hash(body.replaceAll('\\n', '\n')); });
  };
  const originalScripts = scripts(original);
  assert.equal(originalScripts[0], 'f762134d22092da242701aa511daf7d9b0b9d4774734007e919d001fae9c2ef4');
  return { originalCommit: accepted, originalGuestSHA256: hash(original), correctedGuestSHA256: hash(corrected), originalScripts, correctedScripts: scripts(corrected), guestAssertionsUnchanged: 7, childAndWitnessByteIdentical: true, syntaxChanges: 2, originalRuntimeSHA256: 'd37b761457b45ef523546cdad614981c7b5e3ac7665cc486721878195fb3a04a', transformedRuntimeSHA256: 'de5ef818085c83e5fbbd209e9ed08740211663116209b05b01e4d295c1e60631' };
}
export function verifyFreeze(commit) {
  assert.match(commit, /^[a-f0-9]{40}$/u);
  assert.deepEqual(fs.readFileSync(path.join(own, 'FREEZE.json')), git('show', `${commit}:${relativeOwn}/FREEZE.json`));
  const freeze = json(path.join(own, 'FREEZE.json'));
  assert.deepEqual(Object.keys(freeze.inputs).sort(), [...frozenFiles].sort());
  for (const [name, expected] of Object.entries(freeze.inputs)) {
    const bytes = fs.readFileSync(path.join(own, name));
    assert.equal(hash(bytes), expected, name);
    assert.deepEqual(bytes, git('show', `${commit}:${relativeOwn}/${name}`));
  }
  return freeze;
}
