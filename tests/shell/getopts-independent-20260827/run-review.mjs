import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { execute, inventory, save, sha256 } from './review-lib.mjs';
import { semanticControls, nativeControls } from './semantic-controls.mjs';
import { mutations } from './mutation-definitions.mjs';

const require = createRequire(import.meta.url);
const owned = fileURLToPath(new URL('./', import.meta.url)).replace(/\/$/, '');
const repository = path.resolve(owned, '../../..');
const candidate = '157d78c957b56f83f6e705fc35da60b1f2ea3a9b';
const freeze = '7a47dcdba6175a4eccc9dad16c3ac9733cf0e0bf';
const name = process.argv[2];
assert(name && /^capture-[a-zA-Z0-9-]+$/.test(name), 'supply a unique capture-* name');
const capture = path.join(owned, name);
fs.mkdirSync(capture);
const scratch = path.join(owned, `scratch-${name}`);
fs.mkdirSync(scratch);
fs.writeFileSync(path.join(scratch, '.review-owner'), `${candidate}\n${capture}\n`, { flag: 'wx' });
const git = (args) => {
  const result = spawnSync('git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString()); return result.stdout;
};
const initialIndex = git(['diff', '--cached', '--raw', '-z']).toString('base64');
const initialStatus = git(['status', '--short']).toString();
const freezeManifest = JSON.parse(fs.readFileSync(path.join(owned, 'freeze-manifest.json'), 'utf8'));
const frozenFiles = ['freeze-manifest.json', ...Object.keys(freezeManifest.controls)];
const freezeBefore = {};
for (const file of frozenFiles) {
  const current = fs.readFileSync(path.join(owned, file));
  assert.deepEqual(current, git(['show', `${freeze}:tests/shell/getopts-independent-20260827/${file}`]), `${file}: freeze mismatch`);
  freezeBefore[file] = sha256(current);
}
const frozenCheck = await execute(process.execPath, [path.join(owned, 'verify-freeze.mjs')], { cwd: repository });
save(path.join(capture, 'freeze-verification.json'), frozenCheck);
assert.equal(frozenCheck.status, 0);
const sourceBlob = git(['show', `${candidate}:src/shell/getopts.ts`]);
assert.equal(sha256(sourceBlob), freezeManifest.candidateScannerSha256ClaimOnly);
const packageBlob = git(['show', `${candidate}:package.json`]);
const archive = git(['archive', '--format=tar', candidate, 'src/shell/getopts.ts', 'package.json']);
fs.writeFileSync(path.join(capture, 'candidate-module-inputs.tar'), archive, { flag: 'wx' });
fs.writeFileSync(path.join(capture, 'candidate-scanner.ts.data'), sourceBlob, { flag: 'wx' });
fs.writeFileSync(path.join(capture, 'candidate-tree.txt'), git(['ls-tree', '-r', '-l', '--full-tree', candidate]), { flag: 'wx' });
const sourceRoot = path.join(scratch, 'source'); fs.mkdirSync(sourceRoot);
const extraction = await execute('tar', ['-xf', path.join(capture, 'candidate-module-inputs.tar'), '-C', sourceRoot], { cwd: scratch });
assert.equal(extraction.status, 0);
const sourceModule = path.join(sourceRoot, 'src/shell/getopts.ts');
assert.deepEqual(fs.readFileSync(sourceModule), sourceBlob);
assert.deepEqual(fs.readFileSync(path.join(sourceRoot, 'package.json')), packageBlob);
const sourceBefore = inventory(sourceRoot);
assert(!Object.values(sourceBefore).some((entry) => entry.type === 'symlink'));
save(path.join(capture, 'source-before.json'), sourceBefore);
for (const name of ['home', 'tmp', 'native']) fs.mkdirSync(path.join(scratch, name));
const baseEnv = { PATH: process.env.PATH, HOME: path.join(scratch, 'home'), TMPDIR: path.join(scratch, 'tmp'), TZ: 'UTC', LC_ALL: 'C', LANG: 'C', TSX_DISABLE_CACHE: '1' };
const tsx = require.resolve('tsx'); const tsc = require.resolve('typescript/bin/tsc');
const typesRoot = path.dirname(path.dirname(require.resolve('@types/node/package.json')));
const sourceData = path.join(capture, 'candidate-scanner.ts.data');
const runHarness = async (label, module, mode, controls = []) => {
  const output = path.join(capture, `${label}.json`); const loadLog = path.join(capture, `${label}-loads.jsonl`);
  const args = ['--experimental-loader', pathToFileURL(path.join(owned, 'audit-loader.mjs')).href];
  if (mode !== 'moved') args.push('--import', pathToFileURL(tsx).href);
  args.push(path.join(owned, 'review-harness.mjs'));
  const environment = { ...baseEnv, REVIEW_MODULE: module, REVIEW_OUTPUT: output, REVIEW_MODE: mode, REVIEW_SELECT: controls.join(','),
    REVIEW_SOURCE_DATA: sourceData, REVIEW_OWNED_ROOT: owned, REVIEW_TOOLING_ROOT: path.join(repository, 'node_modules'), REVIEW_LOAD_LOG: loadLog };
  const execution = await execute(process.execPath, args, { cwd: scratch, env: environment, timeout: 90000 });
  save(path.join(capture, `${label}-process.json`), execution);
  return { execution, result: fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : null };
};
const identity = {
  candidate, freeze, candidateTree: git(['rev-parse', `${candidate}^{tree}`]).toString().trim(), freezeTree: git(['rev-parse', `${freeze}^{tree}`]).toString().trim(),
  chronology: git(['show', '-s', '--format=fuller', candidate, freeze]).toString(),
  archive: { scope: ['src/shell/getopts.ts', 'package.json'], bytes: archive.length, sha256: sha256(archive), fullCandidateTrackedInventory: 'candidate-tree.txt', noFullProductGate: true },
  scanner: { gitBlob: git(['rev-parse', `${candidate}:src/shell/getopts.ts`]).toString().trim(), bytes: sourceBlob.length, sha256: sha256(sourceBlob), sourceModule },
  package: { ...JSON.parse(packageBlob), sha256: sha256(packageBlob) },
  tooling: { node: process.version, nodeExecutable: process.execPath, nodeSha256: sha256(fs.readFileSync(process.execPath)), tsx, tsxSha256: sha256(fs.readFileSync(tsx)), tsc, tscSha256: sha256(fs.readFileSync(tsc)), typesRoot },
  initialIndex, initialStatus, freezeBefore,
};
save(path.join(capture, 'identity.json'), identity);
console.log('authenticated scoped committed inputs; running source controls');
const sourceRun = await runHarness('source', sourceModule, 'source');
console.log('source', sourceRun.result?.counts ?? { status: sourceRun.execution.status });

const stagingPackage = path.join(scratch, 'staging-package'); fs.mkdirSync(stagingPackage);
fs.writeFileSync(path.join(stagingPackage, 'package.json'), packageBlob, { flag: 'wx' });
const build = await execute(process.execPath, [tsc, '--declaration', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--types', 'node', '--typeRoots', typesRoot, '--rootDir', path.join(sourceRoot, 'src'), '--outDir', path.join(stagingPackage, 'dist'), sourceModule], { cwd: scratch, env: baseEnv });
save(path.join(capture, 'build-process.json'), build);
let movedRun = null; let movedPackage = null; let packageBefore = null;
if (build.status === 0) {
  packageBefore = inventory(stagingPackage); save(path.join(capture, 'package-before-move.json'), packageBefore);
  const consumerRoot = path.join(scratch, 'consumer'); fs.mkdirSync(consumerRoot);
  movedPackage = path.join(consumerRoot, 'virtual-bash'); fs.renameSync(stagingPackage, movedPackage);
  assert(!fs.existsSync(stagingPackage)); assert.deepEqual(inventory(movedPackage), packageBefore);
  save(path.join(capture, 'package-move.json'), { from: stagingPackage, to: movedPackage, sourceAbsentAfterMove: true, membershipAndHashesUnchanged: true, internalOnly: true, import: pathToFileURL(path.join(movedPackage, 'dist/shell/getopts.js')).href });
  fs.copyFileSync(path.join(movedPackage, 'dist/shell/getopts.js'), path.join(capture, 'emitted-getopts.js.data'));
  fs.copyFileSync(path.join(movedPackage, 'dist/shell/getopts.d.ts'), path.join(capture, 'emitted-getopts.d.ts.data'));
  movedRun = await runHarness('moved', path.join(movedPackage, 'dist/shell/getopts.js'), 'moved');
  console.log('moved', movedRun.result?.counts ?? { status: movedRun.execution.status });
}

const typeRuns = [];
for (const [mode, target] of [['source', path.dirname(sourceModule)], ...(movedPackage ? [['moved', path.join(movedPackage, 'dist/shell')]] : [])]) {
  const output = path.join(capture, `types-${mode}.json`);
  const execution = await execute(process.execPath, [path.join(owned, 'type-review.mjs'), mode, target, output, path.join(scratch, `types-${mode}`)], { cwd: scratch, env: baseEnv });
  save(path.join(capture, `types-${mode}-process.json`), execution);
  const result = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : null;
  typeRuns.push({ mode, status: execution.status, counts: result?.counts ?? null });
  console.log('types', typeRuns.at(-1));
}

const profiles = [
  { id: 'bash53', binary: '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash', hash: '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c', acceptance: true },
  { id: 'bash32', binary: '/bin/bash', hash: '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3', acceptance: false },
];
const nativeResults = [];
const nativeScript = fs.readFileSync(path.join(owned, 'native-holdouts.sh'), 'utf8');
const nativeEnv = { PATH: '/usr/bin:/bin', HOME: path.join(scratch, 'home'), TMPDIR: path.join(scratch, 'tmp'), LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
for (const profile of profiles) {
  if (!fs.existsSync(profile.binary) || sha256(fs.readFileSync(profile.binary)) !== profile.hash) { nativeResults.push({ ...profile, status: 'blocked', reason: 'binary unavailable or hash mismatch' }); continue; }
  const version = await execute(profile.binary, ['--version'], { cwd: path.join(scratch, 'native'), env: nativeEnv, timeout: 2500, cap: 128 * 1024 });
  const platform = await execute(profile.binary, ['--noprofile', '--norc', '-c', 'printf "%s\\n" "$BASH_VERSION" "$MACHTYPE" "$OSTYPE"'], { cwd: path.join(scratch, 'native'), env: nativeEnv, timeout: 2500, cap: 128 * 1024 });
  const cases = [];
  for (const control of nativeControls) {
    const execution = await execute(profile.binary, ['--noprofile', '--norc', '-c', nativeScript, 'getopts-independent', control.id], { cwd: path.join(scratch, 'native'), env: nativeEnv, timeout: 2500, cap: 128 * 1024 });
    const expectedRecords = control.semanticIds.flatMap((id) => semanticControls.find((entry) => entry.id === id).operations.filter((operation) => operation.operation === 'scan').map((operation) => operation.expected));
    const expectedBytes = Buffer.concat(expectedRecords.map((record) => Buffer.from([String(record.status), record.option, String(record.optind), record.argument.kind === 'set' ? 'x' : '', record.argument.kind === 'set' ? record.argument.value : ''].join('\0') + '\0')));
    const actualBytes = Buffer.from(execution.stdoutBase64, 'base64');
    const fields = actualBytes.toString().split('\0'); fields.pop();
    const comparisons = expectedRecords.map((expected, ordinal) => {
      const expectedFields = [String(expected.status), expected.option, String(expected.optind), expected.argument.kind === 'set' ? 'x' : '', expected.argument.kind === 'set' ? expected.argument.value : ''];
      const actualFields = fields.slice(ordinal * 5, ordinal * 5 + 5);
      return { ordinal: ordinal + 1, expected: expectedFields, actual: actualFields, pass: JSON.stringify(expectedFields) === JSON.stringify(actualFields) };
    });
    cases.push({ id: control.id, expectedRecords: expectedRecords.length, stdoutMatches: actualBytes.equals(expectedBytes), stderrMatches: execution.stderr === control.stderr,
      expectedStdoutBase64: expectedBytes.toString('base64'), expectedStderr: control.stderr, exactRecordMembership: fields.length === expectedRecords.length * 5,
      pass: execution.status === 0 && !execution.terminated && actualBytes.equals(expectedBytes) && execution.stderr === control.stderr, comparisons, execution });
  }
  const result = { ...profile, version, platform, environment: nativeEnv, host: { platform: process.platform, arch: process.arch },
    scriptHash: sha256(Buffer.from(nativeScript)), cases, counts: { scripts: cases.length, pass: cases.filter((entry) => entry.pass).length, fail: cases.filter((entry) => !entry.pass).length, records: cases.reduce((total, entry) => total + entry.comparisons.length, 0), passedRecords: cases.reduce((total, entry) => total + entry.comparisons.filter((record) => record.pass).length, 0) } };
  save(path.join(capture, `native-${profile.id}.json`), result); nativeResults.push({ id: profile.id, counts: result.counts }); console.log('native', profile.id, result.counts);
}

const mutationResults = [];
for (const mutation of mutations) {
  const directory = path.join(scratch, mutation.id); fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'package.json'), packageBlob);
  const module = path.join(directory, 'getopts.ts'); fs.writeFileSync(module, sourceBlob);
  let text = sourceBlob.toString();
  for (const [from, to] of mutation.replacements ?? [[mutation.from, mutation.to]]) {
    const occurrences = text.split(from).length - 1; assert(occurrences > 0 && (mutation.all || occurrences === 1), `${mutation.id}: ambiguous mutation target`);
    text = mutation.all ? text.replaceAll(from, to) : text.replace(from, to);
  }
  const relative = path.relative(repository, module);
  const patch = `*** Begin Patch\n*** Update File: ${relative}\n@@\n${sourceBlob.toString().trimEnd().split('\n').map((line) => '-' + line).join('\n')}\n${text.trimEnd().split('\n').map((line) => '+' + line).join('\n')}\n*** End Patch\n`;
  fs.writeFileSync(path.join(capture, `${mutation.id}.patch.data`), patch, { flag: 'wx' });
  const applied = spawnSync('apply_patch', [], { cwd: repository, input: patch, encoding: 'utf8' }); assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.readFileSync(module, 'utf8'), text);
  const load = await execute(process.execPath, ['--import', pathToFileURL(tsx).href, '--input-type=module', '-e', `const candidate = await import(${JSON.stringify(pathToFileURL(module).href)}); if (typeof candidate.scanGetopts !== 'function') throw Error('missing scanner'); console.log('loaded');`], { cwd: scratch, env: baseEnv });
  save(path.join(capture, `${mutation.id}-load.json`), load);
  if (load.status !== 0) { mutationResults.push({ id: mutation.id, status: 'invalid-load', loadStatus: load.status }); continue; }
  const run = await runHarness(mutation.id, module, 'mutation', mutation.controls);
  const failures = run.result?.results.filter((result) => result.status === 'fail') ?? [];
  const baselinePasses = new Set(sourceRun.result?.results.filter((result) => result.status === 'pass').map((result) => result.id));
  const meaningful = failures.filter((result) => baselinePasses.has(result.id) && (result.error?.name === 'AssertionError' || result.error?.message?.startsWith('watchdog:')));
  mutationResults.push({ id: mutation.id, status: meaningful.length ? 'killed' : run.result ? 'survived' : 'infrastructure-failure', controls: mutation.controls,
    originalSha256: sha256(sourceBlob), mutantSha256: sha256(Buffer.from(text)), loadPassed: true, counts: run.result?.counts ?? null, meaningfulFailures: meaningful.map((entry) => ({ id: entry.id, error: entry.error })) });
  console.log('mutation', mutation.id, mutationResults.at(-1).status);
}
save(path.join(capture, 'mutations-summary.json'), mutationResults);
const sourceRepeat = await runHarness('source-repeat', sourceModule, 'source');
const movedRepeat = movedPackage ? await runHarness('moved-repeat', path.join(movedPackage, 'dist/shell/getopts.js'), 'moved') : null;
const sourceAfter = inventory(sourceRoot); save(path.join(capture, 'source-after.json'), sourceAfter);
const packageAfter = movedPackage ? inventory(movedPackage) : null; if (packageAfter) save(path.join(capture, 'package-after.json'), packageAfter);
const freezeAfter = Object.fromEntries(frozenFiles.map((file) => [file, sha256(fs.readFileSync(path.join(owned, file)))]));
const preservation = { sourceMembershipAndHashesUnchanged: JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter), packageMembershipAndHashesUnchanged: JSON.stringify(packageBefore) === JSON.stringify(packageAfter),
  appendProofChecks: true, freezeUnchanged: JSON.stringify(freezeBefore) === JSON.stringify(freezeAfter), freezeAfter,
  initialIndex, finalIndex: git(['diff', '--cached', '--raw', '-z']).toString('base64'), initialStatus, finalStatus: git(['status', '--short']).toString(),
  foreignWorkingTreeNotOverlaid: true, wholeLiveTreeImmutabilityClaim: false };
