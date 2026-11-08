import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

const root = process.cwd();
const owned = resolve('tests/shell-stress/first-read-contract-review');
const scratch = resolve(owned, '.scratch');
const candidate = resolve(scratch, 'candidate');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = JSON.parse(readFileSync(resolve(owned, 'evidence/freeze.json')));
const summary = JSON.parse(readFileSync(resolve(owned, 'evidence/summary.json')));
const inputs = JSON.parse(readFileSync(resolve(owned, 'evidence/inputs.json')));
const sourcePaths = pin.manifest.filter(entry => entry.path.startsWith('src/') || ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(entry.path));
const dirtyArchives = [];
for (const entry of sourcePaths) {
  const bytes = readFileSync(resolve(candidate, entry.path));
  assert.equal(hash(bytes), entry.sha256, entry.path);
  const committed = execFileSync('git', ['show', `${pin.head}:${entry.path}`], { maxBuffer: 8 * 1024 * 1024 });
  if (hash(committed) !== entry.sha256) {
    const archive = resolve(owned, 'preserved', `${entry.path}.data`);
    mkdirSync(dirname(archive), { recursive: true });
    writeFileSync(archive, bytes, { flag: 'wx' });
    dirtyArchives.push({ path: entry.path, sha256: entry.sha256, archive: relative(owned, archive) });
  }
}
for (const run of summary.ownedSupervisorRuns) {
  assert.equal(run.closeEventObserved, true);
  assert.equal(run.pidAfterClose, '');
  assert.equal(run.groupExistsAfterClose, false);
  assert.equal(run.signals.length, 0);
  assert.equal(run.timedOut, false);
}
const nativeFixtures = readdirSync(scratch).filter(name => name.startsWith('native-'));
assert.deepEqual(nativeFixtures.sort(), ['native-C3', 'native-C4', 'native-C5', 'native-C6', 'native-C7']);
rmSync(scratch, { recursive: true });
const restored = spawnSync(process.execPath, [resolve(owned, 'restore.mjs')], { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
assert.equal(restored.status, 0, restored.stderr);
const restoredPaths = new Map(sourcePaths.map(entry => [entry.path, entry.sha256]));
for (const entry of inputs.manifest.filter(entry => entry.classification.startsWith('unchanged execution'))) restoredPaths.set(entry.path, entry.sha256);
for (const [path, expected] of restoredPaths) assert.equal(hash(readFileSync(resolve(candidate, path))), expected, path);
rmSync(scratch, { recursive: true });
const maintained = readdirSync(owned).filter(path => path.endsWith('.mjs'));
const syntax = maintained.map(path => {
  const checked = spawnSync(process.execPath, ['--check', resolve(owned, path)], { encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
  assert.equal(checked.status, 0, checked.stderr);
  return { path, command: [process.execPath, '--check', resolve(owned, path)], pid: checked.pid, status: checked.status, signal: checked.signal, stdout: checked.stdout, stderr: checked.stderr };
});
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(path, entry.name)) : [resolve(path, entry.name)]);
const ownedTypeScript = walk(owned).filter(path => /\.(?:ts|mts|cts)$/.test(path));
const ownedDiscoveredTests = walk(owned).filter(path => path.endsWith('.test.ts'));
assert.equal(ownedTypeScript.length, 0);
assert.equal(ownedDiscoveredTests.length, 0);
const closure = { finishedAt: new Date().toISOString(), pinStartedAt: pin.frozenAt,
  currentHeadForContextOnly: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  currentForeignStatusForContextOnly: execFileSync('git', ['status', '--short', '--untracked-files=no'], { encoding: 'utf8' }),
  dirtyArchives, scratchRemoved: !existsSync(scratch), nativeFixturesRemoved: nativeFixtures,
  restore: { command: [process.execPath, resolve(owned, 'restore.mjs')], pid: restored.pid, status: restored.status, signal: restored.signal, stdout: restored.stdout, stderr: restored.stderr, sourceAndInputFilesHashVerified: restoredPaths.size, executionCasesRerun: 0 },
  maintainedSyntaxChecks: syntax, ownedTypeScript, ownedDiscoveredTests,
  canonicalInventory: 'Only maintained .mjs harnesses, syntax checked. Archived source/test/native payloads use .data/.bash-data; temporary TS execution tree removed. Root config unchanged.',
  lifecycle: 'All recorded supervised runs reaped/drained with no residual group, no sent kill or SIGSTOP. No persistent owned server/worker. Root must independently verify leaf CLOSED after return.',
  scope: 'No global quiescence, release qualification, 72-hour completion or other-owner acceptance claim.' };
writeFileSync(resolve(owned, 'evidence/closure.json'), JSON.stringify(closure, null, 2) + '\n', { flag: 'wx' });
const artifacts = walk(owned).filter(path => path !== resolve(owned, 'evidence/artifacts.json')).map(path => ({ path: relative(owned, path), bytes: readFileSync(path).length, sha256: hash(readFileSync(path)) }));
writeFileSync(resolve(owned, 'evidence/artifacts.json'), JSON.stringify({ generatedAt: new Date().toISOString(), selfExcluded: true, artifacts }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ dirtyArchives, scratchRemoved: closure.scratchRemoved, restoredVerifiedFiles: restoredPaths.size, maintainedSyntaxChecked: syntax.length, archivedArtifacts: artifacts.length, ownTypeScriptDiscovery: ownedTypeScript.length }));
