import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { root, owned, work, gatedSnapshot, json, files, hashes, drift, sha, save, execute } from './tools.mjs';

const releasePath = '/tmp/safe-bash-comm-final-review-dependency.ready';
assert.ok(existsSync(releasePath));
const snapshot = gatedSnapshot();
const frozen = json(join(work, 'snapshot-manifest.json'));
const manifestPaths = Object.keys(frozen.manifest);
assert.deepEqual(drift(frozen.manifest, hashes(snapshot, manifestPaths)), []);
const audit = json(join(work, 'dependency-alias-audit.json'));
assert.equal(audit.links.length, 4);
assert.ok(!existsSync(join(work, 'corrected-alias-before.json')), 'Exactly one authorized alias correction');
const corrections = [];
for (const row of audit.links) {
  assert.equal(readlinkSync(row.path), row.target);
  const copiedTarget = join(snapshot, row.relative);
  assert.equal(sha(readFileSync(copiedTarget)), frozen.manifest[row.relative]);
  const target = relative(dirname(row.path), copiedTarget);
  unlinkSync(row.path);
  symlinkSync(target, row.path);
  const resolved = realpathSync(row.path);
  assert.ok(resolved.startsWith(realpathSync(snapshot) + '/'));
  assert.equal(sha(readFileSync(resolved)), row.recordedCopiedTargetSha256);
  corrections.push({ path: relative(snapshot, row.path), oldTarget: row.target, newTarget: target, resolved, sha256: row.recordedCopiedTargetSha256 });
}
function verify(base, expected) {
  assert.deepEqual(drift(expected, hashes(base, manifestPaths)), []);
  const links = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = realpathSync(path);
        assert.ok(resolved.startsWith(realpathSync(base) + '/'), `Escaping alias: ${path}`);
        links.push({ path: relative(base, path), target: readlinkSync(path), resolved, sha256: sha(readFileSync(resolved)) });
      } else if (entry.isDirectory()) walk(path);
    }
  }
  walk(base);
  assert.equal(links.length, 4);
  assert.ok(manifestPaths.every(path => (lstatSync(join(base, path)).mode & 0o222) === 0));
  return links;
}
const containedBefore = verify(snapshot, frozen.manifest);
save(join(work, 'corrected-alias-before.json'), { release: { path: releasePath, text: readFileSync(releasePath, 'utf8'), sha256: sha(readFileSync(releasePath)) }, corrections, containedBefore, unchangedRegularFiles: manifestPaths.length, sourceDigest: frozen.sourceDigest, tableDigest: frozen.tableDigest });
const commands = [];
function invoke(name, args, cwd = snapshot, env = {}) {
  const label = 'corrected-' + name;
  assert.ok(!existsSync(join(work, label + '.command.json')), 'No silent replay');
  const command = execute(label, args, cwd, env);
  commands.push(command);
  save(join(work, 'corrected-commands-so-far.json'), commands);
  assert.equal(command.signal, null);
  assert.equal(command.error, null);
  assert.equal(command.loadError, false);
  return command;
}
const prefix = ['--unhandled-rejections=strict', '--import', 'tsx'];
const resolver = `import assert from 'node:assert/strict'; import {createRequire} from 'node:module'; import {realpathSync} from 'node:fs'; import {resolve,relative} from 'node:path'; const base=realpathSync(process.cwd()), requireHere=createRequire(resolve('package.json')); const results=['tsx','esbuild','@esbuild/'+process.platform+'-'+process.arch+'/bin/esbuild','./node_modules/typescript/bin/tsc'].map(specifier=>{const path=realpathSync(requireHere.resolve(specifier)); assert.ok(path.startsWith(base+'/')); return {specifier,path,relative:relative(base,path)}}); console.log(JSON.stringify({cwd:base,tsxImport:import.meta.resolve('tsx'),results},null,2));`;
assert.equal(invoke('runtime-resolution', [...prefix, '--input-type=module', '-e', resolver]).exitCode, 0);
assert.equal(invoke('selected-gnu216', [...prefix, join(owned, 'selected-gnu.ts'), 'direct216']).exitCode, 0);
invoke('original104', [...prefix, '--test', ...frozen.independentTests]);
invoke('original311-current-helper', [...prefix, '--test', ...frozen.authorTests], snapshot, { GNU_TABLE_BIN: join(snapshot, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src') });
const selectedTests = frozen.authorTests.map(path => path === 'tests/commands/table-text/differential.test.ts' ? 'tests/commands/table-text-stress/shared-stdin-fix/acceptance216.test.ts' : path);
assert.equal(invoke('selected-gnu311-current-helper', [...prefix, '--test', ...selectedTests]).exitCode, 0);
const focused = files(snapshot, 'tests/commands/table-text-stress/shared-stdin-fix').filter(path => path.endsWith('.test.ts'));
assert.equal(invoke('author-fix-controls', [...prefix, '--test', ...focused]).exitCode, 0);
const metadata = files(snapshot, 'tests/commands/metadata').filter(path => path.endsWith('.test.ts'));
assert.equal(invoke('metadata43', [...prefix, '--test', ...metadata]).exitCode, 0);
assert.equal(invoke('scoped-noemit', ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'comm-review-types.json']).exitCode, 0);
assert.equal(invoke('isolated-build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']).exitCode, 0);
assert.equal(invoke('built-selected71x2', [...prefix, join(owned, 'selected-gnu.ts'), 'built71']).exitCode, 0);
const prior = join(work, 'corrected-prior-source');
assert.ok(!existsSync(prior));
cpSync(snapshot, prior, { recursive: true, verbatimSymlinks: true, filter: path => path !== join(snapshot, 'dist') && !path.split('/').some(part => part.startsWith('.native-')) });
const restored = [];
const authorCommit = '6ef0d8ddd76b430737cc9158c9c3c509fe197097';
for (const path of ['src/commands/table-text/comm.ts', 'src/commands/table-text/internal.ts']) {
  const old = spawnSync('git', ['show', `${authorCommit}^:${path}`], { cwd: root, encoding: 'utf8' });
  assert.equal(old.status, 0);
  chmodSync(join(prior, path), 0o644);
  save(join(prior, path), old.stdout);
  chmodSync(join(prior, path), 0o444);
  restored.push({ path, fixedSha256: frozen.manifest[path], priorSha256: sha(old.stdout) });
}
const priorHashes = hashes(prior, manifestPaths);
assert.deepEqual(drift(frozen.manifest, priorHashes).map(row => row.path), restored.map(row => row.path));
const priorLinks = verify(prior, priorHashes);
assert.equal(invoke('prior-source-noemit', ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.build.json'], prior).exitCode, 0);
const negative = invoke('prior-source-shared-negative', [...prefix, join(owned, 'selected-gnu.ts'), 'shared-negative'], prior);
assert.equal(negative.exitCode, 1);
const observed = json(join(work, negative.name + '.stdout'));
assert.equal(observed.total, 1);
assert.equal(observed.selectedPass, 0);
assert.deepEqual(observed.observations[0].actual, { exitCode: 0, stdoutHex: '0909610a0909620a630a', stderrHex: '' });
assert.match(readFileSync(join(work, negative.name + '.stderr'), 'utf8'), /ERR_ASSERTION/);
verify(prior, priorHashes);
const cleanup = [];
const base = join(snapshot, 'tests/commands/table-text-stress');
const corpus = json(join(base, 'frozen-corpus.json'));
for (const name of readdirSync(base)) {
  if (!name.startsWith('.native-')) continue;
  const directory = join(base, name);
  assert.equal(readFileSync(join(directory, 'sentinel'), 'utf8'), 'independent-table-text-owned');
  const match = corpus.find(({ fixture }) => JSON.stringify(readdirSync(directory).sort()) === JSON.stringify(['sentinel', ...Object.keys(fixture.files)].sort()) && Object.entries(fixture.files).every(([path, hex]) => readFileSync(join(directory, path)).toString('hex') === hex));
  assert.ok(match);
  cleanup.push({ directory, matchingExistingFixture: match.fixture.name, exactBytesAndNamespace: true });
  rmSync(directory, { recursive: true });
}
const containedAfter = verify(snapshot, frozen.manifest);
assert.deepEqual(containedBefore, containedAfter);
const expected = { 'corrected-original104': [103, 1, 'independent frozen GNU: comm shared original'], 'corrected-original311-current-helper': [310, 1, 'explicit GNU duplicate-close disagreement comm: shared stdin'] };
for (const command of commands) {
  if (expected[command.name]) {
    const [pass, fail, failure] = expected[command.name];
    assert.equal(command.exitCode, 1);
    assert.equal(command.pass, pass);
    assert.equal(command.fail, fail);
    assert.deepEqual(command.failures, [failure]);
  } else if (command.name !== negative.name) assert.equal(command.exitCode, 0);
  assert.equal(command.skipped, 0);
}
save(join(work, 'corrected-acceptance.json'), { at: new Date().toISOString(), phase: 'One root-authorized corrected-alias final replay; same570 regular inputs', sourceDigest: frozen.sourceDigest, tableDigest: frozen.tableDigest, helperSha256: frozen.helperSha256, corrections, containedBefore, containedAfter, commands, selectedTests, priorSource: { prior, authorCommit, restored, differences: drift(frozen.manifest, priorHashes), priorLinks, allOtherInputsUnchanged: true, semanticAssertion: true, observed }, cleanup, snapshotInputDrift: [], negativeInputDrift: [], buildHashes: hashes(snapshot, files(snapshot, 'dist')), allChildrenExited: true });
console.log('Corrected contained-alias bounded gate completed on unchanged regular input hashes.');
