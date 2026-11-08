import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync, accessSync, constants, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { owned, work, hash, inventory, save } from './prepare.mjs';
const load = name => JSON.parse(readFileSync(join(owned, name)));
const provenance = load('provenance.json');
const { source, installed, candidate } = provenance;
const archiveBefore = load('archive-before.json'), archiveAfter = inventory(source);
const originalPaths = archiveAfter.filter(entry => entry.path !== 'dist' && !entry.path.startsWith('dist/'));
assert.deepEqual(originalPaths, archiveBefore, 'all archived paths and additions except declared build output');
const sourceAfter = inventory(join(source, 'src')), compiledAfter = inventory(join(source, 'dist')), installedAfter = inventory(installed);
assert.deepEqual(sourceAfter, load('source-before.json'));
assert.deepEqual(compiledAfter, load('compiled-before.json'));
assert.deepEqual(installedAfter, load('installed-before.json'));
assert.equal(hash(readFileSync(join(work, 'candidate.tar'))), provenance.archiveSha256);
const packageName = JSON.parse(load('pack.json').stdout)[0].filename;
assert.equal(hash(readFileSync(join(work, packageName))), provenance.artifactSha256);
save('archive-after.json', archiveAfter);
save('source-after.json', sourceAfter);
save('compiled-after.json', compiledAfter);
save('installed-after.json', installedAfter);
const named = load('named-initial-unqualified-ambient.json');
const sequencing = load('sequencing-summary.json');
const core = load('core-controls.json');
assert.equal(sequencing.activeWorkers, 0); assert.equal(named.activeWorkers, 0);
assert.equal(core.failedSubcases.length, 0);
assert(core.rows.every(row => row.terminationAwaited && row.state === 'returned' && (row.value?.activeBeforeSafetyCleanup ?? 0) === 0));
const moved = JSON.parse(load('moved-runtime-flags.json').stdout); assert.equal(moved.activeWorkers, 0);
const native = load('native-prerequisites.json'); assert.equal(hash(readFileSync(native.native)), native.expectedHash);
const rgPath = (process.env.PATH ?? '').split(':').map(path => join(path, 'rg')).find(path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } });
assert(rgPath);
const rg = { path: rgPath, realpath: realpathSync(rgPath), sha256: hash(readFileSync(rgPath)), version: spawnSync(rgPath, ['--version'], { encoding: 'utf8', timeout: 3000 }).stdout };
const sourceHashes = sourceAfter.filter(entry => entry.type === 'file' && (entry.path.startsWith('commands/expr/') || entry.path.startsWith('commands/regex-execution/')));
const declaredBuildAdditions = archiveAfter.filter(entry => entry.path === 'dist' || entry.path.startsWith('dist/'));
save('integrity.json', { candidate, completedAt: new Date().toISOString(), archiveSha256: provenance.archiveSha256, artifactSha256: provenance.artifactSha256,
  archiveBeforeEntries: archiveBefore.length, archiveAfterEntries: archiveAfter.length, sourceEntries: sourceAfter.length, compiledEntries: compiledAfter.length, installedEntries: installedAfter.length,
  beforeAfterEqual: { originalArchiveIncludingAddedEntries: true, completeSourceIncludingAddedEntries: true, completeCompiledIncludingAddedEntries: true, completeInstalledIncludingAddedEntries: true, tarAndPackUnchanged: true },
  declaredBuildAdditions, sourceHashes, nativeRgPrerequisite: rg, ownedWorkerChecks: { sequencing: 0, named: 0, moved: 0, containedCoreJobs: core.rows.length, allCoreTerminationAwaited: true },
  limits: 'Before/after equality detects append/remove/modify differences at observation times, not transient mutation or a filesystem transaction. Archived tracked inputs are the candidate; unrelated live edits neither enter nor veto it. Static/module confinement is scoped, not a JavaScript sandbox or opaque-host wait guarantee.' });
const nativeScratch = ['shared-native-temp-cleanup.json', 'shared-final-temp-cleanup.json'].map(name => load(name));
for (const record of nativeScratch) assert(!existsSync(record.scratch));
assert(!existsSync(join(source, 'tests/commands/metadata-stress')));
const removed = inventory(work).length;
rmSync(work, { recursive: true });
assert(!existsSync(work));
save('cleanup.json', { completedAt: new Date().toISOString(), work, removedEntries: removed, workRemoved: true, declaredOracleSymlinkRemoved: true, externalNativeScratch: nativeScratch, noOwnWorkersReported: true, nativeRawCaptureRemovedNotCommitted: true, archiveSourceCompiledInstalledTarAndPackRemovedAfterAuthenticatedPostchecks: true, scope: 'Only own temporary archives, build outputs, consumer installations, raw native captures and explicitly tracked scratch. No other workers or root files touched.' });
console.log(JSON.stringify({ archiveEntries: archiveBefore.length, sourceEntries: sourceAfter.length, compiledEntries: compiledAfter.length, installedEntries: installedAfter.length, removed }));
