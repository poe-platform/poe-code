import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, symlinkSync, realpathSync, readdirSync, lstatSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { cases } from './cases.mjs';

const root = process.cwd();
const owned = 'tests/shell-stress/invocation-cleanup-holdout';
const [commit, output] = process.argv.slice(2);
if (root !== '/Users/kjopek/Workspace/safe-bash' || !/^[a-f0-9]{40}$/u.test(commit ?? '')) throw new Error('Explicit workspace and ROOT-authorized full frozen commit required');
if (!output?.startsWith(owned + '/') || output.includes('..') || !output.endsWith('.json') || existsSync(output)) throw new Error('Explicit NEW owned evidence JSON required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const seal = JSON.parse(readFileSync(join(owned, 'freeze.json')));
for (const [file, expected] of Object.entries(seal.files)) if (hash(readFileSync(join(owned, file))) !== expected) throw new Error('Frozen preparation changed: ' + file);
const paths = git(['ls-tree', '-r', '--name-only', commit, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString().trim().split('\n');
const archive = realpathSync(mkdtempSync('/tmp/safe-bash-cleanup-holdout-'));
const tar = git(['archive', commit, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']);
execFileSync('tar', ['-x', '-C', archive], { input: tar });
const sourceHashes = Object.fromEntries(paths.map(file => {
  const expected = git(['show', `${commit}:${file}`]);
  const actual = readFileSync(join(archive, file));
  if (!actual.equals(expected)) throw new Error('Source archive mismatch ' + file);
  return [file, hash(actual)];
}));
symlinkSync(join(root, 'node_modules'), join(archive, 'node_modules'));
mkdirSync(join(archive, 'holdout'));
const helpers = ['cases.mjs', 'support.mjs', 'child.mjs', 'trace.mjs'];
for (const file of helpers) copyFileSync(join(owned, file), join(archive, 'holdout', file));
const sourceGuard = () => Object.entries(sourceHashes).every(([file, expected]) => hash(readFileSync(join(archive, file))) === expected);
const compiler = resolve('node_modules/typescript/bin/tsc');
const capture = child => ({ status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr });
const report = { startedAt: new Date().toISOString(), commit, archive, archiveTarSha256: hash(tar), sourceHashes, preparationSealSha256: hash(readFileSync(join(owned, 'freeze.json'))), helperHashes: Object.fromEntries(helpers.map(file => [file, hash(readFileSync(join(archive, 'holdout', file)))])), devtools: { linkTarget: join(root, 'node_modules'), compilerSha256: hash(readFileSync(compiler)), typescriptVersion: JSON.parse(readFileSync('node_modules/typescript/package.json')).version, node: process.version }, scheduledCaseIds: cases.map(item => item.id), runs: [] };
report.build = capture(spawnSync(process.execPath, [compiler, '-p', join(archive, 'tsconfig.build.json')], { cwd: archive, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024 }));
const emittedHashes = {};
const collect = directory => {
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) collect(absolute);
    else if (stat.isFile()) emittedHashes[relative(archive, absolute)] = hash(readFileSync(absolute));
    else throw new Error('Unexpected emitted symlink');
  }
};
if (report.build.status === 0) {
  collect(join(archive, 'dist'));
  report.emittedHashes = emittedHashes;
  const scheduleDeadline = Date.now() + 120000;
  for (const selected of cases) {
    if (Date.now() >= scheduleDeadline) { report.scheduleDeadlineReached = true; break; }
    const trace = join(archive, selected.id + '.jsonl');
    const child = capture(spawnSync(process.execPath, ['--loader', pathToFileURL(join(archive, 'holdout/trace.mjs')).href, join(archive, 'holdout/child.mjs'), join(archive, 'dist/index.js'), selected.id], { cwd: archive, env: { PATH: process.env.PATH, HOME: archive, TMPDIR: archive, LANG: 'C', LC_ALL: 'C', HOLDOUT_TRACE: trace }, encoding: 'utf8', timeout: Math.min(12000, Math.max(1, scheduleDeadline - Date.now())), maxBuffer: 4 * 1024 * 1024 }));
    const row = { id: selected.id, child };
    try { row.result = JSON.parse(child.stdout); } catch (error) { row.resultParseError = String(error); }
    row.imports = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    row.importGuard = row.imports.some(item => item.url === pathToFileURL(join(archive, 'dist/index.js')).href) && row.imports.every(item => {
      const file = fileURLToPath(item.url);
      return file.startsWith(archive + '/') && item.sha256 === hash(readFileSync(file));
    });
    row.pass = child.status === 0 && child.signal === null && row.result?.pass === true && row.importGuard;
    report.runs.push(row);
    if (child.signal !== null || child.status === null || !row.importGuard || !sourceGuard()) { report.stoppedOnProcessOrProvenanceFailure = true; break; }
  }
}
report.sourceGuard = sourceGuard();
report.emittedGuard = Object.entries(emittedHashes).every(([file, expected]) => hash(readFileSync(join(archive, file))) === expected);
report.helperGuard = helpers.every(file => hash(readFileSync(join(archive, 'holdout', file))) === seal.files[file]);
report.completedCaseCount = report.runs.filter(row => row.result !== undefined).length;
report.passedCaseCount = report.runs.filter(row => row.pass).length;
report.unexecutedCaseIds = cases.slice(report.runs.length).map(item => item.id);
report.allPass = report.build.status === 0 && report.runs.length === cases.length && report.runs.every(row => row.pass) && report.sourceGuard && report.emittedGuard && report.helperGuard;
const artifact = JSON.stringify(report, null, 2);
execFileSync('apply_patch', [], { input: '*** Begin Patch\n*** Add File: ' + output + '\n' + artifact.split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n' });
const remove = directory => {
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name);
    const stat = lstatSync(absolute);
    if (stat.isDirectory() && !stat.isSymbolicLink()) remove(absolute);
    else unlinkSync(absolute);
  }
  rmdirSync(directory);
};
const cleanExit = report.build.signal === null && report.build.status !== null && report.runs.every(row => row.child.signal === null && row.child.status !== null);
if (cleanExit) remove(archive);
const receipt = { at: new Date().toISOString(), archive, evidencePath: output, evidenceSha256: hash(artifact + '\n'), removedAfterDurableProof: cleanExit && !existsSync(archive), retainedOnForcedChildTermination: !cleanExit, method: 'Exact owned archive only; lstat recursion and unlink symlinks, never their tooling targets.' };
const receiptPath = output.replace(/\.json$/u, '-scratch.json');
if (existsSync(receiptPath)) throw new Error('Existing scratch receipt');
execFileSync('apply_patch', [], { input: '*** Begin Patch\n*** Add File: ' + receiptPath + '\n' + JSON.stringify(receipt, null, 2).split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n' });
console.log(JSON.stringify({ output, completed: report.completedCaseCount, passed: report.passedCaseCount, unexecuted: report.unexecutedCaseIds, allPass: report.allPass, scratch: receipt }));
if (!report.allPass) process.exitCode = 1;
