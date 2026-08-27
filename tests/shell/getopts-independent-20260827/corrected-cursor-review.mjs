import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { execute, inventory, save, sha256 } from './review-lib.mjs';

const require = createRequire(import.meta.url);
const owned = fileURLToPath(new URL('./', import.meta.url)).replace(/\/$/, ''); const repository = path.resolve(owned, '../../..');
const candidate = '157d78c957b56f83f6e705fc35da60b1f2ea3a9b'; const freeze = '7a47dcdba6175a4eccc9dad16c3ac9733cf0e0bf';
const capture = path.join(owned, 'capture-corrected-03'); const scratch = path.join(owned, 'scratch-corrected-03'); fs.mkdirSync(capture); fs.mkdirSync(scratch); fs.writeFileSync(path.join(scratch, '.review-owner'), candidate);
const initialCapture = path.join(owned, 'capture-01'); const followupCapture = path.join(owned, 'capture-followup-02');
const priorInventories = Object.fromEntries([initialCapture, followupCapture].map((directory) => {
  const expected = JSON.parse(fs.readFileSync(path.join(directory, 'artifact-manifest.json'), 'utf8')); const actual = inventory(directory); delete actual['artifact-manifest.json']; assert.deepEqual(actual, expected); return [directory, inventory(directory)];
}));
const frozen = JSON.parse(fs.readFileSync(path.join(owned, 'freeze-manifest.json'), 'utf8')); const freezeFiles = ['freeze-manifest.json', ...Object.keys(frozen.controls)];
const committed = (filename) => { const result = spawnSync('git', ['show', `${freeze}:tests/shell/getopts-independent-20260827/${filename}`], { cwd: repository }); assert.equal(result.status, 0); return result.stdout; };
for (const file of freezeFiles) assert.deepEqual(fs.readFileSync(path.join(owned, file)), committed(file));
const sourceRoot = path.join(scratch, 'source'); fs.mkdirSync(sourceRoot);
const extraction = await execute('tar', ['-xf', path.join(initialCapture, 'candidate-module-inputs.tar'), '-C', sourceRoot], { cwd: scratch }); assert.equal(extraction.status, 0);
const sourceModule = path.join(sourceRoot, 'src/shell/getopts.ts'); assert.equal(sha256(fs.readFileSync(sourceModule)), frozen.candidateScannerSha256ClaimOnly);
const sourceBefore = inventory(sourceRoot); save(path.join(capture, 'source-before.json'), sourceBefore);
const staging = path.join(scratch, 'staging-package'); fs.mkdirSync(path.join(staging, 'dist/shell'), { recursive: true });
fs.copyFileSync(path.join(sourceRoot, 'package.json'), path.join(staging, 'package.json'));
fs.copyFileSync(path.join(initialCapture, 'emitted-getopts.js.data'), path.join(staging, 'dist/shell/getopts.js'));
fs.copyFileSync(path.join(initialCapture, 'emitted-getopts.d.ts.data'), path.join(staging, 'dist/shell/getopts.d.ts'));
const packageBefore = inventory(staging); assert.deepEqual(packageBefore, JSON.parse(fs.readFileSync(path.join(initialCapture, 'package-before-move.json'), 'utf8')));
const moved = path.join(scratch, 'moved-virtual-bash'); fs.renameSync(staging, moved);
save(path.join(capture, 'package-move.json'), { from: staging, to: moved, oldLocationAbsent: !fs.existsSync(staging), packageBefore, reusedAuthenticatedOriginalBuild: true, rebuiltThisPhase: false });
fs.mkdirSync(path.join(scratch, 'tmp')); fs.mkdirSync(path.join(scratch, 'home'));
const env = { PATH: process.env.PATH, TMPDIR: path.join(scratch, 'tmp'), HOME: path.join(scratch, 'home'), TSX_DISABLE_CACHE: '1', LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
const runs = [];
for (const [mode, module] of [['source', sourceModule], ['moved', path.join(moved, 'dist/shell/getopts.js')]]) {
  const output = path.join(capture, `corrected-${mode}.json`); const args = ['--experimental-loader', pathToFileURL(path.join(owned, 'audit-loader.mjs')).href];
  if (mode === 'source') args.push('--import', pathToFileURL(require.resolve('tsx')).href); args.push(path.join(owned, 'corrected-cursor-consumer.mjs'));
  const execution = await execute(process.execPath, args, { cwd: scratch, env: { ...env, REVIEW_MODULE: module, REVIEW_OUTPUT: output, REVIEW_MODE: mode, REVIEW_OWNED_ROOT: owned, REVIEW_TOOLING_ROOT: path.join(repository, 'node_modules'), REVIEW_LOAD_LOG: path.join(capture, `corrected-${mode}-loads.jsonl`) } });
  save(path.join(capture, `corrected-${mode}-process.json`), execution); const result = JSON.parse(fs.readFileSync(output, 'utf8')); runs.push({ mode, counts: result.counts });
}
const nativeComparisons = [];
for (const profile of ['bash53', 'bash32']) for (const mode of ['source', 'moved']) {
  const native = JSON.parse(fs.readFileSync(path.join(followupCapture, `cursor-native-${profile}.json`), 'utf8'));
  const product = JSON.parse(fs.readFileSync(path.join(followupCapture, `cursor-${mode}.json`), 'utf8'));
  for (const result of product.results) {
    const oracle = native.results.find((entry) => entry.id === result.id);
    const productBytes = Buffer.from(result.actual.flat().join('\0') + '\0'); const nativeBytes = Buffer.from(oracle.execution.stdoutBase64, 'base64');
    nativeComparisons.push({ profile, mode, id: result.id, records: result.actual.length, pass: oracle.execution.status === 0 && oracle.execution.stderr === '' && productBytes.equals(nativeBytes), nativeBytesSha256: sha256(nativeBytes), productBytesSha256: sha256(productBytes) });
  }
}
save(path.join(capture, 'native-actual-transcript-comparison.json'), { scope: 'analysis of retained followup executions; zero new native runs', comparisons: nativeComparisons });
const sourceAfter = inventory(sourceRoot); const packageAfter = inventory(moved); save(path.join(capture, 'source-after.json'), sourceAfter); save(path.join(capture, 'package-after.json'), packageAfter);
const preservation = { sourceUnchanged: JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter), movedPackageUnchanged: JSON.stringify(packageBefore) === JSON.stringify(packageAfter), allEntryMembershipChecked: true,
  previousCapturesUnchanged: Object.entries(priorInventories).every(([directory, before]) => JSON.stringify(inventory(directory)) === JSON.stringify(before)), freezeUnchanged: freezeFiles.every((file) => fs.readFileSync(path.join(owned, file)).equals(committed(file))) };
save(path.join(capture, 'summary.json'), { candidate, freeze, runs, nativeComparisons: { totalScenarioComparisons: nativeComparisons.length, pass: nativeComparisons.filter((entry) => entry.pass).length, distinctNativeScriptsPreviouslyRun: 3, distinctRecordsPerNativeProfile: 6, newNativeRuns: 0 }, frozenP03StillFailed: true, candidateBugConfirmed: false, preservation });
assert.equal(fs.realpathSync(path.dirname(scratch)), fs.realpathSync(owned)); assert.equal(fs.readFileSync(path.join(scratch, '.review-owner'), 'utf8'), candidate); fs.rmSync(scratch, { recursive: true });
save(path.join(capture, 'cleanup.json'), { ownedScratchRemoved: !fs.existsSync(scratch), childrenAwaited: true }); save(path.join(capture, 'artifact-manifest.json'), inventory(capture));
console.log(JSON.stringify({ runs, nativeScenarioComparisons: nativeComparisons.length, nativeScenarioMatches: nativeComparisons.filter((entry) => entry.pass).length, preservation }));
