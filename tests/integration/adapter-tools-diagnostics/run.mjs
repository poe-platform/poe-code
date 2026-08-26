import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const owned = 'tests/integration/adapter-tools-diagnostics';
const filename = process.argv[2] ?? 'rerun.json';
assert.match(filename, /^[a-z-]+\.json$/);
assert.equal(existsSync(`${root}${owned}/${filename}`), false, 'choose a new evidence filename');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
const files = directory => readdirSync(`${root}${directory}`, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
const hashes = () => Object.fromEntries([...files('src').filter(path => path.endsWith('.ts')),
  'tests/integration/adapter-tools/fixtures.ts', 'tests/integration/adapter-tools/matrix.test.ts',
  'tests/fs/webdav/mock.ts'].sort().map(path => [path, sha256(readFileSync(`${root}${path}`))]));
const keyPaths = ['src/shell/runtime.ts', 'src/contracts/errors.ts', 'src/fs/readonly/index.ts',
  'src/fs/mount/index.ts', 'src/fs/overlay/index.ts', 'src/fs/s3/filesystem.ts', 'src/fs/webdav/webdav.ts',
  'tests/integration/adapter-tools/fixtures.ts', 'tests/integration/adapter-tools/matrix.test.ts'];
const runs = [];
const initialHashes = hashes();
for (const revision of ['worktree', '19149d3d9c5dc6f309b61f215a140df18adaf6e4']) {
  const before = hashes();
  const head = git(['rev-parse', 'HEAD']);
  const argv = ['--unhandled-rejections=strict', '--import', 'tsx', '--import', `./${owned}/register.mjs`,
    '--test', '--test-reporter=tap', `${owned}/eight-cases.test.ts`];
  const result = spawnSync(process.execPath, argv, { cwd: root,
    env: { ...process.env, DIAGNOSTIC_REVISION: revision }, encoding: 'utf8', timeout: 120000,
    maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(result.error);
  const after = hashes();
  const records = result.stdout.split('\n').filter(line => line.startsWith('# EVIDENCE '))
    .map(line => JSON.parse(Buffer.from(line.slice('# EVIDENCE '.length), 'base64').toString()));
  const changedPaths = Object.keys({ ...before, ...after }).filter(path => before[path] !== after[path]);
  const summary = result.stdout.split('\n').filter(line => /^# (tests|pass|fail|cancelled|skipped|todo|duration_ms) /.test(line));
  const item = { revision, headAtStart: head, executable: process.execPath, argv, exitCode: result.status,
    stderr: result.stderr, summary, records, changedPathsDuringRun: changedPaths,
    source: revision === 'worktree' ? { fileCount: Object.keys(before).length, sha256: sha256(JSON.stringify(before)),
      keyFileSha256: Object.fromEntries(keyPaths.map(path => [path, before[path]])) }
      : { tree: git(['rev-parse', `${revision}:src`]),
        fixtureBlob: git(['rev-parse', `${revision}:tests/integration/adapter-tools/fixtures.ts`]),
        matrixBlob: git(['rev-parse', `${revision}:tests/integration/adapter-tools/matrix.test.ts`]) },
  };
  runs.push(item);
  console.log(revision, 'exit', result.status, summary.join('; '));
  for (const record of records.filter(record => record.status !== 'PASS')) console.log(JSON.stringify(record));
  if (records.length !== 8) console.log(result.stdout);
}
const typecheckArgv = ['--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext',
  '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes',
  '--verbatimModuleSyntax', '--forceConsistentCasingInFileNames', '--skipLibCheck', '--types', 'node',
  `${owned}/eight-cases.test.ts`];
const typecheck = spawnSync(`${root}node_modules/.bin/tsc`, typecheckArgv,
  { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
assert.ifError(typecheck.error);
console.log('scoped typecheck exit', typecheck.status, typecheck.stdout, typecheck.stderr);
const finalHashes = hashes();
const evidence = { recordedAt: new Date().toISOString(), nodeVersion: process.version,
  referenceSha256: sha256(readFileSync(`${root}${owned}/reference.json`)),
  testSha256: sha256(readFileSync(`${root}${owned}/eight-cases.test.ts`)),
  loaderSha256: sha256(readFileSync(`${root}${owned}/revision-loader.mjs`)),
  comparisonRevisions: Object.fromEntries(['6a259ff', '19149d3', 'd0fed8f', 'df5bc45'].map(revision =>
    [revision, { commit: git(['rev-parse', revision]), matrixBlob: git(['rev-parse', `${revision}:tests/integration/adapter-tools/matrix.test.ts`]),
      fixtureBlob: git(['rev-parse', `${revision}:tests/integration/adapter-tools/fixtures.ts`]) }])),
  runs, typecheck: { argv: typecheckArgv, exitCode: typecheck.status, stdout: typecheck.stdout, stderr: typecheck.stderr },
  changedDuringSession: Object.keys(initialHashes).filter(path => initialHashes[path] !== finalHashes[path]),
};
const patch = `*** Begin Patch\n*** Add File: ${owned}/${filename}\n${JSON.stringify(evidence, null, 2).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
const saved = spawnSync('apply_patch', [], { input: patch, encoding: 'utf8', maxBuffer: 1024 * 1024 });
assert.equal(saved.status, 0, saved.stderr);
console.log(saved.stdout.trim());
process.exitCode = typecheck.status || (runs.some(run => run.exitCode || run.records.length !== 8 || run.changedPathsDuringRun.length) ? 1 : 0);
