import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { execute, inventory, save, sha256 } from './review-lib.mjs';
import { cursorControls, nativeCursorScript } from './followup-controls.mjs';

const require = createRequire(import.meta.url);
const owned = fileURLToPath(new URL('./', import.meta.url)).replace(/\/$/, '');
const repository = path.resolve(owned, '../../..');
const candidate = '157d78c957b56f83f6e705fc35da60b1f2ea3a9b';
const freeze = '7a47dcdba6175a4eccc9dad16c3ac9733cf0e0bf';
const capture = path.join(owned, 'capture-followup-02');
const scratch = path.join(owned, 'scratch-followup-02');
fs.mkdirSync(capture); fs.mkdirSync(scratch);
fs.writeFileSync(path.join(scratch, '.review-owner'), candidate, { flag: 'wx' });
const initialCapture = path.join(owned, 'capture-01');
const originalManifest = JSON.parse(fs.readFileSync(path.join(initialCapture, 'artifact-manifest.json'), 'utf8'));
const initialInventory = inventory(initialCapture); delete initialInventory['artifact-manifest.json']; assert.deepEqual(initialInventory, originalManifest);
const manifestHashBefore = sha256(fs.readFileSync(path.join(initialCapture, 'artifact-manifest.json')));
const git = (args) => { const run = spawnSync('git', args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 }); assert.equal(run.status, 0); return run.stdout; };
const initialIndex = git(['diff', '--cached', '--raw', '-z']).toString('base64');
const frozen = JSON.parse(fs.readFileSync(path.join(owned, 'freeze-manifest.json'), 'utf8'));
const freezeFiles = ['freeze-manifest.json', ...Object.keys(frozen.controls)];
for (const file of freezeFiles) assert.deepEqual(fs.readFileSync(path.join(owned, file)), git(['show', `${freeze}:tests/shell/getopts-independent-20260827/${file}`]));
const sourceRoot = path.join(scratch, 'source'); fs.mkdirSync(sourceRoot);
const archiveFile = path.join(initialCapture, 'candidate-module-inputs.tar');
const identity = JSON.parse(fs.readFileSync(path.join(initialCapture, 'identity.json'), 'utf8'));
assert.equal(sha256(fs.readFileSync(archiveFile)), identity.archive.sha256);
const extraction = await execute('tar', ['-xf', archiveFile, '-C', sourceRoot], { cwd: scratch }); assert.equal(extraction.status, 0);
const sourceModule = path.join(sourceRoot, 'src/shell/getopts.ts');
assert.equal(sha256(fs.readFileSync(sourceModule)), frozen.candidateScannerSha256ClaimOnly);
const sourceBefore = inventory(sourceRoot); save(path.join(capture, 'source-before.json'), sourceBefore);
fs.mkdirSync(path.join(scratch, 'home')); fs.mkdirSync(path.join(scratch, 'tmp'));
const env = { PATH: process.env.PATH, HOME: path.join(scratch, 'home'), TMPDIR: path.join(scratch, 'tmp'), LC_ALL: 'C', LANG: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1' };
const packageRoot = path.join(scratch, 'staging-package'); fs.mkdirSync(packageRoot); fs.copyFileSync(path.join(sourceRoot, 'package.json'), path.join(packageRoot, 'package.json'));
const tsc = require.resolve('typescript/bin/tsc'); const tsx = require.resolve('tsx'); const typesRoot = path.dirname(path.dirname(require.resolve('@types/node/package.json')));
const build = await execute(process.execPath, [tsc, '--declaration', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--types', 'node', '--typeRoots', typesRoot, '--rootDir', path.join(sourceRoot, 'src'), '--outDir', path.join(packageRoot, 'dist'), sourceModule], { cwd: scratch, env });
save(path.join(capture, 'build-process.json'), build); assert.equal(build.status, 0);
const packageBefore = inventory(packageRoot); save(path.join(capture, 'package-before-move.json'), packageBefore);
const moved = path.join(scratch, 'moved-virtual-bash'); fs.renameSync(packageRoot, moved); assert(!fs.existsSync(packageRoot)); assert.deepEqual(inventory(moved), packageBefore);
save(path.join(capture, 'package-move.json'), { from: packageRoot, to: moved, oldLocationAbsent: true, identicalMembershipAndHashes: true, privateInternalOnly: true });
const typeCounts = []; const cursorCounts = [];
for (const [mode, target, module] of [['source', path.dirname(sourceModule), sourceModule], ['moved', path.join(moved, 'dist/shell'), path.join(moved, 'dist/shell/getopts.js')]]) {
  const typeOutput = path.join(capture, `types-${mode}.json`);
  const types = await execute(process.execPath, [path.join(owned, 'type-review.mjs'), mode, target, typeOutput, path.join(scratch, `types-${mode}`)], { cwd: scratch, env });
  save(path.join(capture, `types-${mode}-process.json`), types);
  const typeResult = JSON.parse(fs.readFileSync(typeOutput, 'utf8')); typeCounts.push({ mode, ...typeResult.counts });
  const output = path.join(capture, `cursor-${mode}.json`);
  const args = ['--experimental-loader', pathToFileURL(path.join(owned, 'audit-loader.mjs')).href]; if (mode === 'source') args.push('--import', pathToFileURL(tsx).href); args.push(path.join(owned, 'cursor-consumer.mjs'));
  const execution = await execute(process.execPath, args, { cwd: scratch, env: { ...env, REVIEW_MODULE: module, REVIEW_OUTPUT: output, REVIEW_MODE: mode, REVIEW_OWNED_ROOT: owned, REVIEW_TOOLING_ROOT: path.join(repository, 'node_modules'), REVIEW_LOAD_LOG: path.join(capture, `cursor-${mode}-loads.jsonl`) } });
  save(path.join(capture, `cursor-${mode}-process.json`), execution);
  const cursor = JSON.parse(fs.readFileSync(output, 'utf8')); cursorCounts.push({ mode, total: cursor.results.length, pass: cursor.results.filter((result) => result.pass).length, fail: cursor.results.filter((result) => !result.pass).length });
}
const nativeCounts = [];
for (const [profile, binary, expectedHash] of [
  ['bash53', '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash', '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c'],
  ['bash32', '/bin/bash', '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3'],
]) {
  assert.equal(sha256(fs.readFileSync(binary)), expectedHash);
  const results = [];
  for (const control of cursorControls) {
    const execution = await execute(binary, ['--noprofile', '--norc', '-c', nativeCursorScript, 'getopts-independent-followup', control.id], { cwd: scratch, env: { ...env, PATH: '/usr/bin:/bin' }, timeout: 2500, cap: 128 * 1024 });
    const expected = Buffer.from(control.expected.flat().join('\0') + '\0');
    const actual = Buffer.from(execution.stdoutBase64, 'base64');
    results.push({ id: control.id, expectedStdoutBase64: expected.toString('base64'), actualFields: actual.toString().split('\0').slice(0, -1), pass: execution.status === 0 && !execution.terminated && actual.equals(expected) && execution.stderr === '', execution });
  }
  save(path.join(capture, `cursor-native-${profile}.json`), { profile, binary, sha256: expectedHash, sourceInformedSupplementNotFrozenHoldouts: true, results });
  nativeCounts.push({ profile, scripts: results.length, records: results.length * 2, pass: results.filter((result) => result.pass).length, fail: results.filter((result) => !result.pass).length });
}
const baseline = JSON.parse(fs.readFileSync(path.join(initialCapture, 'source.json'), 'utf8'));
const passing = new Set(baseline.results.filter((result) => result.status === 'pass').map((result) => result.id));
const mutationAudit = [];
for (let ordinal = 1; ordinal <= 16; ordinal++) {
  const id = `M${String(ordinal).padStart(2, '0')}`;
  const run = JSON.parse(fs.readFileSync(path.join(initialCapture, `${id}.json`), 'utf8'));
  const loaded = JSON.parse(fs.readFileSync(path.join(initialCapture, `${id}-load.json`), 'utf8'));
  const witnesses = run.results.filter((result) => result.status === 'fail' && passing.has(result.id) && (result.error?.name === 'AssertionError' || result.error?.message?.startsWith('watchdog:'))).map((result) => ({ id: result.id, error: result.error }));
  const excludedBaselineFailures = run.results.filter((result) => result.status === 'fail' && !passing.has(result.id)).map((result) => result.id);
  mutationAudit.push({ id, loadPassed: loaded.status === 0, status: loaded.status === 0 && witnesses.length ? 'killed' : 'not-proven-killed', witnesses, excludedBaselineFailures });
}
save(path.join(capture, 'mutation-baseline-audit.json'), mutationAudit);
const sourceAfter = inventory(sourceRoot); const packageAfter = inventory(moved); save(path.join(capture, 'source-after.json'), sourceAfter); save(path.join(capture, 'package-after.json'), packageAfter);
const finalInitialInventory = inventory(initialCapture); delete finalInitialInventory['artifact-manifest.json'];
const preservation = { sourceUnchanged: JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter), movedPackageUnchanged: JSON.stringify(packageBefore) === JSON.stringify(packageAfter), allEntryMembershipChecked: true,
  originalCaptureUnchanged: JSON.stringify(finalInitialInventory) === JSON.stringify(originalManifest) && sha256(fs.readFileSync(path.join(initialCapture, 'artifact-manifest.json'))) === manifestHashBefore,
  freezeUnchanged: freezeFiles.every((file) => fs.readFileSync(path.join(owned, file)).equals(git(['show', `${freeze}:tests/shell/getopts-independent-20260827/${file}`]))),
  initialIndex, finalIndex: git(['diff', '--cached', '--raw', '-z']).toString('base64') };
save(path.join(capture, 'preservation.json'), preservation);
save(path.join(capture, 'summary.json'), { candidate, freeze, originalArchiveSha256: identity.archive.sha256, typeCounts, cursorCounts, nativeCounts, mutantsKilledAfterBaselineAudit: mutationAudit.filter((entry) => entry.status === 'killed').length, preservation, frozenExpectationsChanged: false });
assert.equal(fs.realpathSync(path.dirname(scratch)), fs.realpathSync(owned)); assert.equal(fs.readFileSync(path.join(scratch, '.review-owner'), 'utf8'), candidate); fs.rmSync(scratch, { recursive: true });
save(path.join(capture, 'cleanup.json'), { ownedScratchRemoved: !fs.existsSync(scratch), childrenAwaited: true, immutableOriginalCaptureRetained: true });
save(path.join(capture, 'artifact-manifest.json'), inventory(capture));
console.log(JSON.stringify({ typeCounts, cursorCounts, nativeCounts, mutantsKilledAfterBaselineAudit: mutationAudit.filter((entry) => entry.status === 'killed').length, preservation }));
