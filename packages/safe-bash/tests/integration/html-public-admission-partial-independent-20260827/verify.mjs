import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expected, hashes, identity, inventory, own, write } from './common.mjs';

export function verifyExecution() {
  const output = join(own, 'execution');
  const read = name => JSON.parse(readFileSync(join(output, name)));
  const extras = read('extras/SUMMARY.json');
  assert.equal(extras.controls, 4); assert.equal(extras.passed, 4); assert.equal(extras.failed, 0);
  const ids = ['actual-materialize-content-hash', 'actual-materialize-mode-before-acquisition', 'actual-materialize-unknown-link-before-acquisition', 'raw-commit-corruption-before-object-import'];
  const controls = ids.map(name => read(`extras/${name}.json`));
  assert.ok(controls.every(row => row.status === 'pass' && row.error.code === row.expectedBoundary));
  const report = read('admission/REPORT.json');
  assert.equal(report.status, 'admission-proof-complete-review-pending');
  const inputs = read('admission/INPUTS.json');
  assert.equal(inputs.count, 410); assert.equal(inputs.all410Sha256, expected.inputs);
  assert.equal(inputs.materialized.symlinks, 0);
  const buildView = join(report.scratch, 'build');
  const modes = inputs.inputs.map(entry => {
    const actual = identity(join(buildView, entry.path));
    assert.equal(actual.sha256, entry.sha256); assert.equal(actual.mode, entry.mode); assert.equal(actual.blob, entry.blob);
    return { path: entry.path, ...actual };
  });
  write(join(output, 'MODE-BLOB-NAME-POST.json'), { count: modes.length, files: modes });
  const pack = read('admission/PACK.json');
  assert.equal(pack.sha256, expected.pack); assert.equal(pack.count, 830); assert.equal(pack.emittedCount, 828);
  const before = read('admission/BUILD-VIEW-PRE.json');
  const expectedView = { ...before, ...Object.fromEntries(Object.entries(pack.files).filter(([name]) => name.startsWith('dist/'))) };
  assert.deepEqual(hashes(inventory(buildView)), expectedView);
  assert.deepEqual(hashes(inventory(join(report.scratch, 'packed/package'))), pack.files);
  const archives = ['archive-before', 'archive-after'].map(label => read(`admission/${label}.RAW.json`));
  for (const archive of archives) { assert.equal(archive.bytes, 2340945920); assert.equal(archive.sha256, expected.archive); assert.equal(archive.process.status, 0); assert.equal(archive.process.signal, null); assert.equal(archive.maxPendingConsumers, 1); assert.ok(archive.maxChunkBytes <= 65536); }
  const reconstructed = read('reconstruction/RESULT.json');
  assert.equal(reconstructed.scopedInputs, 410); assert.equal(reconstructed.parentDeltaPaths, 2); assert.equal(reconstructed.fullClone, false); assert.equal(reconstructed.candidateSourceCommitRead, false);
  assert.equal(report.reconstruction.scopedInputs, 410); assert.equal(report.reconstruction.parentDeltaPaths, 2); assert.equal(report.reconstruction.fullClone, false);
  const reachable = read('reconstruction/REACHABLE-INPUTS.json');
  assert.equal(reachable.materialized.files, 410); assert.equal(reachable.materialized.symlinks, 0);
  const reconstructionPre = read('reconstruction/PRE.json');
  assert.deepEqual(hashes(inventory(join(reconstructionPre.scratch, 'inputs'))), Object.fromEntries(inputs.inputs.map(entry => [entry.path, entry.sha256])));
  for (const entry of inputs.inputs) { const actual = identity(join(reconstructionPre.scratch, 'inputs', entry.path)); assert.equal(actual.mode, entry.mode); assert.equal(actual.blob, entry.blob); }
  const traceFiles = readdirSync(join(output, 'trace')).sort();
  const traceReports = [];
  const compilerInputs = read('admission/COMPILER-INPUTS.json');
  const sourceNames = compilerInputs.files.filter(entry => entry.path.startsWith('src/')).map(entry => entry.path).sort();
  for (const filename of traceFiles) {
    const rows = readFileSync(join(output, 'trace', filename), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const start = rows[0], exit = rows.at(-1);
    assert.equal(start.kind, 'start'); assert.equal(exit.kind, 'exit'); assert.equal(exit.code, 0);
    const modules = rows.filter(row => row.kind === 'compile' || row.kind === 'load');
    assert.ok(modules.length > 0);
    if (start.command === 'build') {
      const actualReads = new Map(rows.filter(row => row.kind === 'read').map(row => [relative(buildView, row.path), row.sha256]));
      for (const input of compilerInputs.files) assert.equal(actualReads.get(input.path), input.sha256, `actual build read ${input.path}`);
      assert.deepEqual([...actualReads.keys()].filter(name => name.startsWith('src/') && name.endsWith('.ts')).sort(), sourceNames);
    }
    const spawns = rows.filter(row => row.kind === 'spawn');
    for (const spawn of spawns) assert.ok(rows.some(row => row.kind === 'child-close' && row.pid === spawn.pid), `child settlement ${spawn.pid}`);
    traceReports.push({ filename, command: start.command, records: rows.length, modules: modules.length, compiledModules: rows.filter(row => row.kind === 'compile').length, reads: rows.filter(row => row.kind === 'read').length, asyncChildren: spawns.length, syncChildren: rows.filter(row => row.kind === 'spawn-sync-return').length, exitCode: exit.code });
  }
  assert.deepEqual(traceReports.map(entry => entry.command).sort(), ['admission', 'build', 'compiler-config', 'compiler-inputs', 'extras', 'npm-pack', 'reconstruction'].sort());
  const summary = { schema: 'html-partial-result/1', controls: controls.map(({ name, expectedBoundary, status }) => ({ name, expectedBoundary, status })), passed: 4, inputs: { count: 410, bytes: inputs.materialized.bytes, sha256: inputs.all410Sha256, sourceEntries: 248, actualCompilerCandidateFiles: compilerInputs.candidateFiles, actualCompilerFiles: compilerInputs.totalFilesIncludingAuthenticatedTools }, archives, pack: { hash: pack.sha256, bytes: pack.tarballBytes, members: pack.count, dist: pack.emittedCount }, reconstruction: { admission: report.reconstruction, parentAuthorOnly: reconstructed, fullClone: false, deltaPaths: 2 }, traceReports, appendChecks: 'Fresh full recursive file/kind/hash inventories for build, packed and parent-author materialization; reject added files and all symlinks. Empty directory additions are not claimed detected.', actualToolProof: 'Synchronous Node load hooks and CJS compilation records authenticate executable module bytes; actual build reads match all 373 listed compiler inputs. No product behavior/import/public-consumer execution claim.', old35: 0, actualHtml34: 0, resourceV32: 0, du29: 0, globalAcceptance: false };
  write(join(output, 'VERIFIED.json'), summary);
  return summary;
}
