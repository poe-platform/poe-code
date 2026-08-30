import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, realpathSync, copyFileSync, symlinkSync, existsSync, readdirSync, lstatSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = process.cwd();
if (root !== '/Users/kjopek/Workspace/safe-bash') throw new Error('Explicit workspace required');
const owned = 'tests/shell-stress/invocation-cleanup-holdout';
const output = join(owned, 'r1-disposal-data.json');
if (existsSync(output)) throw new Error('Immutable supplementary evidence already exists');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const profiles = [{ name: 'r1-candidate-1b', commit: '1b133a8662a32ee84524794842074c9c98d5f6c3' }];
const records = [];
for (const profile of profiles) {
  const archive = realpathSync(mkdtempSync('/tmp/safe-bash-dispose-review-'));
  const tar = git(['archive', profile.commit, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']);
  execFileSync('tar', ['-x', '-C', archive], { input: tar });
  const names = git(['ls-tree', '-r', '--name-only', profile.commit, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString().trim().split('\n');
  const sourceHashes = Object.fromEntries(names.map(file => {
    const bytes = git(['show', profile.commit + ':' + file]);
    if (!bytes.equals(readFileSync(join(archive, file)))) throw new Error('Archive mismatch');
    return [file, hash(bytes)];
  }));
  symlinkSync(join(root, 'node_modules'), join(archive, 'node_modules'));
  const helpers = ['setup-disposal-control.mjs', 'setup-disposal-trace.mjs'];
  for (const file of helpers) copyFileSync(join(owned, file), join(archive, file));
  const helperHashes = Object.fromEntries(helpers.map(file => [file, hash(readFileSync(join(archive, file)))]));
  const trace = join(archive, 'imports.jsonl');
  const result = spawnSync(process.execPath, ['--loader', pathToFileURL(join(archive, 'setup-disposal-trace.mjs')).href, '--import', 'tsx', join(archive, 'setup-disposal-control.mjs'), join(archive, 'src/index.ts')], { cwd: archive, env: { PATH: process.env.PATH, HOME: archive, TMPDIR: archive, LANG: 'C', LC_ALL: 'C', DISPOSE_REVIEW_TRACE: trace }, encoding: 'utf8', timeout: 12000, maxBuffer: 4 * 1024 * 1024 });
  const record = { ...profile, archive, archiveTarSha256: hash(tar), sourceHashes, helperHashes, child: { status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, imports: existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [] };
  try { record.result = JSON.parse(result.stdout); } catch (error) { record.resultParseError = String(error); }
  record.productImports = record.imports.filter(item => fileURLToPath(item.url).startsWith(join(archive, 'src') + '/'));
  record.publicIndexObserved = record.productImports.some(item => fileURLToPath(item.url) === join(archive, 'src/index.ts'));
  record.productImportGuard = record.productImports.every(item => item.fileSha256 === sourceHashes[relative(archive, fileURLToPath(item.url))]);
  record.fileImportGuard = record.imports.every(item => {
    const file = fileURLToPath(item.url);
    return (file.startsWith(archive + '/') || file.startsWith(realpathSync(join(root, 'node_modules')) + '/')) && item.fileSha256 === hash(readFileSync(file));
  });
  record.sourceGuard = Object.entries(sourceHashes).every(([file, expected]) => hash(readFileSync(join(archive, file))) === expected);
  record.helperGuard = Object.entries(helperHashes).every(([file, expected]) => hash(readFileSync(join(archive, file))) === expected);
  records.push(record);
  if (result.status !== 0 || result.signal !== null || !record.publicIndexObserved || !record.productImportGuard || !record.fileImportGuard || !record.sourceGuard || !record.helperGuard) break;
}
const report = { recordedAt: new Date().toISOString(), mode: 'Actual public root TS API via existing tsx, separate from the single compiled H01-H22 run. Full committed source archives, no live source overlay and no further tsc builds.', node: process.version, tsxVersion: JSON.parse(readFileSync('node_modules/tsx/package.json')).version, tsxPackageSha256: hash(readFileSync('node_modules/tsx/package.json')), records };
const json = JSON.stringify(report, null, 2);
execFileSync('apply_patch', [], { input: '*** Begin Patch\n*** Add File: ' + output + '\n' + json.split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n' });
const remove = directory => {
  for (const name of readdirSync(directory)) {
    const file = join(directory, name);
    const stat = lstatSync(file);
    if (stat.isDirectory() && !stat.isSymbolicLink()) remove(file); else unlinkSync(file);
  }
  rmdirSync(directory);
};
const cleanup = [];
for (const record of records) {
  const finished = record.child.status !== null && record.child.signal === null;
  if (finished) remove(record.archive);
  cleanup.push({ archive: record.archive, removedAfterDurableProof: finished && !existsSync(record.archive), retainedOnForcedTermination: !finished });
}
const receipt = { at: new Date().toISOString(), proof: output, proofSha256: hash(json + '\n'), cleanup, method: 'Exact generated archives only; lstat/unlink does not traverse node_modules symlinks.' };
execFileSync('apply_patch', [], { input: '*** Begin Patch\n*** Add File: ' + owned + '/r1-disposal-scratch.json\n' + JSON.stringify(receipt, null, 2).split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n' });
console.log(JSON.stringify({ records: records.map(record => ({ name: record.name, status: record.child.status, publicIndexObserved: record.publicIndexObserved, productImportGuard: record.productImportGuard, fileImportGuard: record.fileImportGuard, sourceGuard: record.sourceGuard, observations: record.result?.observations, stderr: record.child.stderr })), cleanup }));
