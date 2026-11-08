import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { instrument, mutate } from './instrument.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const caps = JSON.parse(readFileSync(directory + 'caps-expected.json'));
const binding = JSON.parse(readFileSync(directory + 'caps-binding.json'));
assert.equal(hash(readFileSync(directory + 'caps-expected.json')), binding.expectedSha256);
const hidden = JSON.parse(readFileSync(directory + 'expected-v2.json'));
const freeze = JSON.parse(readFileSync(directory + 'freeze.json'));
const acceptanceBytes = execFileSync('git', ['show', `${freeze.acceptanceCommit}:benchmarks/reports/sort-performance-next-20260827/workloads.json`], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
assert.equal(hash(acceptanceBytes), freeze.acceptanceHash);
const acceptance = JSON.parse(acceptanceBytes);
const scratch = realpathSync(mkdtempSync('/tmp/sort-unkeyed-review-extensions-'));
const evidence = directory + 'extensions';
mkdirSync(evidence);
const require = createRequire(import.meta.url);
const compiler = require('/Users/kjopek/Workspace/safe-bash/node_modules/typescript');
const sources = {};
const packages = {};
for (const variant of ['baseline', 'candidate']) {
  const commit = variant === 'baseline' ? freeze.baselineCommit : binding.candidate;
  const originalReport = `${directory}${variant}-${commit.slice(0, 12)}-v2/`;
  const admission = JSON.parse(readFileSync(originalReport + 'admission.json'));
  const manifest = JSON.parse(readFileSync(originalReport + 'package-manifest.json'));
  const path = join(admission.scratch, 'moved-public-consumer/node_modules/virtual-bash');
  for (const file of manifest) assert.equal(hash(readFileSync(join(path, file.path))), file.sha256);
  const text = execFileSync('git', ['show', `${commit}:src/commands/text.ts`], { maxBuffer: 1048576, timeout: 30000 });
  assert.equal(hash(text), admission.sources.find(file => file.path === 'src/commands/text.ts').sha256);
  sources[variant] = text.toString();
  packages[variant] = { path, manifest, commit, originalReport };
}
function inventory(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = join(prefix, entry.name);
    assert.equal(entry.isSymbolicLink(), false);
    return entry.isDirectory() ? inventory(root, path) : [{ path, bytes: readFileSync(join(root, path)).length, sha256: hash(readFileSync(join(root, path))) }];
  }).sort((left, right) => left.path.localeCompare(right.path));
}
const checks = [];
const mutationCases = {
  'float-precision': ['precision-integers', 'precision-fractions'],
  'whole-byte-fallback': ['ties-byte-fallback', 'ties-reverse-fallback'],
  'stable-fallback': ['ties-stable', 'ties-reverse-stable', 'ties-unique-first'],
  'guard-bypass': ['guard-explicit-numeric-key', 'guard-multiple-keys', 'guard-blanks', 'guard-fold', 'guard-plain', 'guard-check-success'],
  'entry-cap': ['empty-entry-above'],
  'character-cap': ['characters-above', 'huge-short-prefix'],
  'fallback-rejection': ['characters-above'],
  'owned-copy': ['owned-offset-10-7', 'owned-offset-0-7'],
};
const configurations = [
  { name: 'baseline-caps', variant: 'baseline', specimens: caps.specimens },
  { name: 'candidate-caps', variant: 'candidate', specimens: caps.specimens },
  ...['baseline', 'candidate'].map(variant => ({ name: `${variant}-instrumented`, variant, profile: true, specimens: [...hidden.specimens, ...caps.specimens], acceptance: true })),
  ...Object.entries(mutationCases).map(([name, ids]) => ({ name: `mutant-${name}`, variant: 'candidate', profile: true, mutant: name, specimens: [...hidden.specimens, ...caps.specimens].filter(row => ids.includes(row.id)) })),
];
writeFileSync(evidence + '/plan.json', JSON.stringify({ scratch, binding, configurations: configurations.map(config => ({ ...config, specimens: config.specimens.map(row => row.id) })), frozenMutationIntent: 'fcd6d0218725342e4ef1aa098e23b0cdfbe9cd10', compilerVersion: compiler.version, compilerSha256: hash(readFileSync(require.resolve('/Users/kjopek/Workspace/safe-bash/node_modules/typescript'))), harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))), instrumentSha256: hash(readFileSync(directory + 'instrument.mjs')), workerSha256: hash(readFileSync(directory + 'public-worker.mjs')), timingClaims: false }, null, 2) + '\n');
for (const config of configurations) {
  const runRoot = join(scratch, config.name);
  const packagePath = join(runRoot, 'node_modules/virtual-bash');
  mkdirSync(join(runRoot, 'node_modules'), { recursive: true });
  cpSync(packages[config.variant].path, packagePath, { recursive: true, errorOnExist: true });
  assert.deepEqual(inventory(packagePath), packages[config.variant].manifest);
  const derived = config.profile ? instrument(sources[config.variant], config.variant === 'candidate') : { source: sources[config.variant], edits: [] };
  const mutated = config.mutant ? mutate(derived.source, config.mutant) : { source: derived.source, edits: [] };
  if (config.profile) {
    const emitted = compiler.transpileModule(mutated.source, { compilerOptions: { target: compiler.ScriptTarget.ES2023, module: compiler.ModuleKind.ES2022 }, fileName: 'text.ts', reportDiagnostics: true });
    assert.equal(emitted.diagnostics.length, 0);
    writeFileSync(join(packagePath, 'dist/commands/text.js'), emitted.outputText);
    writeFileSync(evidence + `/${config.name}.source.ts.txt`, mutated.source);
  }
  const manifest = inventory(packagePath);
  const changed = manifest.filter(file => packages[config.variant].manifest.find(original => original.path === file.path).sha256 !== file.sha256).map(file => file.path);
  assert.deepEqual(changed, config.profile ? ['dist/commands/text.js'] : []);
  const manifestPath = join(runRoot, 'manifest.json');
  const inputPath = join(runRoot, 'acceptance.json');
  const expectedPath = join(runRoot, 'expected.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(inputPath, config.acceptance ? acceptanceBytes : JSON.stringify({ specimens: [] }));
  writeFileSync(expectedPath, JSON.stringify({ specimens: config.specimens }));
  copyFileSync(directory + 'public-worker.mjs', join(runRoot, 'worker.mjs'));
  const child = spawn(process.execPath, ['--max-old-space-size=512', join(runRoot, 'worker.mjs'), packagePath, inputPath, expectedPath, manifestPath], { cwd: runRoot, env: { ...process.env, SORT_REVIEW_PROFILE: config.profile ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let bytes = 0;
  let killed;
  const stdout = [];
  const stderr = [];
  const collect = output => chunk => { bytes += chunk.length; if (bytes > 8388608) { killed = 'log cap'; child.kill('SIGKILL'); } else output.push(chunk); };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  const timer = setTimeout(() => { killed = 'wall watchdog'; child.kill('SIGKILL'); }, 90000);
  const closed = await new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(timer);
  const metadata = { name: config.name, variant: config.variant, commit: packages[config.variant].commit, pid: child.pid, ...closed, killed, bytes, exactChildClosed: true, sourceBefore: hash(sources[config.variant]), instrumentedSource: hash(derived.source), finalSource: hash(mutated.source), edits: [...derived.edits, ...mutated.edits], changedModules: changed, inputs: { acceptance: hash(readFileSync(inputPath)), expected: hash(readFileSync(expectedPath)) }, stderr: Buffer.concat(stderr).toString() };
  writeFileSync(evidence + `/${config.name}.metadata.json`, JSON.stringify(metadata, null, 2) + '\n');
  assert.equal(killed, undefined);
  assert.equal(closed.code, 0, metadata.stderr);
  const result = JSON.parse(Buffer.concat(stdout));
  writeFileSync(evidence + `/${config.name}.results.json`, JSON.stringify(result, null, 2) + '\n');
  assert.deepEqual(inventory(packagePath), manifest);
  const failures = result.rows.filter(row => !row.passed).map(row => ({ id: row.id, kind: 'semantic' }));
  if (config.profile && config.variant === 'candidate') {
    for (const row of result.rows) {
      if ((row.counts.peakEntries ?? 0) > binding.entryCap) failures.push({ id: row.id, kind: 'entry-cap' });
      if ((row.counts.peakRetainedCharge ?? 0) > binding.retainedByteCap) failures.push({ id: row.id, kind: 'character-cap' });
      if ((row.id.startsWith('guard-') || ['historical-sort-uniq-5000', 'plain-5000', 'unique-paths-20000', 'numeric-key-8000', 'in-place-5000', 'tiny-32'].includes(row.id)) && (row.counts.cacheCreated ?? 0) !== 0) failures.push({ id: row.id, kind: 'guard-admission' });
    }
  }
  const check = { name: config.name, rows: result.rows.length, semanticPasses: result.rows.filter(row => row.passed).length, failures, mutantDetected: config.mutant ? failures.length > 0 : undefined, shellsDisposed: result.shellsDisposed, authenticatedModules: result.modules.length, packageBeforeAfterEqual: true };
  checks.push(check);
  writeFileSync(evidence + '/summary.json', JSON.stringify(checks, null, 2) + '\n');
  console.log(JSON.stringify(check));
  assert.ok(config.mutant ? failures.length > 0 : failures.length === 0, config.name);
}
for (const variant of ['baseline', 'candidate']) {
  assert.deepEqual(inventory(packages[variant].path), packages[variant].manifest);
  assert.equal(execFileSync('git', ['show', `${packages[variant].commit}:src/commands/text.ts`], { maxBuffer: 1048576, timeout: 30000 }).toString(), sources[variant]);
}
writeFileSync(evidence + '/closed.json', JSON.stringify({ childCount: checks.length, allExactChildrenClosed: true, allShellsDisposed: checks.reduce((total, check) => total + check.shellsDisposed, 0), originalMovedPackagesAndCommittedSourcesUnchanged: true, capInputsUnchanged: hash(readFileSync(directory + 'caps-expected.json')) === binding.expectedSha256 }, null, 2) + '\n');
