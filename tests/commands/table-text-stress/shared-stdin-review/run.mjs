import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { work, owned, gatedSnapshot, json, files, hashes, drift, sha, save, execute } from './tools.mjs';

const snapshot = gatedSnapshot();
const frozen = json(join(work, 'snapshot-manifest.json'));
const before = hashes(snapshot, Object.keys(frozen.manifest));
assert.deepEqual(drift(frozen.manifest, before), []);
const prefix = ['--unhandled-rejections=strict', '--import', 'tsx'];
const commands = [];
const invoke = (name, args, env = {}) => {
  assert.ok(!existsSync(join(work, name + '.command.json')), `No silent replay: ${name}`);
  const result = execute(name, args, snapshot, env);
  commands.push(result);
  save(join(work, 'commands-so-far.json'), commands);
  return result;
};
const selected = invoke('selected-gnu216', [...prefix, join(owned, 'selected-gnu.ts'), 'direct216']);
assert.equal(selected.exitCode, 0, 'Report source defect to root before further acceptance');
invoke('original104', [...prefix, '--test', ...frozen.independentTests]);
invoke('original311-current-helper', [...prefix, '--test', ...frozen.authorTests], { GNU_TABLE_BIN: join(snapshot, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src') });
const focused = files(snapshot, 'tests/commands/table-text-stress/shared-stdin-fix').filter(path => path.endsWith('.test.ts'));
assert.ok(focused.length > 0, 'No author focused controls found');
invoke('author-fix-controls', [...prefix, '--test', ...focused]);
const metadata = files(snapshot, 'tests/commands/metadata').filter(path => path.endsWith('.test.ts'));
invoke('metadata43', [...prefix, '--test', ...metadata]);
invoke('scoped-noemit', ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'comm-review-types.json']);
const build = invoke('isolated-build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);
if (build.exitCode === 0) invoke('built-selected71x2', [...prefix, join(owned, 'selected-gnu.ts'), 'built71']);
const cleanup = [];
const nativeBase = join(snapshot, 'tests/commands/table-text-stress');
const corpus = json(join(nativeBase, 'frozen-corpus.json'));
for (const name of readdirSync(nativeBase)) {
  if (!name.startsWith('.native-')) continue;
  const directory = join(nativeBase, name);
  assert.ok(statSync(directory).isDirectory());
  assert.equal(readFileSync(join(directory, 'sentinel'), 'utf8'), 'independent-table-text-owned');
  const match = corpus.find(({ fixture }) => JSON.stringify(readdirSync(directory).sort()) === JSON.stringify(['sentinel', ...Object.keys(fixture.files)].sort()) && Object.entries(fixture.files).every(([path, hex]) => readFileSync(join(directory, path)).toString('hex') === hex));
  assert.ok(match, 'Refuse unknown native fixture cleanup');
  cleanup.push({ directory, matchingExistingFixture: match.fixture.name, exactBytesAndNamespace: true });
  rmSync(directory, { recursive: true });
}
const after = hashes(snapshot, Object.keys(frozen.manifest));
const snapshotDrift = drift(before, after);
save(join(work, 'acceptance.json'), { snapshot, sourceDigest: frozen.sourceDigest, tableDigest: frozen.tableDigest, helperSha256: frozen.helperSha256, commands, snapshotDrift, cleanup, remainingNativeArtifacts: files(snapshot).filter(path => path.includes('/.native-') || path.includes('/.runtime/native-')), buildHashes: existsSync(join(snapshot, 'dist')) ? hashes(snapshot, files(snapshot, 'dist')) : {}, allChildrenExited: commands.every(command => command.signal === null && command.error === null), originalSixBuiltChecks: 'unavailable; not executed or claimed' });
assert.deepEqual(snapshotDrift, []);
assert.ok(commands.every(command => !command.loadError && command.signal === null && command.error === null));
const expectedFailures = { original104: 'independent frozen GNU: comm shared original', 'original311-current-helper': 'explicit GNU duplicate-close disagreement comm: shared stdin' };
for (const command of commands) {
  const expected = expectedFailures[command.name];
  if (expected) {
    assert.equal(command.exitCode, 1, command.name);
    assert.deepEqual(command.failures, [expected], command.name);
    assert.equal(command.pass, command.name === 'original104' ? 103 : 310, command.name);
  } else assert.equal(command.exitCode, 0, command.name);
}
console.log(JSON.stringify({ sourceDigest: frozen.sourceDigest, tableDigest: frozen.tableDigest, snapshotDrift, commands: commands.map(({ name, exitCode, pass, fail, skipped }) => ({ name, exitCode, pass, fail, skipped })), cleanupCount: cleanup.length }));
