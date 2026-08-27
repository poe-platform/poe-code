import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, symlinkSync, copyFileSync, readdirSync, lstatSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = process.cwd();
if (root !== '/Users/kjopek/Workspace/safe-bash') throw new Error('Explicit workspace required');
const owned = 'tests/shell-stress/invocation-cleanup-author';
const sourceIdentity = JSON.parse(readFileSync(join(owned, 'source-identities.json')));
const commit = sourceIdentity.commit;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const paths = git(['ls-tree', '-r', '--name-only', commit, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString().trim().split('\n');
const archive = mkdtempSync('/tmp/safe-bash-invocation-cleanup-');
const tar = git(['archive', commit, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']);
execFileSync('tar', ['-x', '-C', archive], { input: tar });
const manifest = Object.fromEntries(paths.map(file => {
  const original = git(['show', `${commit}:${file}`]);
  const copy = readFileSync(join(archive, file));
  if (!original.equals(copy)) throw new Error('Archive mismatch ' + file);
  return [file, hash(copy)];
}));
symlinkSync(join(root, 'node_modules'), join(archive, 'node_modules'));
const helpers = Object.fromEntries(['repro.mjs', 'trace.mjs'].map(name => {
  copyFileSync(join(owned, name), join(archive, name));
  return [name, hash(readFileSync(join(archive, name)))];
}));
const compiler = resolve('node_modules/typescript/bin/tsc');
const report = { startedAt: new Date().toISOString(), commit, archive, archiveTarSha256: hash(tar), manifest, helpers, tooling: { linkTarget: join(root, 'node_modules'), compilerSha256: hash(readFileSync(compiler)), typescriptPackageSha256: hash(readFileSync('node_modules/typescript/package.json')), node: process.version }, liveSourceAtStart: Object.fromEntries(sourceIdentity.identities.map(item => [item.file, hash(readFileSync(item.file))])) };
const capture = result => ({ status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
report.build = capture(spawnSync(process.execPath, [compiler, '-p', join(archive, 'tsconfig.build.json')], { cwd: archive, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024 }));
const emitted = {};
function files(directory) {
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) files(absolute);
    else if (stat.isFile()) emitted[relative(archive, absolute)] = hash(readFileSync(absolute));
    else throw new Error('Unexpected emitted link');
  }
}
if (report.build.status === 0) {
  files(join(archive, 'dist'));
  report.emitted = emitted;
  report.run = capture(spawnSync(process.execPath, ['--loader', pathToFileURL(join(archive, 'trace.mjs')).href, join(archive, 'repro.mjs'), join(archive, 'dist/index.js')], { cwd: archive, env: { PATH: process.env.PATH, HOME: archive, TMPDIR: archive, LANG: 'C', LC_ALL: 'C', INVOCATION_CLEANUP_TRACE: join(archive, 'imports.jsonl') }, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 }));
  try { report.observations = JSON.parse(report.run.stdout); } catch (error) { report.outputParseError = String(error); }
  report.actualImports = existsSync(join(archive, 'imports.jsonl')) ? readFileSync(join(archive, 'imports.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  report.importGuard = report.actualImports.some(item => item.url === pathToFileURL(join(archive, 'dist/index.js')).href) && report.actualImports.every(item => {
    const file = fileURLToPath(item.url);
    return file.startsWith(archive + '/') && item.sourceSha256 === hash(readFileSync(file));
  });
}
report.sourceAfter = Object.fromEntries(paths.map(file => [file, hash(readFileSync(join(archive, file)))]));
report.sourceGuard = JSON.stringify(manifest) === JSON.stringify(report.sourceAfter);
report.emittedGuard = Object.entries(emitted).every(([file, expected]) => hash(readFileSync(join(archive, file))) === expected);
report.helperGuard = Object.entries(helpers).every(([file, expected]) => hash(readFileSync(join(archive, file))) === expected && hash(readFileSync(join(owned, file))) === expected);
report.liveSourceAtEnd = Object.fromEntries(sourceIdentity.identities.map(item => [item.file, hash(readFileSync(item.file))]));
report.liveEndpointGuard = JSON.stringify(report.liveSourceAtStart) === JSON.stringify(report.liveSourceAtEnd);
const safeRemove = directory => {
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name);
    const stat = lstatSync(absolute);
    if (stat.isDirectory() && !stat.isSymbolicLink()) safeRemove(absolute);
    else unlinkSync(absolute);
  }
  rmdirSync(directory);
};
const settledChildren = report.build.signal === null && report.build.status !== null && (!report.run || report.run.signal === null && report.run.status !== null);
const workersDone = !report.run || report.observations?.observations.every(item => item.eventualOwnedTermination);
if (settledChildren && workersDone) { safeRemove(archive); report.archiveRemoved = !existsSync(archive); }
else report.archiveRetainedForFailure = true;
report.completedAt = new Date().toISOString();
const output = join(owned, 'baseline.json');
if (existsSync(output)) throw new Error('Immutable baseline already exists');
execFileSync('apply_patch', [], { input: '*** Begin Patch\n*** Add File: ' + output + '\n' + JSON.stringify(report, null, 2).split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n', maxBuffer: 1024 * 1024 });
console.log(JSON.stringify({ commit, build: report.build.status, run: report.run?.status, sourceGuard: report.sourceGuard, importGuard: report.importGuard, emittedGuard: report.emittedGuard, helperGuard: report.helperGuard, liveEndpointGuard: report.liveEndpointGuard, archiveRemoved: report.archiveRemoved, cases: report.observations?.observations.map(item => ({ name: item.name, payload: item.payloadAndAbortControl, exec: item.cleanupBeforeExec, dispose: item.cleanupBeforeDispose, eventual: item.eventualOwnedTermination })) }));
if (report.build.status !== 0 || report.run?.status !== 0) process.exitCode = 1;
