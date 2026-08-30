import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const owned = 'tests/integration/adapter-tools-diagnostics';
const filename = process.argv[2] ?? 'append-closure.json';
assert.match(filename, /^[a-z-]+\.json$/);
assert.equal(existsSync(`${root}${owned}/${filename}`), false, 'choose a new evidence filename');
const sourceRevision = '19149d3d9c5dc6f309b61f215a140df18adaf6e4';
const oldRevision = 'df5bc453de004a8eb483696cf4ae1986a012cca1';
const correctedRevision = '33ddb70c75865e3e695cf471b942ab0add98a891';
const auditRevision = 'd5ac96afd5288234de3b617bc15af3b2a3c42bf5';
const matrix = 'tests/integration/adapter-tools/matrix.test.ts';
const fixture = 'tests/integration/adapter-tools/fixtures.ts';
const mock = 'tests/fs/webdav/mock.ts';
const git = args => execFileSync('git', args, { cwd: root, timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
const text = args => git(args).toString().trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = (revision, path) => ({ path, revision,
  blob: text(['rev-parse', `${revision}:${path}`]), sha256: sha256(git(['show', `${revision}:${path}`])) });
const oldMatrix = git(['show', `${oldRevision}:${matrix}`]).toString();
const correctedMatrix = git(['show', `${correctedRevision}:${matrix}`]).toString();
const addition = `        if (source === "printf 'changed' >> target.txt") {
          await assert.rejects(
            () => fs.writeFile(path, new Uint8Array(), { flag: "a" }),
            fsError("EROFS", path),
          );
          assert.deepEqual(await snapshotTree(fs), before, "readonly append-open rejection preserves namespace and bytes");
        }
`;
assert.equal(correctedMatrix.split(addition).length, 2);
assert.equal(correctedMatrix.replace(addition, ''), oldMatrix, 'only the seven-line assertion addition differs');
assert.equal(text(['rev-parse', `${oldRevision}:${fixture}`]), text(['rev-parse', `${correctedRevision}:${fixture}`]));
const fixtureSource = git(['show', `${correctedRevision}:${fixture}`]).toString();
for (const retained of ['error instanceof FsError', 'assert.equal(error.code, code)', 'assert.equal(error.path, path)',
  'snapshot[path] = await fs.readFile(path)']) assert.ok(fixtureSource.includes(retained), retained);
for (const retained of ['const path = "/work/target.txt";', 'fs.appendFile(path, Buffer.from("changed"))',
  'await assert.rejects(mutation, fsError("EROFS", path));',
  '"readonly preserves the entire namespace and bytes"', '"direct readonly rejection preserves namespace and bytes"']) {
  assert.ok(correctedMatrix.includes(retained), retained);
}
const loaderPath = `${owned}/revision-loader.mjs`;
const auditLoader = git(['show', `${auditRevision}:${loaderPath}`]).toString();
const currentLoader = readFileSync(`${root}${loaderPath}`, 'utf8');
const oldGuard = "assert.ok(matrixRevision === undefined || matrixRevision === 'df5bc453de004a8eb483696cf4ae1986a012cca1');";
const newGuard = "assert.ok(matrixRevision === undefined || ['df5bc453de004a8eb483696cf4ae1986a012cca1',\n  '33ddb70c75865e3e695cf471b942ab0add98a891'].includes(matrixRevision));";
assert.equal(currentLoader, auditLoader.replace(oldGuard, newGuard), 'only the accepted matrix revision list changes');
const mutationBlock = auditLoader.slice(auditLoader.indexOf("  if (mutation === 'append-untyped'"), auditLoader.indexOf('  return { format:'));
assert.ok(currentLoader.includes(mutationBlock), 'mutation remains byte-for-byte identical');
const historicalPaths = text(['ls-tree', '-r', '--name-only', auditRevision, owned]).split('\n')
  .filter(path => path !== `${owned}/README.md` && path !== loaderPath);
const historicalArtifacts = historicalPaths.map(path => {
  const record = identity(auditRevision, path);
  assert.equal(sha256(readFileSync(`${root}${path}`)), record.sha256, `historical artifact changed: ${path}`);
  return record;
});
const sourceFiles = text(['ls-tree', '-r', '--name-only', sourceRevision, 'src']).split('\n');
const sourceManifest = sourceFiles.map(path => identity(sourceRevision, path));
const protectedPaths = [...new Set([...text(['ls-files', 'src', 'tests/integration/adapter-tools', mock]).split('\n'), ...historicalPaths])].sort();
const worktreeHashes = () => Object.fromEntries(protectedPaths.map(path => [path, sha256(readFileSync(`${root}${path}`))]));
const before = worktreeHashes();
const temporaryRoot = mkdtempSync(`${root}${owned}/.append-closure-`);
const runs = [];
try {
  for (const [label, matrixRevision, mutation, expectedExit] of [
    ['old-mutant', oldRevision, 'append-untyped', 0],
    ['corrected-baseline', correctedRevision, undefined, 0],
    ['corrected-mutant', correctedRevision, 'append-untyped', 1],
  ]) {
    const env = { ...process.env, DIAGNOSTIC_REVISION: sourceRevision, DIAGNOSTIC_MATRIX_REVISION: matrixRevision,
      TMPDIR: temporaryRoot, TMP: temporaryRoot, TEMP: temporaryRoot, TSX_DISABLE_CACHE: '1' };
    delete env.DIAGNOSTIC_MUTATION;
    delete env.NODE_OPTIONS;
    if (mutation) env.DIAGNOSTIC_MUTATION = mutation;
    const argv = ['--unhandled-rejections=strict', '--import', 'tsx', '--import', `./${owned}/register.mjs`,
      '--test', '--test-reporter=tap', '--test-name-pattern', "^readonly: rejects mutation: printf 'changed' >> target\\.txt$", matrix];
    const result = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8',
      timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key =>
      [key, Number(result.stdout?.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? NaN)]));
    const expectedCounts = { tests: 1, pass: expectedExit ? 0 : 1, fail: expectedExit ? 1 : 0, cancelled: 0, skipped: 0, todo: 0 };
    const mismatchReasons = [];
    if (result.error) mismatchReasons.push(String(result.error));
    if (result.status !== expectedExit) mismatchReasons.push(`expected exit ${expectedExit}, got ${result.status}`);
    if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) mismatchReasons.push('unexpected test denominator/outcome');
    if (label === 'corrected-mutant' && !result.stdout.includes('filesystem boundary must reject with an actual FsError')) {
      mismatchReasons.push('failure did not identify FsError boundary identity');
    }
    runs.push({ label, executable: process.execPath, cwd: root, argv,
      environmentOverrides: { DIAGNOSTIC_REVISION: sourceRevision, DIAGNOSTIC_MATRIX_REVISION: matrixRevision,
        DIAGNOSTIC_MUTATION: mutation ?? null, TMPDIR: temporaryRoot, TMP: temporaryRoot, TEMP: temporaryRoot,
        TSX_DISABLE_CACHE: '1', NODE_OPTIONS: null },
      timeoutMs: 30000, maxBufferBytes: 1024 * 1024, killSignal: 'SIGKILL', expectedExit,
      exitCode: result.status, signal: result.signal, counts, mismatchReasons, stdout: result.stdout, stderr: result.stderr });
    console.log(label, JSON.stringify(counts), 'exit', result.status);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
const after = worktreeHashes();
const changedPaths = protectedPaths.filter(path => before[path] !== after[path]);
const closed = runs.length === 3 && runs.every(run => run.mismatchReasons.length === 0) && changedPaths.length === 0;
const evidence = { recordedAt: new Date().toISOString(), verdict: closed ? 'SPECIFIC GAP CLOSED' : 'NOT CLOSED',
  scope: 'Readonly append-open typed-boundary assertion only; no fresh eight-case/full matrix/cancellation acceptance.',
  historicalCohorts: { original: '71/79 HISTORICAL; not accepted retroactively', revised: '79/79 HISTORICAL; not freshly executed' },
  nodeVersion: process.version, harnessArgv: [process.execPath, ...process.argv.slice(1)],
  tooling: { typescript: JSON.parse(readFileSync(`${root}node_modules/typescript/package.json`)).version,
    tsx: JSON.parse(readFileSync(`${root}node_modules/tsx/package.json`)).version,
    package: identity(sourceRevision, 'package.json'), lockfile: identity(sourceRevision, 'package-lock.json'),
    currentLockfileSha256: sha256(readFileSync(`${root}package-lock.json`)) },
  reviewedCommit: correctedRevision, auditRevision,
  source: { revision: sourceRevision, tree: text(['rev-parse', `${sourceRevision}:src`]),
    manifestSha256: sha256(JSON.stringify(sourceManifest)), files: sourceManifest, mock: identity(sourceRevision, mock) },
  matrices: [oldRevision, correctedRevision].map(revision => ({ revision,
    matrix: identity(revision, matrix), fixture: identity(revision, fixture) })),
  assertionDiff: git(['diff', oldRevision, correctedRevision, '--', matrix]).toString(),
  checksRetained: ['appendFile(changed)', 'writeFile(empty,{flag:a})', 'instanceof FsError', 'exact EROFS',
    'exact /work/target.txt', 'nonzero and exact exit 1', 'exact human stderr and empty stdout',
    'target/old/payload bytes', 'whole /work namespace/bytes after shell and both direct rejections'],
  mutation: { name: 'append-untyped', byteIdenticalToAudit: true, block: mutationBlock, sha256: sha256(mutationBlock),
    reason: 'Plain Error has correct EROFS/path only on readonly writeFile flag a; old row misses its identity, corrected row rejects it. appendFile remains a typed FsError.' },
  loader: { prior: identity(auditRevision, loaderPath), currentSha256: sha256(currentLoader),
    change: 'Allow corrected matrix revision only; source selection/transforms/mutation unchanged' },
  helperSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  historicalArtifacts, protectedWorktree: { before, after, changedPaths },
  nativeCalls: 0, temporaryRoot, temporaryRootRemoved: !existsSync(temporaryRoot), runs };
const patch = `*** Begin Patch\n*** Add File: ${owned}/${filename}\n${JSON.stringify(evidence, null, 2).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
const saved = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
assert.ifError(saved.error);
assert.equal(saved.status, 0, saved.stderr);
console.log(saved.stdout.trim(), evidence.verdict);
process.exitCode = closed ? 0 : 1;
