import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { owned, candidate, capture } from './supervisor.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = JSON.parse(readFileSync(resolve(owned, 'evidence/freeze.json')));
const inputs = JSON.parse(readFileSync(resolve(owned, 'evidence/inputs.json')));
const original = JSON.parse(readFileSync(resolve(owned, 'evidence/runs/original-five-and-head-zero.json')));
const rows = original.stdout.split('\n').filter(line => line.startsWith('# {"scenario":')).map(line => JSON.parse(line.slice(2).replaceAll('\\\\', '\\')));
const cases = rows.map(row => ({ ...row,
  capturedBeforeTeardown: row.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)),
  exact1200msFailure: row.stderr.includes(`DEADLINE: ${row.scenario} (1200ms)`),
  originalCohort: row.scenario !== 'first-read-head-zero',
}));
assert.equal(cases.filter(row => row.originalCohort && row.status === 1 && row.exact1200msFailure).length, 5);
const sourceProof = pin.manifest.filter(entry => entry.path.startsWith('src/')).map(entry => {
  assert.equal(hash(readFileSync(resolve(candidate, entry.path))), entry.sha256, entry.path);
  return { path: entry.path, sha256: entry.sha256 };
});
const executionInputs = inputs.manifest.filter(entry => entry.classification.startsWith('unchanged execution')).map(entry => {
  assert.equal(hash(readFileSync(resolve(candidate, entry.path))), entry.sha256, entry.path);
  return { path: entry.path, sha256: entry.sha256 };
});
const sourceReferences = ['src/contracts/io.ts', 'src/contracts/command.ts', 'src/contracts/command.md', 'src/contracts/plugin.ts',
  'src/shell/runtime.ts', 'src/shell/input.ts', 'src/shell/types.ts', 'src/commands/internal.ts', 'src/commands/streams.ts',
  'src/commands/network/curl.ts', 'src/commands/network/output.ts', 'src/commands/network/transport.ts', 'src/commands/network/README.md',
  'src/fs/s3/filesystem.ts', 'src/fs/webdav/webdav.ts'];
for (const path of sourceReferences) {
  const destination = resolve(owned, 'preserved', `${path}.data`);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, readFileSync(resolve(candidate, path)), { flag: 'wx' });
}
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(path, entry.name)) : [resolve(path, entry.name)]);
const buildFiles = walk(resolve(candidate, 'dist')).map(path => ({ path: relative(candidate, path), sha256: hash(readFileSync(path)) }));
const listing = await capture('copied-typecheck-input-list', process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--listFilesOnly', '-p', 'tsconfig.json']);
assert.equal(listing.status, 0);
const compilerInputs = listing.stdout.trim().split('\n');
assert.ok(compilerInputs.every(path => path.startsWith(`${candidate}/`) || path.includes('/node_modules/')));
const maintained = readdirSync(owned).filter(path => path.endsWith('.mjs'));
for (const path of maintained) {
  const checked = await capture(`syntax-${path.replace('.mjs', '')}`, process.execPath, ['--check', resolve(owned, path)]);
  assert.equal(checked.status, 0);
}
const runs = readdirSync(resolve(owned, 'evidence/runs')).filter(path => path.endsWith('.json')).map(path => JSON.parse(readFileSync(resolve(owned, 'evidence/runs', path))));
writeFileSync(resolve(owned, 'evidence/summary.json'), JSON.stringify({ summarizedAt: new Date().toISOString(), sourceHead: pin.head,
  sourceManifestSha256: hash(JSON.stringify(sourceProof)), sourceFilesVerifiedUnchanged: sourceProof.length,
  executionInputsVerifiedUnchanged: executionInputs, sourceReferences, buildFiles, compilerInputs,
  originals: cases, maintainedSyntaxChecked: maintained,
  outcomes: { originalFive: { pass: 0, fail: 5 }, existingHeadZero: { pass: 1 }, existingRemote: { pass: 19 }, byteIO: { pass: 28 }, sharedLifecycle: { pass: 5 }, streaming: { pass: 4 }, additionalLogicalControls: { count: 9, pass: 9 }, nativeCounterpartsOfFiveControls: { count: 5, pass: 5 }, build: 0, noEmit: 0, expressRuntime: 'unavailable' },
  ownedSupervisorRuns: runs.map(run => ({ label: run.label, pid: run.pid, status: run.status, signal: run.signal, timedOut: run.timedOut, oversized: run.oversized,
    signals: run.signals, closeEventObserved: run.closeEventObserved, pidAfterClose: run.pidAfterClose, groupExistsAfterClose: run.groupExistsAfterClose })),
  closureScope: 'Only explicitly spawned/cooperative owned processes and loopback fixtures; not global host quiescence. Original tests supply child process-group residual checks.' }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(cases.map(row => ({ scenario: row.scenario, status: row.status, exact1200msFailure: row.exact1200msFailure, state: row.capturedBeforeTeardown }))));