save(path.join(capture, 'preservation.json'), preservation);
const summary = { candidate, freeze, source: sourceRun.result?.counts ?? null, moved: movedRun?.result?.counts ?? null, sourceRepeat: sourceRepeat.result?.counts ?? null, movedRepeat: movedRepeat?.result?.counts ?? null,
  buildStatus: build.status, types: typeRuns, native: nativeResults, mutants: { total: mutationResults.length, killed: mutationResults.filter((entry) => entry.status === 'killed').length, statuses: mutationResults.map(({ id, status }) => ({ id, status })) },
  preservation, authorTestsRerun: false, stage2: 'WITHHELD', artifactClassification: 'Opt-in candidate-specific immutable audit data. .ts.data/.d.ts.data and tar inputs are not canonical TypeScript or discovered tests.' };
save(path.join(capture, 'summary.json'), summary);
assert.equal(fs.realpathSync(path.dirname(scratch)), fs.realpathSync(owned));
assert.equal(fs.readFileSync(path.join(scratch, '.review-owner'), 'utf8'), `${candidate}\n${capture}\n`);
fs.rmSync(scratch, { recursive: true });
save(path.join(capture, 'cleanup.json'), { scratch, removedOwnedScratch: !fs.existsSync(scratch), childrenAwaited: true, originalInputsRetainedIn: ['candidate-module-inputs.tar', 'candidate-scanner.ts.data'], emittedBytesRetainedIn: ['emitted-getopts.js.data', 'emitted-getopts.d.ts.data'], noForeignDeletion: true });
save(path.join(capture, 'artifact-manifest.json'), inventory(capture));
console.log(JSON.stringify({ capture, source: summary.source, moved: summary.moved, types: summary.types, native: summary.native, mutants: summary.mutants, preservation: { source: preservation.sourceMembershipAndHashesUnchanged, package: preservation.packageMembershipAndHashesUnchanged, freeze: preservation.freezeUnchanged } }));
