import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { owned, root, save, sha256 } from './support.mjs';

export const sourceCommit = '6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a';
export const candidateCommit = '7e0a578e277d123ba0fa86e48b46f4fd0431b839';
export const candidateCommits = ['da81b8f73a6cf98fe8b44b2deee00ed80f1599d4', '4fa20ac6cadb9d37fa9da4d205dc37a5a1bcb9f9', candidateCommit];
export const migration = 'tests/shell-stress/canonical-profile-migration';
export const review = 'tests/shell-stress/canonical-profile-review';
export const testRoots = ['tests/shell/invocation-discovery-fixes.test.ts', 'tests/shell-stress/differential.test.ts', 'tests/shell-stress/current-gaps/compatibility.test.ts', 'tests/shell-stress/invocation-closure/holdout.test.ts'];
export const git = args => execFileSync('/usr/bin/git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
export const blob = (commit, path) => git(['show', `${commit}:${path}`]);
export async function audit() {
  const proof = {};
  async function check(commit, path) {
    const bytes = blob(commit, path);
    assert.deepEqual(await readFile(resolve(root, path)), bytes, path);
    proof[path] = { commit, blob: git(['rev-parse', `${commit}:${path}`]).toString().trim(), sha256: sha256(bytes) };
  }
  for (const [commit, prefix] of [['1dc0aed8103355eb5dd7bae5ea87bd7ce3ceeaf2', review], ['ab02ed8', migration]]) {
    for (const path of git(['ls-tree', '-r', '--name-only', commit, prefix]).toString().trim().split('\n')) await check(commit, path);
  }
  const prep = JSON.parse(blob('ab02ed8', `${migration}/inputs.json`));
  for (const path of Object.keys(prep.originals)) await check(testRoots.includes(path) ? candidateCommit : sourceCommit, path);
  for (const name of ['discovery-profile.ts', 'historical-discovery.ts', 'primary-reference.ts', 'primary-fixtures.json', 'native.json']) await check(candidateCommit, `${migration}/${name}`);
  for (const path of ['src/shell/runtime.ts', 'src/shell/parser.ts']) await check(sourceCommit, path);
  const frozen = JSON.parse(await readFile(resolve(owned, 'inputs.json')));
  const aligned = JSON.parse(await readFile(resolve(owned, 'aligned-native-20260827.json')));
  const metadata = JSON.parse(blob(candidateCommit, `${migration}/primary-fixtures.json`));
  const native = JSON.parse(blob(candidateCommit, `${migration}/native.json`));
  const rows = frozen.rows.filter(row => ['differential', 'syntax', 'gaps'].includes(row.cohort));
  assert.equal(metadata.fixtures.length, 88);
  const fields = entries => Object.fromEntries(Object.entries(entries).map(([path, entry]) => [path, { type: entry.type, mode: entry.mode & 0o7777, ...(entry.hex === undefined ? {} : { base64: Buffer.from(entry.hex, 'hex').toString('base64') }) }]));
  const compared = [];
  for (const [index, row] of rows.entries()) {
    const fixture = metadata.fixtures[index].fixture;
    assert.equal(fixture.name, row.name);
    assert.equal(fixture.script, row.source);
    assert.equal(Buffer.from(fixture.stdin ?? '').toString('hex'), row.stdinHex);
    assert.deepEqual(fixture.env ?? {}, row.env);
    assert.deepEqual(fixture.limits ?? {}, row.limits);
    assert.deepEqual(Object.entries(fixture.initialFiles ?? {}).map(([path, text]) => ({ path, text, mode: 0o644 })), row.files);
    for (const [profile, authorProfile] of [['gnu53', 'GNU5.3-primary'], ['apple32', 'Bash3.2-historical']]) {
      const expected = aligned.profiles.find(item => item.id === profile).rows.find(item => item.id === row.id);
      const actual = native.rows.find(item => item.profile === authorProfile && item.invocationName === 'shell' && item.name === row.name);
      assert.ok(actual, `${profile}/${row.id}`);
      assert.equal(actual.source, row.source);
      assert.deepEqual(actual.args, expected.args);
      assert.equal(actual.inputHex, row.stdinHex);
      assert.deepEqual(actual.env, { PATH: '/usr/bin:/bin', HOME: actual.cwd, TMPDIR: actual.cwd, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', ...row.env });
      assert.equal(actual.status, expected.result.status);
      assert.equal(Buffer.from(actual.stdoutHex, 'hex').toString('base64'), expected.result.stdout);
      assert.equal(Buffer.from(actual.stderrHex, 'hex').toString('base64'), expected.result.stderr);
      assert.deepEqual(fields(actual.before), expected.initial);
      assert.deepEqual(fields(actual.after), expected.effects);
      assert.equal(actual.signal, null); assert.equal(actual.error, null);
      compared.push({ id: row.id, profile, sourceSha256: sha256(row.source), rawTupleEqual: true, nativeModeRepresentation: 'author stat mode includes file-type bits; compare identical permission bits and separately asserted entry type' });
    }
  }
  const diffs = Object.fromEntries(testRoots.map(path => [path, git(['diff', sourceCommit, candidateCommit, '--', path]).toString()]));
  const discovery = blob(candidateCommit, testRoots[0]).toString();
  const historical = blob(candidateCommit, `${migration}/historical-discovery.ts`).toString();
  const body = text => text.slice(text.indexOf('  assert.equal(row.source'), text.indexOf('\n});') + 4);
  assert.equal(body(discovery), body(historical));
  assert.equal(body(discovery), body(blob(sourceCommit, testRoots[0]).toString()));
  const helpers = Object.keys(prep.originals).filter(path => !testRoots.includes(path));
  for (const path of helpers) assert.deepEqual(blob(candidateCommit, path), blob(sourceCommit, path));
  return { capturedAt: new Date().toISOString(), sourceCommit, candidateCommits, proof, comparisons: compared, comparisonCount: compared.length, primaryCount: 88, fixtures: 88, original27: frozen.routed, diffs, unchangedHelperFixtureOraclePaths: helpers, discoveryAssertionBodyIdentical: true, policy: { canonical: 183, discovery: 60, differential: 78, gaps: 11, closure: 34, strictHistoricalSeparate: 52, nativeClassificationIsNotSafePlugin: true, modesNotCandidateAssertion: 40 } };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const evidence = await audit();
  save('acceptance-input-audit.json', evidence);
  console.log(JSON.stringify({ guardFiles: Object.keys(evidence.proof).length, nativeCrossChecks: evidence.comparisonCount }));
}
