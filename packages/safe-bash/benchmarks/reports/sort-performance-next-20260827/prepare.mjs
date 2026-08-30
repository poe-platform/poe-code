import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = '/Users/kjopek/Workspace/safe-bash';
const report = join(repo, 'benchmarks/reports/sort-performance-next-20260827');
const source = 'e090f29d9eb1aaf52eba08b2c2bf0aae53b9fb64';
const prior = '7ba5301d43345c2eb621b7df95a452a87b74e909';
const evidence = '96e051e81312c7d33d8f4f5078efa09a4dd87947';
const old = 'benchmarks/reports/sort-performance-independent-20260827/';
const author = 'benchmarks/reports/sort-performance-20260827/';
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const blob = (commit, path) => git('show', `${commit}:${path}`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const put = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { flag: 'wx' }); };
const json = (path, value) => put(path, JSON.stringify(value, null, 2) + '\n');
const status = git('status', '--porcelain=v1').toString();
const srcStatus = git('status', '--porcelain=v1', '--', 'src').toString();
const index = git('diff', '--cached', '--name-only').toString();
const seal = JSON.parse(blob(evidence, old + 'evidence/ARTIFACTS.json'));
for (const entry of seal) assert.equal(hash(blob(evidence, old + 'evidence/' + entry.path)), entry.sha256, entry.path);
const scratch = mkdtempSync('/tmp/sort-performance-next-independent-');
put('/tmp/sort-performance-next-independent-state.txt', scratch + '\n');
const files = git('ls-tree', '-r', '--name-only', source, 'src').toString().trim().split('\n');
const sourceFiles = {};
for (const path of files) {
  const bytes = blob(source, path);
  sourceFiles[path] = { gitBlob: git('rev-parse', `${source}:${path}`).toString().trim(), sha256: hash(bytes), bytes: bytes.length };
  for (const variant of ['control', 'instrumented']) put(join(scratch, variant, path), bytes);
}
assert.equal(sourceFiles['src/commands/text.ts'].sha256, hash(blob(prior, 'src/commands/text.ts')));
put(join(scratch, 'recipes.mjs'), blob(evidence, author + 'workloads.mjs'));
const { workloads } = await import(pathToFileURL(join(scratch, 'recipes.mjs')));
const captures = JSON.parse(blob(evidence, old + 'evidence/workloads-native.json'));
for (const row of captures) { const { expected, ...recipe } = row; assert.deepEqual(recipe, workloads.find(item => item.id === row.id)); }
const ids = ['historical-sort-uniq-5000', 'plain-5000', 'unique-paths-20000', 'numeric-stable-8000', 'numeric-key-8000', 'in-place-5000', 'tiny-32'];
const specimens = ids.map(id => ({ ...captures.find(row => row.id === id), origin: 'unchanged prior GNU9.7 workload', eligiblePrior: true }));
const nativePath = 'tests/commands/core-sort/native.json';
const native = JSON.parse(blob(source, nativePath));
for (const selected of [4, 5, 6, 28, 29, 30, 32, 33, 34]) {
  const row = native.observations[selected];
  specimens.push({ id: `negative-native-${selected}`, origin: `${nativePath} observations[${selected}] ${row.name}`, script: 'sort ' + row.args.join(' '), args: row.args, stdin: row.stdin, files: {}, expected: { stdout: row.stdout, stderr: row.stderr, status: row.exitCode, files: {} } });
}
const b64 = value => Buffer.from(value).toString('base64');
const input = '9007199254740993 high\n9007199254740992 low\n-0 negzero\n+2 plus\n1e3 exponent\n.00000000000000000002 fraction2\n.00000000000000000001 fraction1\n000.000 zero\n-9007199254740993 negative\n';
const expected = '-9007199254740993 negative\n-0 negzero\n+2 plus\n000.000 zero\n.00000000000000000001 fraction1\n.00000000000000000002 fraction2\n1e3 exponent\n9007199254740992 low\n9007199254740993 high\n';
specimens.push({ id: 'negative-exact-numeric', origin: 'hand-declared exact-prefix/stable golden, not new native evidence', script: 'sort -ns', stdin: b64(input), files: {}, expected: { stdout: b64(expected), stderr: '', status: 0, files: {} } });
specimens.push({ id: 'negative-check-duplicate', origin: 'hand-declared check-mode golden', script: 'sort -cnu', stdin: b64('1\n01\n'), files: {}, expected: { stdout: '', stderr: b64('sort: disorder at record 2\n'), status: 1, files: {} } });
specimens.push({ id: 'negative-missing-preserves-output', origin: 'hand-declared failure/effect gate', script: 'sort -n -o kept missing', stdin: '', files: { kept: b64('preserve\n') }, expected: { stdout: '', stderr: b64("sort: ENOENT: no such file or directory, readStream '/work/missing'\n"), status: 2, files: { kept: b64('preserve\n') } } });
for (const delimiter of [10, 0]) {
  const bytes = Buffer.from([98, 49, delimiter, 97, 49, delimiter]);
  specimens.push({ id: `negative-borrowed-${delimiter}`, origin: 'same bytes/producer as committed borrowed-buffer.test.ts, /work/input path adaptation', borrowed: true, script: delimiter ? 'sort input' : 'sort -z input', stdin: '', files: { input: b64(bytes) }, expected: { stdout: b64(Buffer.from([97, 49, delimiter, 98, 49, delimiter])), stderr: '', status: 0, files: { input: b64(bytes) } } });
}
const frozen = { frozenAt: new Date().toISOString(), source, evidence, specimens, excludedPrior: ['unicode-8000', 'invalid-bytes-8000'], excludedPriorMeasuredCalls: 48, bounds: { variants: 2, repetitions: 1, specimenCount: specimens.length, heapMiB: 512, childWallSeconds: 90, childCpuSeconds: 60, perExecDeadlineMs: 5000, outputBytes: 4194304, pipeHighWaterMark: 4096 }, noTimingStudy: true };
json(join(report, 'workloads.json'), frozen);
put(join(scratch, 'workloads.json'), readFileSync(join(report, 'workloads.json')));
const priorPreparation = JSON.parse(blob(evidence, old + 'evidence/preparation.json'));
const inputs = { selectedObservedCommittedSnapshot: source, sourceTree: git('rev-parse', `${source}^{tree}`).toString().trim(), prior, evidence, preparedAt: new Date().toISOString(), observedHeadAtPreparation: git('rev-parse', 'HEAD').toString().trim(), status, srcStatus, index, scratch, sealEntriesVerified: seal.length, sourceFiles, relevantPrior: Object.fromEntries(['src/commands/text.ts', 'src/commands/internal.ts', 'src/commands/execution.ts'].map(path => [path, hash(blob(prior, path))])), sourceDeltaFromPrior: git('diff', '--stat', prior, source, '--', 'src', 'package.json').toString(), evidenceFiles: {}, nativeProfile: { nativeFixture: { ...native, observations: undefined }, priorNode: priorPreparation.node, priorNative: priorPreparation.native, baselineVersion: '3.4.2', baselineTarballSha256: priorPreparation.tarballSha256, baselinePublisherFiles: priorPreparation.publishedFileCount, authenticationCommit: git('rev-parse', '010411ef^{commit}').toString().trim(), liveBaselineNotImported: true }, freezeSha256: hash(readFileSync(join(report, 'workloads.json'))) };
for (const [commit, path] of [[evidence, old + 'README.md'], [evidence, old + 'evidence/ARTIFACTS.json'], [evidence, old + 'evidence/workloads-native.json'], [evidence, author + 'workloads.mjs'], [source, nativePath], [source, 'tests/commands/core-sort/borrowed-buffer.test.ts'], [source, 'package.json'], [source, 'tsconfig.build.json']]) inputs.evidenceFiles[path] = { commit, sha256: hash(blob(commit, path)) };
json(join(report, 'inputs.json'), inputs);
console.log(JSON.stringify({ frozen: specimens.length, scratch, source, freezeSha256: inputs.freezeSha256 }));
